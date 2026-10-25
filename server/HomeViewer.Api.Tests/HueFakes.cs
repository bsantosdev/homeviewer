using System.Net;
using System.Text;

namespace HomeViewer.Api.Tests;

/// <summary>Answers like a Hue bridge's CLIP v2 API and records what was sent to it.</summary>
public sealed class FakeHueBridge : HttpMessageHandler
{
    public const string Address = "192.168.1.50";
    public const string AppKey = "test-app-key";

    public record Request(HttpMethod Method, string Url, string? AppKey, string? Body);

    public List<Request> Requests { get; } = [];

    /// <summary>The next answer, by method and URL. Anything else gets a 404.</summary>
    public Dictionary<(HttpMethod, string), Func<HttpResponseMessage>> Responses { get; } = [];

    public void Serve(HttpMethod method, string url, string json, HttpStatusCode status = HttpStatusCode.OK) =>
        Responses[(method, url)] = () => new HttpResponseMessage(status)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };

    public void Throw(HttpMethod method, string url, Exception error) => Responses[(method, url)] = () => throw error;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var url = request.RequestUri!.ToString();
        Requests.Add(new(
            request.Method,
            url,
            request.Headers.TryGetValues("hue-application-key", out var keys) ? keys.Single() : null,
            request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken)));
        return Responses.TryGetValue((request.Method, url), out var respond)
            ? respond()
            : new HttpResponseMessage(HttpStatusCode.NotFound);
    }
}

/// <summary>
/// A home shaped like a real bridge's answers, trimmed to the fields the server reads plus a few it ignores.
/// Rooms list devices, and each light names its device as its owner.
/// </summary>
public static class HueJson
{
    public const string KitchenId = "3f2a1b4c-1111-4d2e-9a3b-000000000001";
    public const string SofaId = "3f2a1b4c-2222-4d2e-9a3b-000000000002";
    public const string PlugId = "3f2a1b4c-3333-4d2e-9a3b-000000000003";
    public const string FloorId = "3f2a1b4c-4444-4d2e-9a3b-000000000004";
    public const string StrayId = "3f2a1b4c-5555-4d2e-9a3b-000000000005";
    public const string KitchenGroupId = "7c9d0e1f-1111-4a2b-8c3d-0000000000a1";
    public const string LivingGroupId = "7c9d0e1f-2222-4a2b-8c3d-0000000000a2";
    public const string PorchGroupId = "7c9d0e1f-3333-4a2b-8c3d-0000000000a3";

    public const string LightsUrl = $"https://{FakeHueBridge.Address}/clip/v2/resource/light";
    public const string RoomsUrl = $"https://{FakeHueBridge.Address}/clip/v2/resource/room";
    public const string GroupsUrl = $"https://{FakeHueBridge.Address}/clip/v2/resource/grouped_light";

    /// <summary>The corners of a Hue colour bulb's gamut, as the bridge reports them.</summary>
    public const string RedXy = """{ "x": 0.6915, "y": 0.3083 }""";
    public const string BlueXy = """{ "x": 0.1532, "y": 0.0475 }""";

