using HomeViewer.Api;
using Microsoft.AspNetCore.SignalR;

var builder = WebApplication.CreateBuilder(args);
// Relative paths are resolved against the content root; tests point this at a temp file.
string SettingsPath(IServiceProvider sp) => Path.Combine(
    builder.Environment.ContentRootPath,
    sp.GetRequiredService<IConfiguration>().GetValue("SettingsPath", "data/settings.json")!);
builder.Services.AddSingleton(sp => new SettingsStore(SettingsPath(sp)));
// Background images live in a folder next to the settings file.
builder.Services.AddSingleton(sp =>
    new BackgroundStore(Path.Combine(Path.GetDirectoryName(SettingsPath(sp))!, "backgrounds")));
// The shopping list lives next to the settings too.
builder.Services.AddSingleton(sp =>
    new ShoppingStore(Path.Combine(Path.GetDirectoryName(SettingsPath(sp))!, "shopping.json")));
builder.Services.AddSignalR();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpClient(nameof(CalendarFeedReader), http => http.Timeout = TimeSpan.FromSeconds(20));
builder.Services.AddSingleton<CalendarFeedReader>();
builder.Services.Configure<HueOptions>(builder.Configuration.GetSection("Hue"));
builder.Services.AddHttpClient(nameof(HueBridge), http => http.Timeout = TimeSpan.FromSeconds(5))
    // The bridge's certificate comes from Signify's own CA, which the OS doesn't trust.
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        ServerCertificateCustomValidationCallback = HueCertificate.Validate,
    });
builder.Services.AddSingleton<HueBridge>();
builder.Services.Configure<SpotifyOptions>(builder.Configuration.GetSection("Spotify"));
builder.Services.AddHttpClient(nameof(Spotify), http => http.Timeout = TimeSpan.FromSeconds(10));
// The account's login is kept next to the settings, in the data folder that stays out of git.
builder.Services.AddSingleton(sp =>
    new SpotifyLogin(Path.Combine(Path.GetDirectoryName(SettingsPath(sp))!, "spotify.json")));
builder.Services.AddSingleton<Spotify>();

var app = builder.Build();

// index.html must be checked on every load, or browsers (the wall iPad especially) keep running an
// old build. The scripts and styles it points to have hashed names, so they can be cached.
var staticFiles = new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        if (context.File.Name == "index.html") context.Context.Response.Headers.CacheControl = "no-cache";
    },
};

app.UseDefaultFiles();
app.UseStaticFiles(staticFiles);

app.MapGet("/api/settings", (SettingsStore store) => store.Get());

app.MapPut("/api/settings", async (DashboardSettings settings, SettingsStore store, BackgroundStore backgrounds, IHubContext<DashboardHub> hub) =>
{
    if (settings.Calendars.FirstOrDefault(c => !c.HasValidUrl) is { } noLink)
        return Rejected("calendarLink", $"Calendar \"{noLink.Name}\" needs an https:// or webcal:// link.", ("name", noLink.Name));
    if (settings.Calendars.FirstOrDefault(c => !c.HasValidColor) is { } noColor)
        return Rejected("calendarColour", $"Calendar \"{noColor.Name}\" needs a colour like #3b82f6.", ("name", noColor.Name));
    if (settings.BackgroundMinutes is < 1 or > DashboardSettings.MaxBackgroundMinutes)
        return Rejected("backgroundMinutes", $"Backgrounds can change every 1 to {DashboardSettings.MaxBackgroundMinutes} minutes.",
            ("max", DashboardSettings.MaxBackgroundMinutes));
    if (!settings.HasValidNightHours)
        return Rejected("nightHours", "Night mode needs a start and end time like 22:00.");
    if (settings.Backgrounds.Any(name => backgrounds.PathOf(name) is null))
        return Rejected("backgroundMissing", "A background image is missing. Remove it and add it again.");
    if (!settings.HasValidLanguage)
        return Rejected("language", $"The language must be one of {string.Join(", ", DashboardSettings.Languages)}.");

    store.Save(settings);
    // Uploads that didn't make it into the saved settings, and images just removed, aren't needed any more.
    backgrounds.DeleteAllExcept(settings.Backgrounds);
    await hub.Clients.All.SendAsync("SettingsUpdated", settings);
    return Results.Ok(settings);
});

// The image body is sent as is. It's only kept if the next saved settings list it.
app.MapPost("/api/backgrounds", async (HttpRequest request, BackgroundStore backgrounds, CancellationToken cancellationToken) =>
{
    try
    {
        return Results.Ok(new BackgroundUpload(await backgrounds.SaveAsync(request.Body, cancellationToken)));
    }
    catch (InvalidImageException ex)
    {
        return Results.BadRequest(ex.Error);
    }
});

