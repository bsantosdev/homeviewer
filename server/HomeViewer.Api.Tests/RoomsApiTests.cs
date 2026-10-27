using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;

namespace HomeViewer.Api.Tests;

public sealed class RoomsApiTests : IAsyncLifetime
{
    private static readonly string LivingGroupUrl = $"{HueJson.GroupsUrl}/{HueJson.LivingGroupId}";

    private readonly HomeViewerFactory _factory = new();
    private HttpClient _client = null!;

    private FakeHueBridge Hue => _factory.Hue;

    public Task InitializeAsync()
    {
        _client = _factory.CreateClient();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Rooms_with_lights_and_a_light_group_are_listed_by_name()
    {
        Hue.ServeHome();

        var rooms = await _client.GetFromJsonAsync<Room[]>("/api/rooms");

        Assert.Equal(["Kitchen", "Living room", "Porch"], rooms!.Select(r => r.Name));
        Assert.Equal(
            [
                (HueJson.KitchenGroupId, true, (int?)1),
                (HueJson.LivingGroupId, true, 61),
                (HueJson.PorchGroupId, true, null),
            ],
            rooms.Select(r => (r.Id, r.On, r.Brightness)));
    }

    [Fact]
    public async Task Rooms_show_what_their_lights_look_like()
    {
        Hue.ServeHome();

        var rooms = (await _client.GetFromJsonAsync<Room[]>("/api/rooms"))!.ToDictionary(r => r.Name);

        // A warm white, from the light's temperature.
        Assert.Equal(["#ff942c"], rooms["Kitchen"].Colors);
        Assert.Equal(2242, rooms["Kitchen"].Temperature);
        Assert.False(rooms["Kitchen"].CanColor);

        // Two colour lights showing colours; the white light that's off doesn't count, but its
        // temperature is still the room's white.
        Assert.Equal([HueColor.FromXy(0.1532, 0.0475), HueColor.FromXy(0.6915, 0.3083)], rooms["Living room"].Colors);
        Assert.Equal(2732, rooms["Living room"].Temperature);
        Assert.True(rooms["Living room"].CanColor);

        // A smart plug has nothing to show.
        Assert.Empty(rooms["Porch"].Colors);
        Assert.Null(rooms["Porch"].Temperature);
    }

    [Fact]
    public async Task Rooms_that_are_off_have_no_colours()
    {
        Hue.ServeHome();
        Hue.Serve(HttpMethod.Get, HueJson.LightsUrl, HueJson.Lights.Replace("\"on\": { \"on\": true }", "\"on\": { \"on\": false }"));

        var rooms = await _client.GetFromJsonAsync<Room[]>("/api/rooms");

        Assert.All(rooms!, r => Assert.Empty(r.Colors));
    }

    [Fact]
    public async Task Rooms_are_read_with_the_app_key()
    {
        Hue.ServeHome();

        await _client.GetAsync("/api/rooms");

        Assert.Equal(
            [HueJson.GroupsUrl, HueJson.LightsUrl, HueJson.RoomsUrl],
            Hue.Requests.Select(r => r.Url).Order());
        Assert.All(Hue.Requests, r => Assert.Equal(FakeHueBridge.AppKey, r.AppKey));
    }

    [Theory]
    [InlineData("Hue:BridgeAddress")]
    [InlineData("Hue:AppKey")]
    public async Task Rooms_are_unavailable_until_a_bridge_is_configured(string missing)
    {
        using var client = _factory.WithWebHostBuilder(b => b.UseSetting(missing, "")).CreateClient();

        HttpResponseMessage[] responses =
        [
            await client.GetAsync("/api/rooms"),
            await client.PutAsJsonAsync($"/api/rooms/{HueJson.LivingGroupId}", new LightChange(true, null)),
            await client.GetAsync($"/api/rooms/{HueJson.LivingGroupId}/scenes"),
            await client.PostAsync($"/api/scenes/{HueJson.RelaxSceneId}/recall", null),
            await client.GetAsync("/api/scenes"),
        ];

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode));
        Assert.Empty(Hue.Requests);
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden, "rejected the app key")]
    [InlineData(HttpStatusCode.Unauthorized, "rejected the app key")]
    [InlineData(HttpStatusCode.ServiceUnavailable, "answered 503")]
    public async Task Rooms_report_bridge_errors_as_a_bad_gateway(HttpStatusCode status, string message)
    {
        Hue.ServeHome();
        Hue.Serve(HttpMethod.Get, HueJson.RoomsUrl, "{}", status);

        var response = await _client.GetAsync("/api/rooms");

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Contains(message, await response.Content.ReadAsStringAsync());
    }

    public static TheoryData<Exception> NetworkErrors => [new HttpRequestException("No route to host"), new TaskCanceledException("Timed out")];

    [Theory]
    [MemberData(nameof(NetworkErrors))]
    public async Task Rooms_report_an_unreachable_bridge_as_a_bad_gateway(Exception error)
    {
        Hue.ServeHome();
        Hue.Throw(HttpMethod.Get, HueJson.LightsUrl, error);

        var response = await _client.GetAsync("/api/rooms");

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Contains("Couldn't reach the Hue bridge", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Rooms_report_an_empty_answer_as_a_bad_gateway()
    {
        Hue.ServeHome();
        Hue.Serve(HttpMethod.Get, HueJson.GroupsUrl, "null");

        var response = await _client.GetAsync("/api/rooms");

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
    }

    [Theory]
    [InlineData(true, null, """{"on":{"on":true}}""")]
    [InlineData(false, null, """{"on":{"on":false}}""")]
    [InlineData(null, 40, """{"dimming":{"brightness":40}}""")]
    [InlineData(true, 100, """{"on":{"on":true},"dimming":{"brightness":100}}""")]
    public async Task Changing_a_room_sends_only_the_requested_changes_to_its_light_group(bool? on, int? brightness, string expected)
    {
        Hue.Serve(HttpMethod.Put, LivingGroupUrl, HueJson.Updated(HueJson.LivingGroupId, "grouped_light"));

        var response = await _client.PutAsJsonAsync($"/api/rooms/{HueJson.LivingGroupId}", new LightChange(on, brightness));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var request = Assert.Single(Hue.Requests);
        Assert.Equal((HttpMethod.Put, LivingGroupUrl, FakeHueBridge.AppKey, expected), (request.Method, request.Url, request.AppKey, request.Body));
    }

    [Theory]
    [InlineData(2700, """{"color_temperature":{"mirek":370}}""")]
    [InlineData(6500, """{"color_temperature":{"mirek":154}}""")]
    public async Task Changing_a_room_sets_a_white_in_kelvin(int kelvin, string expected)
    {
        Hue.Serve(HttpMethod.Put, LivingGroupUrl, HueJson.Updated(HueJson.LivingGroupId, "grouped_light"));

        var response = await _client.PutAsJsonAsync($"/api/rooms/{HueJson.LivingGroupId}", new LightChange(null, null, Temperature: kelvin));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(expected, Assert.Single(Hue.Requests).Body);
    }

    [Fact]
    public async Task Changing_a_room_sets_a_colour_as_an_xy_point()
    {
        Hue.Serve(HttpMethod.Put, LivingGroupUrl, HueJson.Updated(HueJson.LivingGroupId, "grouped_light"));
        var (x, y) = HueColor.ToXy("#FF8800");

        var response = await _client.PutAsJsonAsync($"/api/rooms/{HueJson.LivingGroupId}", new LightChange(true, null, Color: "#FF8800"));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal("""{"on":{"on":true},"color":{"xy":{"x":""" + x + ",\"y\":" + y + "}}}", Assert.Single(Hue.Requests).Body);
    }

    public static TheoryData<LightChange> InvalidChanges =>
    [
        new(null, null),
        new(true, 0),
        new(null, 101),
        new(null, null, Temperature: 1999),
        new(null, null, Temperature: 6501),
        new(null, null, Color: "orange"),
        new(null, null, Color: "#ff880"),
        new(null, null, Temperature: 2700, Color: "#ff8800"),
    ];

    [Theory]
    [MemberData(nameof(InvalidChanges))]
    public async Task Changes_must_be_something_and_in_range(LightChange change)
    {
        var response = await _client.PutAsJsonAsync($"/api/rooms/{HueJson.LivingGroupId}", change);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(Hue.Requests);
    }

    [Fact]
    public async Task Changes_return_not_found_for_rooms_the_bridge_does_not_have()
    {
        var response = await _client.PutAsJsonAsync($"/api/rooms/{Guid.NewGuid()}", new LightChange(true, null));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Single(Hue.Requests);
    }

    [Fact]
    public async Task Changes_only_accept_hue_ids()
    {
        var response = await _client.PutAsJsonAsync("/api/rooms/..%2Fbridge_home", new LightChange(true, null));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Empty(Hue.Requests);
    }

    [Fact]
    public async Task Scenes_are_the_rooms_own_by_name_with_their_colours()
    {
        Hue.ServeLivingRoomScenes();

        var scenes = await _client.GetFromJsonAsync<Scene[]>($"/api/rooms/{HueJson.LivingGroupId}/scenes");

        Assert.Equal(["Party", "Relax"], scenes!.Select(s => s.Name));
        Assert.Equal(HueJson.RelaxSceneId, scenes[1].Id);
        // Lights the scene turns off don't count, and each colour shows once.
        Assert.Equal([HueColor.FromXy(0.6915, 0.3083), HueColor.FromXy(0.1532, 0.0475)], scenes[0].Colors);
        Assert.Equal(["#ff942c"], scenes[1].Colors);
    }

    [Fact]
    public async Task All_scenes_are_listed_by_room_without_the_zones()
    {
        Hue.Serve(HttpMethod.Get, HueJson.RoomsUrl, HueJson.Rooms);
        Hue.Serve(HttpMethod.Get, HueJson.ScenesUrl, HueJson.Scenes);

        var scenes = await _client.GetFromJsonAsync<RoomScene[]>("/api/scenes");

        Assert.Equal(
            [("Kitchen", "Read"), ("Living room", "Party"), ("Living room", "Relax")],
            scenes!.Select(s => (s.Room, s.Name)));
        Assert.Equal(HueJson.RelaxSceneId, scenes[2].Id);
        Assert.Equal(["#ff942c"], scenes[2].Colors);
    }

    [Fact]
    public async Task Scenes_return_not_found_for_rooms_the_bridge_does_not_have()
    {
        Hue.ServeLivingRoomScenes();

        var response = await _client.GetAsync($"/api/rooms/{Guid.NewGuid()}/scenes");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Recalling_a_scene_activates_it()
    {
        var url = $"{HueJson.ScenesUrl}/{HueJson.RelaxSceneId}";
        Hue.Serve(HttpMethod.Put, url, HueJson.Updated(HueJson.RelaxSceneId, "scene"));

        var response = await _client.PostAsync($"/api/scenes/{HueJson.RelaxSceneId}/recall", null);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var request = Assert.Single(Hue.Requests);
        Assert.Equal((HttpMethod.Put, url, """{"recall":{"action":"active"}}"""), (request.Method, request.Url, request.Body));
    }

    [Fact]
    public async Task Recalling_returns_not_found_for_scenes_the_bridge_does_not_have()
    {
        var response = await _client.PostAsync($"/api/scenes/{Guid.NewGuid()}/recall", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Changes_report_bridge_errors_as_a_bad_gateway()
    {
        Hue.Serve(HttpMethod.Put, LivingGroupUrl, "{}", HttpStatusCode.InternalServerError);

        var response = await _client.PutAsJsonAsync($"/api/rooms/{HueJson.LivingGroupId}", new LightChange(false, null));

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
    }
}
