using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace HomeViewer.Api;

/// <summary>Where the Philips Hue bridge is and the app key it gave us. Read from the "Hue" config section.</summary>
public class HueOptions
{
    /// <summary>The bridge's IP address or host name on the home network.</summary>
    public string BridgeAddress { get; set; } = "";

    /// <summary>The "username" the bridge returns when you press its link button and register an app.</summary>
    public string AppKey { get; set; } = "";
}

/// <summary>A room from the Hue app, switched and dimmed as a whole.</summary>
/// <param name="Id">The room's light group, which changes all its lights at once.</param>
/// <param name="On">True if any of its lights is on.</param>
/// <param name="Brightness">The average of the lights that are on (0 while all are off), or null if none can dim.</param>
/// <param name="Colors">
/// What the lights that are on look like, as "#rrggbb" at full brightness: up to three, one per distinct
/// colour. Empty while the room is off, or if its lights can only dim.
/// </param>
/// <param name="Temperature">The white its lights are set to, in kelvin, or null if none is in white mode.</param>
/// <param name="CanColor">Whether any of its lights can show colours, not just whites.</param>
public record Room(
    string Id, string Name, bool On, int? Brightness, IReadOnlyList<string> Colors, int? Temperature, bool CanColor);

/// <summary>One of a room's scenes from the Hue app.</summary>
/// <param name="Colors">A preview: up to four of the colours it sets, as "#rrggbb".</param>
public record Scene(string Id, string Name, IReadOnlyList<string> Colors);

/// <summary>What to change on a room. Leave a value out to keep it.</summary>
/// <param name="Brightness">1–100 percent.</param>
/// <param name="Temperature">A white, in kelvin, from <see cref="HueColor.MinKelvin"/> to <see cref="HueColor.MaxKelvin"/>.</param>
/// <param name="Color">A colour, as "#rrggbb". Lights that can only do whites ignore it.</param>
public partial record LightChange(bool? On, int? Brightness, int? Temperature = null, string? Color = null)
{
    public bool IsValid =>
        (On, Brightness, Temperature, Color) is not (null, null, null, null)
        && Brightness is null or (>= 1 and <= 100)
        && Temperature is null or (>= HueColor.MinKelvin and <= HueColor.MaxKelvin)
        && (Color is null || HexColor().IsMatch(Color))
        // A light is either white or coloured, so asking for both is a mistake.
        && (Temperature is null || Color is null);

    [GeneratedRegex("^#[0-9a-fA-F]{6}\\z", RegexOptions.None, matchTimeoutMilliseconds: 100)]
    private static partial Regex HexColor();
}

public class HueBridgeException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Reads and switches rooms through the bridge's local CLIP v2 API.</summary>
public class HueBridge(IHttpClientFactory httpFactory, IOptionsMonitor<HueOptions> options)
{
    public bool IsConfigured => options.CurrentValue is { BridgeAddress: not "", AppKey: not "" };

    /// <summary>The rooms that have lights and a light group, by name.</summary>
    public async Task<IReadOnlyList<Room>> GetRoomsAsync(CancellationToken cancellationToken)
    {
        var lightsTask = GetAsync<HueLight>("light", cancellationToken);
        var roomsTask = GetAsync<HueRoom>("room", cancellationToken);
        var groupsTask = GetAsync<HueGroupedLight>("grouped_light", cancellationToken);
        var (lights, rooms, groups) = (await lightsTask, await roomsTask, await groupsTask);

        // The light group reports on/off and brightness, but not colour, so that comes from the lights.
        // A room lists the devices in it, and each light names the device it belongs to.
        // Rooms with only sensors or switches in them have nothing to show.
        return
        [
            .. from room in rooms
               let children = room.Children.Select(c => c.Rid).ToHashSet()
               let members = lights.Where(l => children.Contains(l.Owner.Rid) || children.Contains(l.Id)).ToList()
               where members.Count > 0
               let groupId = room.Services.FirstOrDefault(s => s.Rtype == "grouped_light")?.Rid
               let grouped = groups.FirstOrDefault(g => g.Id == groupId)
               where grouped is not null
               // The Hue app keeps stray spaces at the end of names ("Flur ").
               let name = room.Metadata.Name.Trim()
               orderby name
               select new Room(
                   grouped.Id, name, grouped.On.On, Percent(grouped.Dimming),
                   [.. members.Where(l => l.On.On).Select(LightColor).OfType<string>().Distinct().Take(3)],
                   members.Select(l => l.ColorTemperature).FirstOrDefault(t => t is { MirekValid: true, Mirek: not null })
                       is { Mirek: { } mirek } ? HueColor.MirekToKelvin(mirek) : null,
                   members.Any(l => l.Color is not null)),
        ];
    }

    /// <param name="id">The room's <see cref="Room.Id"/>.</param>
    /// <returns>Null if the bridge has no room with that id.</returns>
    public async Task<IReadOnlyList<Scene>?> GetScenesAsync(Guid id, CancellationToken cancellationToken)
    {
        // Scenes belong to the room itself, which our room id (its light group) names as its owner.
        using var response = await SendAsync(HttpMethod.Get, $"grouped_light/{id}", null, cancellationToken, allowNotFound: true);
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        var roomId = (await ReadAsync<HueGroupedLight>(response, cancellationToken)).Single().Owner.Rid;
        var scenes = await GetAsync<HueScene>("scene", cancellationToken);
        return
        [
            .. from scene in scenes
               where scene.Group.Rid == roomId
               let name = scene.Metadata.Name.Trim()
               orderby name
               select new Scene(scene.Id, name, [
                   .. scene.Actions
                       .Where(a => a.Action.On?.On != false)
                       .Select(a => LightColor(a.Action.Color, a.Action.ColorTemperature))
                       .OfType<string>().Distinct().Take(4),
               ]),
        ];
    }