    /// <summary>
    /// A white-ambiance light that's off, a warm white light, a smart plug with no dimming or colour,
    /// two colour lights showing colours (so their temperature isn't valid), a name with a stray space,
    /// and a light in a room without a light group. Out of name order.
    /// </summary>
    public const string Lights = $$"""
        {
          "errors": [],
          "data": [
            {
              "id": "{{SofaId}}",
              "type": "light",
              "owner": { "rid": "device-sofa", "rtype": "device" },
              "metadata": { "name": "sofa lamp", "archetype": "floor_shade" },
              "on": { "on": false },
              "dimming": { "brightness": 49.8, "min_dim_level": 0.2 },
              "color_temperature": {
                "mirek": 366,
                "mirek_valid": true,
                "mirek_schema": { "mirek_minimum": 153, "mirek_maximum": 454 }
              }
            },
            {
              "id": "{{KitchenId}}",
              "type": "light",
              "owner": { "rid": "device-kitchen", "rtype": "device" },
              "metadata": { "name": "Kitchen", "archetype": "pendant_round" },
              "on": { "on": true },
              "dimming": { "brightness": 0.39 },
              "color_temperature": { "mirek": 446, "mirek_valid": true }
            },
            {
              "id": "light-strip",
              "type": "light",
              "owner": { "rid": "device-strip", "rtype": "device" },
              "metadata": { "name": "Shelf strip", "archetype": "hue_lightstrip" },
              "on": { "on": true },
              "dimming": { "brightness": 30 },
              "color": { "xy": {{BlueXy}}, "gamut_type": "C" },
              "color_temperature": { "mirek": null, "mirek_valid": false }
            },
            {
              "id": "{{PlugId}}",
              "type": "light",
              "owner": { "rid": "device-plug", "rtype": "device" },
              "metadata": { "name": "Lava lamp", "archetype": "plug" },
              "on": { "on": true }
            },
            {
              "id": "{{FloorId}}",
              "type": "light",
              "owner": { "rid": "device-floor", "rtype": "device" },
              "metadata": { "name": "Floor lamp ", "archetype": "floor_lantern" },
              "on": { "on": true },
              "dimming": { "brightness": 70 },
              "color": { "xy": {{RedXy}}, "gamut_type": "C" },
              "color_temperature": { "mirek": null, "mirek_valid": false }
            },
            {
              "id": "{{StrayId}}",
              "type": "light",
              "owner": { "rid": "device-stray", "rtype": "device" },
              "metadata": { "name": "Stray bulb", "archetype": "classic_bulb" },
              "on": { "on": false },
              "dimming": { "brightness": 20 }
            }
          ]
        }
        """;

    /// <summary>
    /// A room with a motion sensor alongside its lights, a room with a stray space in its name, a room
    /// with no lights, a room that lists a light directly, and a room with no light group.
    /// </summary>
    public const string Rooms = $$"""
        {
          "errors": [],
          "data": [
            {
              "id": "room-living",
              "type": "room",
              "metadata": { "name": "Living room", "archetype": "living_room" },
              "children": [
                { "rid": "device-sofa", "rtype": "device" },
                { "rid": "device-motion", "rtype": "device" },
                { "rid": "device-floor", "rtype": "device" },
                { "rid": "device-strip", "rtype": "device" }
              ],
              "services": [
                { "rid": "motion-living", "rtype": "grouped_motion" },
                { "rid": "{{LivingGroupId}}", "rtype": "grouped_light" }
              ]
            },
            {
              "id": "room-garage",
              "type": "room",
              "metadata": { "name": "Garage", "archetype": "garage" },
              "children": [{ "rid": "device-motion-2", "rtype": "device" }],
              "services": [{ "rid": "group-garage", "rtype": "grouped_light" }]
            },
            {
              "id": "room-kitchen",
              "type": "room",
              "metadata": { "name": "Kitchen ", "archetype": "kitchen" },
              "children": [{ "rid": "device-kitchen", "rtype": "device" }],
              "services": [{ "rid": "{{KitchenGroupId}}", "rtype": "grouped_light" }]
            },
            {
              "id": "room-porch",
              "type": "room",
              "metadata": { "name": "Porch", "archetype": "terrace" },
              "children": [{ "rid": "{{PlugId}}", "rtype": "light" }],
              "services": [{ "rid": "{{PorchGroupId}}", "rtype": "grouped_light" }]
            },
            {
              "id": "room-attic",
              "type": "room",
              "metadata": { "name": "Attic", "archetype": "attic" },
              "children": [{ "rid": "device-stray", "rtype": "device" }],
              "services": []
            }
          ]
        }
        """;

    /// <summary>Each room's light group, plus the bridge's whole-home group.</summary>
    public const string Groups = $$"""
        {
          "errors": [],
          "data": [
            {
              "id": "{{LivingGroupId}}",
              "type": "grouped_light",
              "owner": { "rid": "room-living", "rtype": "room" },
              "on": { "on": true },
              "dimming": { "brightness": 60.2 },
              "alert": { "action_values": ["breathe"] }
            },
            {
              "id": "{{KitchenGroupId}}",
              "type": "grouped_light",
              "owner": { "rid": "room-kitchen", "rtype": "room" },
              "on": { "on": true },
              "dimming": { "brightness": 0.39 }
            },
            {
              "id": "{{PorchGroupId}}",
              "type": "grouped_light",
              "owner": { "rid": "room-porch", "rtype": "room" },
              "on": { "on": true }
            },
            {
              "id": "group-garage",
              "type": "grouped_light",
              "owner": { "rid": "room-garage", "rtype": "room" },
              "on": { "on": false }
            },
            {
              "id": "group-home",
              "type": "grouped_light",
              "owner": { "rid": "home", "rtype": "bridge_home" },
              "on": { "on": true },
              "dimming": { "brightness": 55 }
            }
          ]
        }
        """;

