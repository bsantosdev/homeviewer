using System.Net;
using System.Text;

namespace HomeViewer.Api.Tests;

/// <summary>Answers like Spotify's accounts service and Web API, and records what was sent to them.</summary>
public sealed class FakeSpotify : HttpMessageHandler
{
    public const string ClientId = "test-client-id";
    public const string RefreshToken = "test-refresh-token";
    public const string TokenUrl = $"{Spotify.AccountsUrl}/api/token";
    public const string PlayerUrl = $"{Spotify.ApiUrl}/me/player";
    public const string PlaybackUrl = $"{PlayerUrl}?additional_types=episode";

    public record Request(HttpMethod Method, string Url, string? Authorization, string? Body);

    public List<Request> Requests { get; } = [];

    /// <summary>The next answer, by method and URL. Anything else gets a 404.</summary>
    public Dictionary<(HttpMethod, string), Func<HttpResponseMessage>> Responses { get; } = [];

    public void Serve(HttpMethod method, string url, string? json, HttpStatusCode status = HttpStatusCode.OK) =>
        Responses[(method, url)] = () => new HttpResponseMessage(status)
        {
            Content = json is null ? null : new StringContent(json, Encoding.UTF8, "application/json"),
        };

    public void Throw(HttpMethod method, string url, Exception error) => Responses[(method, url)] = () => throw error;

    /// <summary>Hands out an access token for the refresh token, optionally with a new refresh token.</summary>
    public void ServeTokens(string accessToken = "access-1", int expiresIn = 3600, string? refreshToken = null) =>
        Serve(HttpMethod.Post, TokenUrl, $$"""
            {
              "access_token": "{{accessToken}}",
              "token_type": "Bearer",
              "scope": "{{Spotify.Scopes}}",
              "expires_in": {{expiresIn}}{{(refreshToken is null ? "" : $", \"refresh_token\": \"{refreshToken}\"")}}
            }
            """);

    public IEnumerable<Request> To(string url) => Requests.Where(r => r.Url == url);

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var url = request.RequestUri!.ToString();
        Requests.Add(new(
            request.Method,
            url,
            request.Headers.Authorization?.ToString(),
            request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken)));
        return Responses.TryGetValue((request.Method, url), out var respond)
            ? respond()
            : new HttpResponseMessage(HttpStatusCode.NotFound);
    }
}

/// <summary>Answers shaped like Spotify's, trimmed to the fields the server reads plus a few it ignores.</summary>
public static class SpotifyJson
{
    public const string SpeakerId = "a1b2c3speaker";
    public const string PhoneId = "d4e5f6phone";

    /// <summary>A song by two artists, playing on a speaker, with the cover in three sizes.</summary>
    public const string PlayingSong = $$"""
        {
          "device": {
            "id": "{{SpeakerId}}",
            "is_active": true,
            "is_private_session": false,
            "is_restricted": false,
            "name": "Living room speaker",
            "type": "Speaker",
            "volume_percent": 35,
            "supports_volume": true
          },
          "shuffle_state": false,
          "repeat_state": "off",
          "timestamp": 1761700000000,
          "progress_ms": 61000,
          "is_playing": true,
          "currently_playing_type": "track",
          "item": {
            "type": "track",
            "name": "Morning Song",
            "duration_ms": 215000,
            "artists": [{ "name": "First Artist" }, { "name": "Second Artist" }],
            "album": {
              "name": "Sunrise",
              "images": [
                { "url": "https://i.scdn.co/image/large", "height": 640, "width": 640 },
                { "url": "https://i.scdn.co/image/medium", "height": 300, "width": 300 },
                { "url": "https://i.scdn.co/image/small", "height": 64, "width": 64 }
              ]
            }
          }
        }
        """;

    /// <summary>A paused podcast episode on a phone that can't change its volume remotely.</summary>
    public const string PausedEpisode = $$"""
        {
          "device": {
            "id": "{{PhoneId}}",
            "is_active": true,
            "name": "Phone",
            "type": "Smartphone",
            "volume_percent": 100,
            "supports_volume": false
          },
          "progress_ms": 5000,
          "is_playing": false,
          "currently_playing_type": "episode",
          "item": {
            "type": "episode",
            "name": "Episode 12",
            "duration_ms": 3600000,
            "images": [{ "url": "https://i.scdn.co/image/episode", "height": 300, "width": 300 }],
            "show": { "name": "A Podcast" }
          }
        }
        """;

    /// <summary>During an ad, Spotify can't say what's playing, nor how far in.</summary>
    public const string Ad = """
        { "device": null, "progress_ms": null, "is_playing": true, "currently_playing_type": "ad", "item": null }
        """;

    /// <summary>Out of name order, with a TV that can't be controlled from here.</summary>
    public const string Devices = $$"""
        {
          "devices": [
            { "id": "{{SpeakerId}}", "is_active": true, "name": "Living room speaker", "type": "Speaker", "volume_percent": 35, "supports_volume": true },
            { "id": null, "is_active": false, "name": "TV", "type": "TV", "volume_percent": null, "supports_volume": false },
            { "id": "{{PhoneId}}", "is_active": false, "name": "Kitchen phone", "type": "Smartphone", "volume_percent": 80, "supports_volume": false }
          ]
        }
        """;

    /// <summary>A playlist with a mosaic cover in sizes, one with a single cover of unknown size, one without, and a gap.</summary>
    public const string Playlists = """
        {
          "href": "https://api.spotify.com/v1/me/playlists?limit=24",
          "limit": 24,
          "total": 4,
          "items": [
            {
              "id": "1a2b3c",
              "name": "Dinner",
              "uri": "spotify:playlist:1a2b3c",
              "images": [
                { "url": "https://mosaic.scdn.co/640/dinner", "height": 640, "width": 640 },
                { "url": "https://mosaic.scdn.co/300/dinner", "height": 300, "width": 300 }
              ],
              "items": { "href": "https://api.spotify.com/v1/playlists/1a2b3c/items", "total": 40 }
            },
            {
              "id": "4d5e6f",
              "name": "Focus",
              "uri": "spotify:playlist:4d5e6f",
              "images": [{ "url": "https://image-cdn.spotifycdn.com/focus", "height": null, "width": null }]
            },
            { "id": "7g8h9i", "name": "Empty", "uri": "spotify:playlist:7g8h9i", "images": null },
            null
          ]
        }
        """;
}
