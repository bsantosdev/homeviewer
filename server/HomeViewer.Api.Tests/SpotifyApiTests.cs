using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Web;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace HomeViewer.Api.Tests;

public sealed class SpotifyApiTests : IAsyncLifetime
{
    private readonly HomeViewerFactory _factory = new();
    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2026, 10, 29, 18, 0, 0, TimeSpan.Zero));
    private WebApplicationFactory<Program> _app = null!;
    private HttpClient _client = null!;

    private FakeSpotify Spotify => _factory.SpotifyWeb;
    private string LoginPath => Path.Combine(_factory.Root, "spotify.json");

    public Task InitializeAsync()
    {
        // Connected, unless a test deletes this before its first request.
        Directory.CreateDirectory(_factory.Root);
        File.WriteAllText(LoginPath, $$"""{ "RefreshToken": "{{FakeSpotify.RefreshToken}}" }""");
        Spotify.ServeTokens();
        Spotify.Serve(HttpMethod.Get, FakeSpotify.PlaybackUrl, null, HttpStatusCode.NoContent);
        _app = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<TimeProvider>(_time)));
        // Redirects are checked, not followed.
        _client = _app.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        await _factory.DisposeAsync();
    }

    private async Task<SpotifyStatus> Status()
    {
        var response = await _client.GetAsync("/api/spotify");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SpotifyStatus>())!;
    }

    private static async Task<string?> ErrorCode(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<ApiError>())?.Code;

    [Fact]
    public async Task Everything_is_unavailable_until_a_client_id_is_configured()
    {
        using var client = _app.WithWebHostBuilder(b => b.UseSetting("Spotify:ClientId", "")).CreateClient(
            new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        HttpResponseMessage[] responses =
        [
            await client.GetAsync("/api/spotify"),
            await client.GetAsync("/api/spotify/login"),
            await client.GetAsync("/api/spotify/devices"),
            await client.GetAsync("/api/spotify/playlists"),
            await client.PostAsync("/api/spotify/pause", null),
        ];

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode));
        Assert.Empty(Spotify.Requests);
    }

    [Fact]
    public async Task Without_an_account_it_says_so_and_turns_commands_down()
    {
        File.Delete(LoginPath);

        Assert.Equal(new SpotifyStatus(false, null), await Status());
        var response = await _client.PostAsync("/api/spotify/next", null);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("spotifyNotConnected", await ErrorCode(response));
        Assert.Empty(Spotify.Requests);
    }

    [Fact]
    public async Task Logging_in_sends_the_browser_to_Spotify_and_keeps_the_account()
    {
        File.Delete(LoginPath);
        Spotify.ServeTokens(refreshToken: "new-refresh-token");

        var login = await _client.GetAsync("/api/spotify/login");

        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        var authorize = login.Headers.Location!;
        Assert.Equal($"{HomeViewer.Api.Spotify.AccountsUrl}/authorize", authorize.GetLeftPart(UriPartial.Path));
        var query = HttpUtility.ParseQueryString(authorize.Query);
        Assert.Equal(FakeSpotify.ClientId, query["client_id"]);
        Assert.Equal("code", query["response_type"]);
        Assert.Equal("http://127.0.0.1:5000/api/spotify/callback", query["redirect_uri"]);
        Assert.Equal(HomeViewer.Api.Spotify.Scopes, query["scope"]);
        Assert.Equal("S256", query["code_challenge_method"]);

        var callback = await _client.GetAsync($"/api/spotify/callback?code=the-code&state={Uri.EscapeDataString(query["state"]!)}");

        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal("/admin", callback.Headers.Location!.ToString());
        // The verifier sent with the code is the one the challenge was made from.
        var form = HttpUtility.ParseQueryString(Spotify.To(FakeSpotify.TokenUrl).Single().Body!);
        Assert.Equal("authorization_code", form["grant_type"]);
        Assert.Equal("the-code", form["code"]);
        Assert.Equal("http://127.0.0.1:5000/api/spotify/callback", form["redirect_uri"]);
        Assert.Equal(FakeSpotify.ClientId, form["client_id"]);
        var challenge = Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(form["code_verifier"]!)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        Assert.Equal(challenge, query["code_challenge"]);
        Assert.Contains("new-refresh-token", await File.ReadAllTextAsync(LoginPath));
        Assert.True((await Status()).Connected);
    }

    [Fact]
    public async Task The_login_can_only_finish_once_and_only_if_started_here()
    {
        File.Delete(LoginPath);
        var state = HttpUtility.ParseQueryString((await _client.GetAsync("/api/spotify/login")).Headers.Location!.Query)["state"];

        var wrongState = await _client.GetAsync("/api/spotify/callback?code=the-code&state=other");
        var noCode = await _client.GetAsync($"/api/spotify/callback?state={state}");
        var first = await _client.GetAsync($"/api/spotify/callback?code=the-code&state={state}");
        var again = await _client.GetAsync($"/api/spotify/callback?code=the-code&state={state}");

        Assert.Equal(HttpStatusCode.BadRequest, wrongState.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, noCode.StatusCode);
        Assert.Equal(HttpStatusCode.Redirect, first.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);
        Assert.Single(Spotify.To(FakeSpotify.TokenUrl));
    }

    [Fact]
    public async Task Saying_no_on_Spotify_goes_back_to_the_settings()
    {
        File.Delete(LoginPath);

        var response = await _client.GetAsync("/api/spotify/callback?error=access_denied&state=x");

        Assert.Equal("/admin", response.Headers.Location!.ToString());
        Assert.False(File.Exists(LoginPath));
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, "didn't accept the login")]
    [InlineData(HttpStatusCode.InternalServerError, "login answered 500")]
    public async Task A_login_Spotify_turns_down_is_a_bad_gateway(HttpStatusCode status, string message)
    {
        File.Delete(LoginPath);
        Spotify.Serve(HttpMethod.Post, FakeSpotify.TokenUrl, """{ "error": "invalid_grant" }""", status);
        var state = HttpUtility.ParseQueryString((await _client.GetAsync("/api/spotify/login")).Headers.Location!.Query)["state"];

        var response = await _client.GetAsync($"/api/spotify/callback?code=the-code&state={state}");

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Contains(message, await response.Content.ReadAsStringAsync());
        Assert.False(File.Exists(LoginPath));
    }

    [Fact]
    public async Task Disconnecting_forgets_the_account()
    {
        await Status();

        var response = await _client.DeleteAsync("/api/spotify/login");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.False(File.Exists(LoginPath));
        Assert.False((await Status()).Connected);
    }

    [Fact]
    public async Task Shows_the_song_playing_its_cover_and_where()
    {
        Spotify.Serve(HttpMethod.Get, FakeSpotify.PlaybackUrl, SpotifyJson.PlayingSong);

        var status = await Status();

        Assert.True(status.Connected);
        Assert.Equal(
            new Playback(
                true,
                61000,
                new PlayingItem("Morning Song", "First Artist, Second Artist", "Sunrise", "https://i.scdn.co/image/medium", 215000),
                new SpotifyDevice(SpotifyJson.SpeakerId, "Living room speaker", "Speaker", true, 35)),
            status.Playback);
    }

    [Fact]
    public async Task Shows_a_podcast_episode_by_its_show()
    {
        Spotify.Serve(HttpMethod.Get, FakeSpotify.PlaybackUrl, SpotifyJson.PausedEpisode);

        var playback = (await Status()).Playback!;

        Assert.False(playback.IsPlaying);
        Assert.Equal(new PlayingItem("Episode 12", "A Podcast", null, "https://i.scdn.co/image/episode", 3600000), playback.Item);
        // The phone's volume can't be changed from here.
        Assert.Null(playback.Device!.Volume);
    }

    [Fact]
    public async Task During_an_ad_there_is_nothing_to_show_but_that_it_plays()
    {
        Spotify.Serve(HttpMethod.Get, FakeSpotify.PlaybackUrl, SpotifyJson.Ad);

        Assert.Equal(new Playback(true, 0, null, null), (await Status()).Playback);
    }

    [Fact]
    public async Task Nothing_playing_anywhere_is_no_playback()
    {
        Spotify.Serve(HttpMethod.Get, FakeSpotify.PlaybackUrl, null, HttpStatusCode.NoContent);

        Assert.Equal(new SpotifyStatus(true, null), await Status());
    }

    [Fact]
    public async Task Calls_Spotify_with_an_access_token_from_the_refresh_token()
    {
        Spotify.Serve(HttpMethod.Get, FakeSpotify.PlaybackUrl, SpotifyJson.PlayingSong);

        await Status();

        var form = HttpUtility.ParseQueryString(Spotify.To(FakeSpotify.TokenUrl).Single().Body!);
        Assert.Equal("refresh_token", form["grant_type"]);
        Assert.Equal(FakeSpotify.RefreshToken, form["refresh_token"]);
        Assert.Equal(FakeSpotify.ClientId, form["client_id"]);
        Assert.Equal("Bearer access-1", Spotify.To(FakeSpotify.PlaybackUrl).Single().Authorization);
    }

    [Fact]
    public async Task Keeps_the_access_token_until_shortly_before_it_runs_out()
    {
        Spotify.Serve(HttpMethod.Get, FakeSpotify.PlaybackUrl, SpotifyJson.PlayingSong);
        await Status();
        _time.Now += TimeSpan.FromMinutes(58);
        await Status();
        Spotify.ServeTokens("access-2", refreshToken: "rotated-refresh-token");

        _time.Now += TimeSpan.FromMinutes(1.5);
        await Status();

        Assert.Equal(2, Spotify.To(FakeSpotify.TokenUrl).Count());
        Assert.Equal(
            ["Bearer access-1", "Bearer access-1", "Bearer access-2"],
            Spotify.To(FakeSpotify.PlaybackUrl).Select(r => r.Authorization));
        // Spotify can hand out a new refresh token, which replaces the old one.
        Assert.Contains("rotated-refresh-token", await File.ReadAllTextAsync(LoginPath));
    }

    [Fact]
    public async Task Every_screen_shares_what_is_playing_for_a_few_seconds()
    {
        Spotify.Serve(HttpMethod.Get, FakeSpotify.PlaybackUrl, SpotifyJson.PlayingSong);

        await Status();
        _time.Now += TimeSpan.FromSeconds(2);
        await Status();
        Assert.Single(Spotify.To(FakeSpotify.PlaybackUrl));

        _time.Now += TimeSpan.FromSeconds(1);
        await Status();
        Assert.Equal(2, Spotify.To(FakeSpotify.PlaybackUrl).Count());
    }

    [Fact]
    public async Task A_command_shows_its_effect_straight_away()
    {
        Spotify.Serve(HttpMethod.Get, FakeSpotify.PlaybackUrl, SpotifyJson.PlayingSong);
        Spotify.Serve(HttpMethod.Put, $"{FakeSpotify.PlayerUrl}/pause", null, HttpStatusCode.NoContent);

        await Status();
        await _client.PostAsync("/api/spotify/pause", null);
        await Status();

        Assert.Equal(2, Spotify.To(FakeSpotify.PlaybackUrl).Count());
    }

    public static TheoryData<string, HttpMethod, string, object?, HttpMethod, string, string> Commands => new()
    {
        { "resume", HttpMethod.Post, "/api/spotify/play", null, HttpMethod.Put, "/play", "" },
        { "resume, empty body", HttpMethod.Post, "/api/spotify/play", new { }, HttpMethod.Put, "/play", "" },
        {
            "playlist", HttpMethod.Post, "/api/spotify/play", new PlayRequest("spotify:playlist:1a2b3c", null),
            HttpMethod.Put, "/play", """{"context_uri":"spotify:playlist:1a2b3c"}"""
        },
        {
            "playlist on a device", HttpMethod.Post, "/api/spotify/play", new PlayRequest("spotify:album:9z8y", SpotifyJson.PhoneId),
            HttpMethod.Put, $"/play?device_id={SpotifyJson.PhoneId}", """{"context_uri":"spotify:album:9z8y"}"""
        },
        { "pause", HttpMethod.Post, "/api/spotify/pause", null, HttpMethod.Put, "/pause", "" },
        { "next", HttpMethod.Post, "/api/spotify/next", null, HttpMethod.Post, "/next", "" },
        { "previous", HttpMethod.Post, "/api/spotify/previous", null, HttpMethod.Post, "/previous", "" },
        { "volume", HttpMethod.Put, "/api/spotify/volume", new VolumeChange(40), HttpMethod.Put, "/volume?volume_percent=40", "" },
        {
            "device", HttpMethod.Put, "/api/spotify/device", new DeviceChange(SpotifyJson.PhoneId),
            HttpMethod.Put, "", $$"""{"device_ids":["{{SpotifyJson.PhoneId}}"],"play":true}"""
        },
    };

    [Theory]
    [MemberData(nameof(Commands))]
    public async Task Commands_go_to_the_player(
        string name, HttpMethod method, string path, object? body, HttpMethod spotifyMethod, string spotifyPath, string spotifyBody)
    {
        _ = name;
        var url = FakeSpotify.PlayerUrl + spotifyPath;
        Spotify.Serve(spotifyMethod, url, null, HttpStatusCode.NoContent);

        var response = await _client.SendAsync(new HttpRequestMessage(method, path)
        {
            Content = body is null ? null : JsonContent.Create(body),
        });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var sent = Spotify.To(url).Single();
        Assert.Equal(spotifyMethod, sent.Method);
        Assert.Equal("Bearer access-1", sent.Authorization);
        Assert.Equal(spotifyBody, sent.Body);
    }

    public static TheoryData<HttpMethod, string, object> BadCommands => new()
    {
        { HttpMethod.Post, "/api/spotify/play", new PlayRequest("https://open.spotify.com/playlist/1a2b3c", null) },
        { HttpMethod.Post, "/api/spotify/play", new PlayRequest(null, "not a device") },
        { HttpMethod.Put, "/api/spotify/volume", new VolumeChange(101) },
        { HttpMethod.Put, "/api/spotify/volume", new VolumeChange(-1) },
        { HttpMethod.Put, "/api/spotify/device", new DeviceChange(null) },
        { HttpMethod.Put, "/api/spotify/device", new DeviceChange("../me") },
    };

    [Theory]
    [MemberData(nameof(BadCommands))]
    public async Task Malformed_commands_are_turned_down(HttpMethod method, string path, object body)
    {
        var response = await _client.SendAsync(new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(Spotify.Requests);
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound, "spotifyNoDevice")]
    [InlineData(HttpStatusCode.Forbidden, "spotifyRefused")]
    public async Task Commands_Spotify_cannot_carry_out_say_why(HttpStatusCode status, string code)
    {
        Spotify.Serve(HttpMethod.Post, $"{FakeSpotify.PlayerUrl}/next", """{ "error": { "status": 404 } }""", status);

        var response = await _client.PostAsync("/api/spotify/next", null);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(code, await ErrorCode(response));
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError, "answered 500")]
    [InlineData(HttpStatusCode.NotFound, "answered 404")]
    public async Task Spotify_errors_are_a_bad_gateway(HttpStatusCode status, string message)
    {
        Spotify.Serve(HttpMethod.Get, FakeSpotify.PlaybackUrl, "{}", status);

        var response = await _client.GetAsync("/api/spotify");

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Contains(message, await response.Content.ReadAsStringAsync());
    }

    public static TheoryData<Exception> NetworkErrors => [new HttpRequestException("No route to host"), new TaskCanceledException("Timed out")];

    [Theory]
    [MemberData(nameof(NetworkErrors))]
    public async Task An_unreachable_Spotify_is_a_bad_gateway(Exception error)
    {
        Spotify.Throw(HttpMethod.Get, FakeSpotify.PlaybackUrl, error);

        var response = await _client.GetAsync("/api/spotify");

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Contains("Couldn't reach Spotify", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task An_empty_answer_is_a_bad_gateway()
    {
        Spotify.Serve(HttpMethod.Get, FakeSpotify.PlaybackUrl, "null");

        var response = await _client.GetAsync("/api/spotify");

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Contains("empty response", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Waits_as_long_as_Spotify_asks_before_calling_again()
    {
        Spotify.Responses[(HttpMethod.Get, FakeSpotify.PlaybackUrl)] = () =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
            response.Headers.RetryAfter = new(TimeSpan.FromSeconds(10));
            return response;
        };

        var first = await _client.GetAsync("/api/spotify");
        _time.Now += TimeSpan.FromSeconds(9);
        var meanwhile = await _client.GetAsync("/api/spotify");
        Spotify.Serve(HttpMethod.Get, FakeSpotify.PlaybackUrl, SpotifyJson.PlayingSong);
        _time.Now += TimeSpan.FromSeconds(1);
        var after = await Status();

        Assert.Equal(HttpStatusCode.BadGateway, first.StatusCode);
        Assert.Equal(HttpStatusCode.BadGateway, meanwhile.StatusCode);
        Assert.Contains("asked to wait", await meanwhile.Content.ReadAsStringAsync());
        Assert.Equal(2, Spotify.To(FakeSpotify.PlaybackUrl).Count());
        Assert.NotNull(after.Playback);
    }

    [Fact]
    public async Task Waits_half_a_minute_when_Spotify_does_not_say_how_long()
    {
        Spotify.Serve(HttpMethod.Get, FakeSpotify.PlaybackUrl, "{}", HttpStatusCode.TooManyRequests);

        await _client.GetAsync("/api/spotify");
        _time.Now += TimeSpan.FromSeconds(29);
        await _client.GetAsync("/api/spotify");
        _time.Now += TimeSpan.FromSeconds(1);
        await _client.GetAsync("/api/spotify");

        Assert.Equal(2, Spotify.To(FakeSpotify.PlaybackUrl).Count());
    }

    [Fact]
    public async Task A_revoked_access_token_is_replaced_on_the_next_call()
    {
        Spotify.Serve(HttpMethod.Get, FakeSpotify.PlaybackUrl, "{}", HttpStatusCode.Unauthorized);
        var response = await _client.GetAsync("/api/spotify");
        Spotify.Serve(HttpMethod.Get, FakeSpotify.PlaybackUrl, SpotifyJson.PlayingSong);

        await Status();

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Equal(2, Spotify.To(FakeSpotify.TokenUrl).Count());
    }

    [Fact]
    public async Task A_refresh_token_Spotify_no_longer_accepts_disconnects_the_account()
    {
        Spotify.Serve(HttpMethod.Post, FakeSpotify.TokenUrl, """{ "error": "invalid_grant" }""", HttpStatusCode.BadRequest);

        var response = await _client.GetAsync("/api/spotify");

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Contains("Connect the account again", await response.Content.ReadAsStringAsync());
        Assert.False(File.Exists(LoginPath));
        Assert.False((await Status()).Connected);
    }

    [Fact]
    public async Task Lists_the_devices_that_can_be_controlled_by_name()
    {
        Spotify.Serve(HttpMethod.Get, $"{FakeSpotify.PlayerUrl}/devices", SpotifyJson.Devices);

        var devices = await _client.GetFromJsonAsync<SpotifyDevice[]>("/api/spotify/devices");

        Assert.Equal(
            [
                new SpotifyDevice(SpotifyJson.PhoneId, "Kitchen phone", "Smartphone", false, null),
                new SpotifyDevice(SpotifyJson.SpeakerId, "Living room speaker", "Speaker", true, 35),
            ],
            devices!);
    }

    [Fact]
    public async Task Lists_the_playlists_with_their_covers()
    {
        Spotify.Serve(HttpMethod.Get, $"{HomeViewer.Api.Spotify.ApiUrl}/me/playlists?limit=24", SpotifyJson.Playlists);

        var playlists = await _client.GetFromJsonAsync<Playlist[]>("/api/spotify/playlists");

        Assert.Equal(
            [
                new Playlist("spotify:playlist:1a2b3c", "Dinner", "https://mosaic.scdn.co/300/dinner"),
                new Playlist("spotify:playlist:4d5e6f", "Focus", "https://image-cdn.spotifycdn.com/focus"),
                new Playlist("spotify:playlist:7g8h9i", "Empty", null),
            ],
            playlists!);
    }

    [Fact]
    public async Task The_login_file_holds_only_the_refresh_token()
    {
        File.Delete(LoginPath);
        var state = HttpUtility.ParseQueryString((await _client.GetAsync("/api/spotify/login")).Headers.Location!.Query)["state"];
        Spotify.ServeTokens(refreshToken: "saved-refresh-token");

        await _client.GetAsync($"/api/spotify/callback?code=the-code&state={state}");

        using var saved = JsonDocument.Parse(await File.ReadAllTextAsync(LoginPath));
        Assert.Equal(["RefreshToken"], saved.RootElement.EnumerateObject().Select(p => p.Name));
    }
}