    /// <param name="id">The room's <see cref="Room.Id"/>.</param>
    /// <returns>False if the bridge has no room with that id.</returns>
    public async Task<bool> SetRoomAsync(Guid id, LightChange change, CancellationToken cancellationToken)
    {
        var update = new HueLightUpdate(
            change.On is { } on ? new HueOn(on) : null,
            change.Brightness is { } brightness ? new HueDimming(brightness) : null,
            change.Temperature is { } kelvin ? new HueMirek(HueColor.KelvinToMirek(kelvin)) : null,
            change.Color is { } hex ? ColorState(hex) : null);
        return await PutAsync($"grouped_light/{id}", update, cancellationToken);
    }

    /// <returns>False if the bridge has no scene with that id.</returns>
    public Task<bool> RecallSceneAsync(Guid id, CancellationToken cancellationToken) =>
        PutAsync($"scene/{id}", new { recall = new { action = "active" } }, cancellationToken);

    private async Task<bool> PutAsync<T>(string resource, T body, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Put, resource, JsonContent.Create(body), cancellationToken, allowNotFound: true);
        return response.StatusCode != HttpStatusCode.NotFound;
    }

    private static string? LightColor(HueLight light) => LightColor(light.Color, light.ColorTemperature);

    // A light in white mode reports a valid temperature; otherwise its colour is the xy point.
    private static string? LightColor(HueColorState? color, HueColorTemperature? temperature) =>
        temperature is { MirekValid: true, Mirek: { } mirek } ? HueColor.FromMirek(mirek)
        : color is not null ? HueColor.FromXy(color.Xy.X, color.Xy.Y)
        : null;

    private static HueColorState ColorState(string hex)
    {
        var (x, y) = HueColor.ToXy(hex);
        return new(new(x, y));
    }

    private async Task<IReadOnlyList<T>> GetAsync<T>(string resource, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Get, resource, null, cancellationToken);
        return await ReadAsync<T>(response, cancellationToken);
    }

    private static async Task<IReadOnlyList<T>> ReadAsync<T>(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var body = await response.Content.ReadFromJsonAsync<HueResponse<T>>(cancellationToken)
            ?? throw new HueBridgeException("The Hue bridge sent an empty response.");
        return body.Data;
    }

    private async Task<HttpResponseMessage> SendAsync(
        HttpMethod method, string resource, HttpContent? content, CancellationToken cancellationToken, bool allowNotFound = false)
    {
        var settings = options.CurrentValue;
        using var request = new HttpRequestMessage(method, $"https://{settings.BridgeAddress}/clip/v2/resource/{resource}") { Content = content };
        request.Headers.Add("hue-application-key", settings.AppKey);

        HttpResponseMessage response;
        try
        {
            response = await httpFactory.CreateClient(nameof(HueBridge)).SendAsync(request, cancellationToken);
        }
        // A timeout surfaces as a cancellation the caller didn't ask for.
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
        {
            throw new HueBridgeException("Couldn't reach the Hue bridge.", ex);
        }

        if (response.IsSuccessStatusCode || (allowNotFound && response.StatusCode == HttpStatusCode.NotFound)) return response;
        response.Dispose();
        throw new HueBridgeException(response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.Unauthorized
            ? "The Hue bridge rejected the app key."
            : $"The Hue bridge answered {(int)response.StatusCode}.");
    }

    // Hue reports brightness as a float with a minimum above 0 (0.39 or so); round up so a dim room shows 1%.
    private static int? Percent(HueDimming? dimming) => dimming is null ? null : (int)Math.Ceiling(dimming.Brightness);

    // The parts of the CLIP v2 resources we use. Hue writes its fields in lower case, as the web defaults expect.
    private record HueResponse<T>(IReadOnlyList<T> Data);

    private record HueReference(string Rid, string Rtype);

    private record HueLight(
        string Id,
        HueReference Owner,
        HueOn On,
        HueColorState? Color,
        [property: JsonPropertyName("color_temperature")] HueColorTemperature? ColorTemperature);

    private record HueRoom(HueMetadata Metadata, IReadOnlyList<HueReference> Children, IReadOnlyList<HueReference> Services);

    private record HueGroupedLight(string Id, HueReference Owner, HueOn On, HueDimming? Dimming);

    private record HueScene(string Id, HueMetadata Metadata, HueReference Group, IReadOnlyList<HueSceneAction> Actions);

    private record HueSceneAction(HueLightState Action);

    private record HueLightState(
        HueOn? On, HueColorState? Color, [property: JsonPropertyName("color_temperature")] HueColorTemperature? ColorTemperature);

    private record HueMetadata(string Name);

    private record HueOn(bool On);

    private record HueDimming(double Brightness);

    private record HueXy(double X, double Y);

    private record HueColorState(HueXy Xy);

    /// <param name="MirekValid">False while a colour light shows a colour rather than a white. Scenes leave it out.</param>
    private record HueColorTemperature(int? Mirek, [property: JsonPropertyName("mirek_valid")] bool MirekValid = true);

    private record HueMirek(int Mirek);

    // Null parts are left out, so the bridge only changes what was asked for.
    private record HueLightUpdate(
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] HueOn? On,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] HueDimming? Dimming,
        [property: JsonPropertyName("color_temperature"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] HueMirek? ColorTemperature,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] HueColorState? Color);
}