app.MapGet("/api/backgrounds/{name}", (string name, BackgroundStore backgrounds, HttpResponse response) =>
{
    if (backgrounds.PathOf(name) is not { } path) return Results.NotFound();
    // A stored image never changes, since every upload gets a new name.
    response.Headers.CacheControl = "public, max-age=31536000, immutable";
    return Results.File(path, BackgroundStore.ContentTypeOf(name));
});

// The client asks for its own local days; a range is capped to keep recurring events cheap to expand.
app.MapGet("/api/events", async (DateTimeOffset from, DateTimeOffset to, SettingsStore store, CalendarFeedReader reader, CancellationToken cancellationToken) =>
    to <= from || to - from > TimeSpan.FromDays(31)
        ? Results.BadRequest("'to' must be after 'from', at most 31 days later.")
        : Results.Ok(await reader.GetEventsAsync(store.Get().Calendars, from, to, cancellationToken)));

// 503 tells the client there's no bridge set up, so it hides the lights; 502 means the bridge didn't answer.
app.MapGet("/api/rooms", (HueBridge hue, CancellationToken cancellationToken) =>
    CallHue(hue, null, async () => Results.Ok(await hue.GetRoomsAsync(cancellationToken))));

// A room's id is its light group, so changing it changes all its lights at once.
app.MapPut("/api/rooms/{id:guid}", (Guid id, LightChange change, HueBridge hue, CancellationToken cancellationToken) =>
    CallHue(hue, change, async () =>
        await hue.SetRoomAsync(id, change, cancellationToken) ? Results.NoContent() : Results.NotFound()));

// The bridge's scene list is large, so a room's scenes are only fetched when its sheet opens.
app.MapGet("/api/rooms/{id:guid}/scenes", (Guid id, HueBridge hue, CancellationToken cancellationToken) =>
    CallHue(hue, null, async () =>
        await hue.GetScenesAsync(id, cancellationToken) is { } scenes ? Results.Ok(scenes) : Results.NotFound()));

// Every room's scenes, for picking the dashboard's shortcuts.
app.MapGet("/api/scenes", (HueBridge hue, CancellationToken cancellationToken) =>
    CallHue(hue, null, async () => Results.Ok(await hue.GetAllScenesAsync(cancellationToken))));

app.MapPost("/api/scenes/{id:guid}/recall", (Guid id, HueBridge hue, CancellationToken cancellationToken) =>
    CallHue(hue, null, async () =>
        await hue.RecallSceneAsync(id, cancellationToken) ? Results.NoContent() : Results.NotFound()));

// Every change sends the whole list to every screen, so the wall and phones stay in step.
app.MapGet("/api/shopping", (ShoppingStore shopping) => shopping.Get());

app.MapPost("/api/shopping", async (NewShoppingItem item, ShoppingStore shopping, IHubContext<DashboardHub> hub) =>
    item.IsValid
        ? await ShoppingUpdated(hub, shopping.Add(item.Text!))
        : Results.BadRequest($"Write what to buy, in at most {NewShoppingItem.MaxLength} characters."));

app.MapPut("/api/shopping/{id:guid}", async (Guid id, ShoppingItemChange change, ShoppingStore shopping, IHubContext<DashboardHub> hub) =>
    shopping.Change(id, change.Done) is { } items ? await ShoppingUpdated(hub, items) : Results.NotFound());

app.MapDelete("/api/shopping/done", async (ShoppingStore shopping, IHubContext<DashboardHub> hub) =>
    await ShoppingUpdated(hub, shopping.ClearDone()));

// 503 tells the client Spotify isn't set up, so it hides the music. Each screen asks every few seconds.
app.MapGet("/api/spotify", (Spotify spotify, CancellationToken cancellationToken) =>
    spotify is { IsConfigured: true, IsConnected: false }
        ? Task.FromResult<IResult>(Results.Ok(new SpotifyStatus(false, null)))
        : CallSpotify(spotify, async () => Results.Ok(new SpotifyStatus(true, await spotify.GetPlaybackAsync(cancellationToken)))));

// The admin page links here. Spotify sends the browser back to the callback, on the address registered for the app.
app.MapGet("/api/spotify/login", (Spotify spotify) =>
    spotify.IsConfigured ? Results.Redirect(spotify.StartLogin()) : Results.Problem("Spotify isn't set up.", statusCode: 503));

app.MapGet("/api/spotify/callback", async (string? code, string? state, string? error, Spotify spotify, CancellationToken cancellationToken) =>
{
    // Saying no on Spotify's page just goes back to the settings.
    if (error is not null) return Results.Redirect("/admin");
    try
    {
        if (code is null || state is null || !await spotify.FinishLoginAsync(code, state, cancellationToken))
            return Results.BadRequest("This Spotify login wasn't started here, or was started again since. Connect from the settings page.");
    }
    catch (SpotifyException ex)
    {
        return Results.Problem(ex.Message, statusCode: 502);
    }
    return Results.Redirect("/admin");
});

app.MapDelete("/api/spotify/login", (Spotify spotify) =>
{
    spotify.Disconnect();
    return Results.NoContent();
});