    public const string RelaxSceneId = "5e6f7a8b-1111-4c2d-9e3f-0000000000b1";
    public const string ScenesUrl = $"https://{FakeHueBridge.Address}/clip/v2/resource/scene";

    /// <summary>
    /// Two living room scenes, out of name order: a warm white one, and a colourful one that turns a
    /// light off, repeats a colour, and has a stray space in its name. Plus a kitchen scene.
    /// </summary>
    public const string Scenes = $$"""
        {
          "errors": [],
          "data": [
            {
              "id": "scene-party",
              "type": "scene",
              "metadata": { "name": "Party ", "image": { "rid": "image-1", "rtype": "public_image" } },
              "group": { "rid": "room-living", "rtype": "room" },
              "actions": [
                { "target": { "rid": "{{FloorId}}", "rtype": "light" }, "action": { "on": { "on": true }, "color": { "xy": {{RedXy}} } } },
                { "target": { "rid": "light-strip", "rtype": "light" }, "action": { "on": { "on": true }, "color": { "xy": {{BlueXy}} } } },
                { "target": { "rid": "{{SofaId}}", "rtype": "light" }, "action": { "on": { "on": false } } },
                { "target": { "rid": "light-other", "rtype": "light" }, "action": { "color": { "xy": {{RedXy}} } } }
              ],
              "palette": { "color": [], "dimming": [], "color_temperature": [], "effects": [] },
              "status": { "active": "inactive" }
            },
            {
              "id": "{{RelaxSceneId}}",
              "type": "scene",
              "metadata": { "name": "Relax" },
              "group": { "rid": "room-living", "rtype": "room" },
              "actions": [
                { "target": { "rid": "{{FloorId}}", "rtype": "light" }, "action": { "on": { "on": true }, "dimming": { "brightness": 56 }, "color_temperature": { "mirek": 446 } } },
                { "target": { "rid": "{{SofaId}}", "rtype": "light" }, "action": { "on": { "on": true }, "color_temperature": { "mirek": 446 } } }
              ]
            },
            {
              "id": "scene-read",
              "type": "scene",
              "metadata": { "name": "Read" },
              "group": { "rid": "room-kitchen", "rtype": "room" },
              "actions": [
                { "target": { "rid": "{{KitchenId}}", "rtype": "light" }, "action": { "on": { "on": true }, "color_temperature": { "mirek": 346 } } }
              ]
            }
          ]
        }
        """;

    public static string Updated(string id, string type) =>
        $$"""{ "errors": [], "data": [{ "rid": "{{id}}", "rtype": "{{type}}" }] }""";

    /// <summary>Has the bridge answer the three reads behind GET /api/rooms.</summary>
    public static void ServeHome(this FakeHueBridge hue)
    {
        hue.Serve(HttpMethod.Get, LightsUrl, Lights);
        hue.Serve(HttpMethod.Get, RoomsUrl, Rooms);
        hue.Serve(HttpMethod.Get, GroupsUrl, Groups);
    }

    /// <summary>Has the bridge answer the two reads behind GET /api/rooms/{id}/scenes for the living room.</summary>
    public static void ServeLivingRoomScenes(this FakeHueBridge hue)
    {
        hue.Serve(HttpMethod.Get, $"{GroupsUrl}/{LivingGroupId}", $$"""
            {
              "errors": [],
              "data": [{
                "id": "{{LivingGroupId}}",
                "type": "grouped_light",
                "owner": { "rid": "room-living", "rtype": "room" },
                "on": { "on": true }
              }]
            }
            """);
        hue.Serve(HttpMethod.Get, ScenesUrl, Scenes);
    }
}