app.MapGet("/api/spotify/devices", (Spotify spotify, CancellationToken cancellationToken) =>
    CallSpotify(spotify, async () => Results.Ok(await spotify.GetDevicesAsync(cancellationToken))));

app.MapGet("/api/spotify/playlists", (Spotify spotify, CancellationToken cancellationToken) =>
    CallSpotify(spotify, async () => Results.Ok(await spotify.GetPlaylistsAsync(cancellationToken))));

app.MapPost("/api/spotify/play", (PlayRequest? request, Spotify spotify, CancellationToken cancellationToken) =>
    (request ??= new(null, null)).IsValid
        ? CallSpotify(spotify, async () =>
        {
            await spotify.PlayAsync(request, cancellationToken);
            return Results.NoContent();
        })
        : Task.FromResult<IResult>(Results.BadRequest("Send a \"contextUri\" like spotify:playlist:… and a \"deviceId\" from /api/spotify/devices, or neither.")));

app.MapPost("/api/spotify/pause", (Spotify spotify, CancellationToken cancellationToken) =>
    SpotifyCommand(spotify, () => spotify.PauseAsync(cancellationToken)));

app.MapPost("/api/spotify/next", (Spotify spotify, CancellationToken cancellationToken) =>
    SpotifyCommand(spotify, () => spotify.NextAsync(cancellationToken)));

app.MapPost("/api/spotify/previous", (Spotify spotify, CancellationToken cancellationToken) =>
    SpotifyCommand(spotify, () => spotify.PreviousAsync(cancellationToken)));

app.MapPut("/api/spotify/volume", (VolumeChange change, Spotify spotify, CancellationToken cancellationToken) =>
    change.IsValid
        ? SpotifyCommand(spotify, () => spotify.SetVolumeAsync(change.Percent, cancellationToken))
        : Task.FromResult<IResult>(Results.BadRequest("Send a \"percent\" from 0 to 100.")));

app.MapPut("/api/spotify/device", (DeviceChange change, Spotify spotify, CancellationToken cancellationToken) =>
    change.IsValid
        ? SpotifyCommand(spotify, () => spotify.TransferAsync(change.Id!, cancellationToken))
        : Task.FromResult<IResult>(Results.BadRequest("Send the \"id\" of a device from /api/spotify/devices.")));

app.MapHub<DashboardHub>("/hubs/dashboard");
app.MapFallbackToFile("index.html", staticFiles);

app.Run();

static async Task<IResult> CallHue(HueBridge hue, LightChange? change, Func<Task<IResult>> call)
{
    if (!hue.IsConfigured) return Results.Problem("No Hue bridge is configured.", statusCode: 503);
    if (change is { IsValid: false })
        return Results.BadRequest(
            $"Send any of \"on\", a \"brightness\" from 1 to 100, and either a \"temperature\" from {HueColor.MinKelvin} to {HueColor.MaxKelvin} kelvin or a \"color\" like #ff8800.");
    try
    {
        return await call();
    }
    catch (HueBridgeException ex)
    {
        return Results.Problem(ex.Message, statusCode: 502);
    }
}

static Task<IResult> SpotifyCommand(Spotify spotify, Func<Task> command) =>
    CallSpotify(spotify, async () =>
    {
        await command();
        return Results.NoContent();
    });

// 503: not set up. 409: nothing to play on, or the account isn't connected; the dashboard explains these.
// 502: Spotify couldn't be reached or failed.
static async Task<IResult> CallSpotify(Spotify spotify, Func<Task<IResult>> call)
{
    if (!spotify.IsConfigured) return Results.Problem("Spotify isn't set up.", statusCode: 503);
    if (!spotify.IsConnected)
        return Results.Conflict(new ApiError("spotifyNotConnected", "Connect a Spotify account in the settings first.", null));
    try
    {
        return await call();
    }
    catch (SpotifyNoDeviceException)
    {
        return Results.Conflict(new ApiError("spotifyNoDevice", "Open Spotify on a phone, computer or speaker first.", null));
    }
    catch (SpotifyRefusedException)
    {
        return Results.Conflict(new ApiError("spotifyRefused", "Spotify can't do that right now.", null));
    }
    catch (SpotifyException ex)
    {
        return Results.Problem(ex.Message, statusCode: 502);
    }
}

// The admin page shows these, so they carry a code it can translate.
static IResult Rejected(string code, string message, params (string Name, object Value)[] values) =>
    Results.BadRequest(new ApiError(code, message, values.Length == 0 ? null : values.ToDictionary(v => v.Name, v => v.Value)));

static async Task<IResult> ShoppingUpdated(IHubContext<DashboardHub> hub, IReadOnlyList<ShoppingItem> items)
{
    await hub.Clients.All.SendAsync("ShoppingUpdated", items);
    return Results.Ok(items);
}

// Lets the test project start the app with WebApplicationFactory<Program>.
public partial class Program;
