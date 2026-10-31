using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace HomeViewer.Api;

/// <summary>The app registered in Spotify's developer dashboard. Read from the "Spotify" config section.</summary>
public class SpotifyOptions
{
    /// <summary>The app's Client ID. The login uses PKCE, so there's no client secret.</summary>
    public string ClientId { get; set; } = "";

    /// <summary>
    /// Where Spotify sends the browser back after the login, exactly as registered with the app. Spotify only
    /// accepts https or a loopback address, so by default the login has to happen on the server's own computer.
    /// </summary>
    public string RedirectUri { get; set; } = "http://127.0.0.1:5000/api/spotify/callback";
}

/// <summary>Whether an account is connected, and what it's playing.</summary>
/// <param name="Playback">Null while no device is playing or paused.</param>
public record SpotifyStatus(bool Connected, Playback? Playback);

/// <param name="ProgressMs">How far into the item, when Spotify was asked.</param>
/// <param name="Item">Null while Spotify can't say, e.g. during an ad.</param>
public record Playback(bool IsPlaying, int ProgressMs, PlayingItem? Item, SpotifyDevice? Device);

/// <summary>A song, or a podcast episode.</summary>
/// <param name="By">The artists, or the podcast.</param>
/// <param name="Image">The cover, about 300 pixels wide.</param>
public record PlayingItem(string Name, string By, string? Album, string? Image, int DurationMs);

/// <summary>Somewhere Spotify can play: a speaker, phone, computer or TV.</summary>
/// <param name="Volume">Null if it can't be changed remotely.</param>
public record SpotifyDevice(string Id, string Name, string Type, bool IsActive, int? Volume);

/// <param name="Uri">What to play it with, e.g. "spotify:playlist:…".</param>
public record Playlist(string Uri, string Name, string? Image);

/// <summary>Resumes, or plays a playlist or album. Without a device, plays on the active one.</summary>
public partial record PlayRequest(string? ContextUri, string? DeviceId)
{
    public bool IsValid =>
        (ContextUri is null || ContextUriPattern().IsMatch(ContextUri))
        && (DeviceId is null || DeviceIdPattern().IsMatch(DeviceId));

    [GeneratedRegex("^spotify:(playlist|album|artist|show):[A-Za-z0-9]+\\z", RegexOptions.None, matchTimeoutMilliseconds: 100)]
    private static partial Regex ContextUriPattern();

    [GeneratedRegex("^[A-Za-z0-9]{1,100}\\z", RegexOptions.None, matchTimeoutMilliseconds: 100)]
    internal static partial Regex DeviceIdPattern();
}

public record VolumeChange(int Percent)
{
    public bool IsValid => Percent is >= 0 and <= 100;
}

/// <summary>Moves playback to another device, and keeps it playing there.</summary>
public record DeviceChange(string? Id)
{
    public bool IsValid => Id is not null && PlayRequest.DeviceIdPattern().IsMatch(Id);
}

public class SpotifyException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Spotify has nowhere to play: no device has Spotify open, or the chosen one went away.</summary>
public class SpotifyNoDeviceException() : SpotifyException("No Spotify device is active.");

/// <summary>Spotify turned the command down, e.g. skipping while an ad plays.</summary>
public class SpotifyRefusedException() : SpotifyException("Spotify refused the command.");

/// <summary>
/// The account's long-lived login, kept in a JSON file next to the settings. It's a password in all but name,
/// so it stays in the data folder and never reaches the browser.
/// </summary>
public class SpotifyLogin(string path)
{
    private readonly Lock _lock = new();
    private string? _refreshToken = Load(path);

    public string? RefreshToken
    {
        get
        {
            lock (_lock) return _refreshToken;
        }
    }

    /// <summary>Keeps a new token, or forgets the account with null.</summary>
    public void Save(string? refreshToken)
    {
        lock (_lock)
        {
            _refreshToken = refreshToken;
            if (refreshToken is null)
            {
                File.Delete(path);
                return;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(new Stored(refreshToken)));
        }
    }

    private static string? Load(string path) =>
        File.Exists(path) ? JsonSerializer.Deserialize<Stored>(File.ReadAllText(path))?.RefreshToken : null;

    private record Stored(string RefreshToken);
}

/// <summary>Logs in to one Spotify account, and reads and controls what it plays through the Web API.</summary>
public class Spotify(
    IHttpClientFactory httpFactory, IOptionsMonitor<SpotifyOptions> options, SpotifyLogin login, TimeProvider time)
{
    public const string AccountsUrl = "https://accounts.spotify.com";
    public const string ApiUrl = "https://api.spotify.com/v1";

    /// <summary>What the dashboard needs: reading playback and devices, controlling them, and listing playlists.</summary>
    public const string Scopes =
        "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private";

    /// <summary>
    /// Every screen asks what's playing every few seconds, and Spotify counts calls per developer account, so
    /// the answer is shared for this long.
    /// </summary>
    public static readonly TimeSpan PlaybackCacheTime = TimeSpan.FromSeconds(3);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private readonly Lock _lock = new();
    private (string State, string Verifier)? _pendingLogin;
    private (string Token, DateTimeOffset Expires)? _accessToken;
    private (Playback? Playback, DateTimeOffset At)? _cachedPlayback;
    private DateTimeOffset _quietUntil;

    public bool IsConfigured => options.CurrentValue.ClientId != "";

    public bool IsConnected => login.RefreshToken is not null;

    /// <summary>Where to send the browser to log in. Only the latest login can finish.</summary>
    public string StartLogin()
    {
        var verifier = Base64Url(RandomNumberGenerator.GetBytes(64));
        var state = Base64Url(RandomNumberGenerator.GetBytes(16));
        lock (_lock) _pendingLogin = (state, verifier);
        var settings = options.CurrentValue;
        return $"{AccountsUrl}/authorize?" + Query(
            ("client_id", settings.ClientId),
            ("response_type", "code"),
            ("redirect_uri", settings.RedirectUri),
            ("scope", Scopes),
            ("state", state),
            ("code_challenge_method", "S256"),
            ("code_challenge", Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)))));
    }

    /// <summary>Swaps the code Spotify sent back for the account's tokens.</summary>
    /// <returns>False if the login wasn't started here, or was started again since.</returns>
    public async Task<bool> FinishLoginAsync(string code, string state, CancellationToken cancellationToken)
    {
        string verifier;
        lock (_lock)
        {
            if (_pendingLogin is not { } pending || pending.State != state) return false;
            verifier = pending.Verifier;
            _pendingLogin = null;
        }
        var settings = options.CurrentValue;
        var tokens = await RequestTokensAsync(
            [
                new("grant_type", "authorization_code"),
                new("code", code),
                new("redirect_uri", settings.RedirectUri),
                new("client_id", settings.ClientId),
                new("code_verifier", verifier),
            ],
            cancellationToken)
            ?? throw new SpotifyException("Spotify didn't accept the login.");
        Keep(tokens);
        return true;
    }

    public void Disconnect()
    {
        login.Save(null);
        lock (_lock)
        {
            _accessToken = null;
            _cachedPlayback = null;
        }
    }

    /// <returns>Null while nothing is playing or paused anywhere.</returns>
    public async Task<Playback?> GetPlaybackAsync(CancellationToken cancellationToken)
    {
        lock (_lock)
            if (_cachedPlayback is { } cached && time.GetUtcNow() - cached.At < PlaybackCacheTime)
                return cached.Playback;

        using var response = await SendAsync(HttpMethod.Get, "/me/player?additional_types=episode", null, cancellationToken);
        var playback = response.StatusCode == HttpStatusCode.NoContent
            ? null
            : ToPlayback(await ReadAsync<ApiPlayback>(response, cancellationToken));
        lock (_lock) _cachedPlayback = (playback, time.GetUtcNow());
        return playback;
    }

    public Task PlayAsync(PlayRequest request, CancellationToken cancellationToken) =>
        CommandAsync(
            HttpMethod.Put,
            "/me/player/play" + (request.DeviceId is { } id ? "?" + Query(("device_id", id)) : ""),
            request.ContextUri is { } uri ? new ApiPlay(uri) : null,
            cancellationToken);

    public Task PauseAsync(CancellationToken cancellationToken) =>
        CommandAsync(HttpMethod.Put, "/me/player/pause", null, cancellationToken);

    public Task NextAsync(CancellationToken cancellationToken) =>
        CommandAsync(HttpMethod.Post, "/me/player/next", null, cancellationToken);

    public Task PreviousAsync(CancellationToken cancellationToken) =>
        CommandAsync(HttpMethod.Post, "/me/player/previous", null, cancellationToken);

    public Task SetVolumeAsync(int percent, CancellationToken cancellationToken) =>
        CommandAsync(HttpMethod.Put, "/me/player/volume?" + Query(("volume_percent", percent.ToString())), null, cancellationToken);

    public Task TransferAsync(string deviceId, CancellationToken cancellationToken) =>
        CommandAsync(HttpMethod.Put, "/me/player", new ApiTransfer([deviceId], Play: true), cancellationToken);

    /// <summary>Every device with Spotify open on the account, by name. Ones that can't be controlled are left out.</summary>
    public async Task<IReadOnlyList<SpotifyDevice>> GetDevicesAsync(CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Get, "/me/player/devices", null, cancellationToken);
        var body = await ReadAsync<ApiDevices>(response, cancellationToken);
        return [.. body.Devices.Select(ToDevice).OfType<SpotifyDevice>().OrderBy(d => d.Name)];
    }

    /// <summary>The account's own and followed playlists, as Spotify orders them.</summary>
    public async Task<IReadOnlyList<Playlist>> GetPlaylistsAsync(CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Get, "/me/playlists?limit=24", null, cancellationToken);
        var body = await ReadAsync<ApiPlaylists>(response, cancellationToken);
        return [.. body.Items.OfType<ApiPlaylist>().Select(p => new Playlist(p.Uri, p.Name, Cover(p.Images)))];
    }

    private async Task CommandAsync(HttpMethod method, string path, object? body, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(method, path, body, cancellationToken, isCommand: true);
        // The next read should show what the command did.
        lock (_lock) _cachedPlayback = null;
    }

    private async Task<HttpResponseMessage> SendAsync(
        HttpMethod method, string path, object? body, CancellationToken cancellationToken, bool isCommand = false)
    {
        lock (_lock)
            if (time.GetUtcNow() < _quietUntil) throw new SpotifyException("Spotify asked to wait before calling again.");

        var token = await AccessTokenAsync(cancellationToken);
        using var request = new HttpRequestMessage(method, ApiUrl + path)
        {
            // Spotify wants a length on every command, even one with nothing to send.
            Content = body is not null ? JsonContent.Create(body, options: Json)
                : method == HttpMethod.Get ? null
                : new ByteArrayContent([]),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await CallAsync(request, cancellationToken);
        if (response.IsSuccessStatusCode) return response;
        using (response)
        {
            throw response.StatusCode switch
            {
                HttpStatusCode.TooManyRequests => SlowDown(response.Headers.RetryAfter?.Delta),
                // The access token was revoked early; the next call gets a new one.
                HttpStatusCode.Unauthorized => Forget(new SpotifyException("Spotify rejected the access token.")),
                HttpStatusCode.NotFound when isCommand => new SpotifyNoDeviceException(),
                HttpStatusCode.Forbidden when isCommand => new SpotifyRefusedException(),
                _ => new SpotifyException($"Spotify answered {(int)response.StatusCode}."),
            };
        }
    }

    private SpotifyException SlowDown(TimeSpan? wait)
    {
        lock (_lock) _quietUntil = time.GetUtcNow() + (wait ?? TimeSpan.FromSeconds(30));
        return new SpotifyException("Spotify asked to wait before calling again.");
    }

    private SpotifyException Forget(SpotifyException error)
    {
        lock (_lock) _accessToken = null;
        return error;
    }

    private async Task<string> AccessTokenAsync(CancellationToken cancellationToken)
    {
        await _tokenLock.WaitAsync(cancellationToken);
        try
        {
            // Renewed a minute early, so a token doesn't run out on the way to Spotify.
            lock (_lock)
                if (_accessToken is { } current && time.GetUtcNow() < current.Expires - TimeSpan.FromMinutes(1))
                    return current.Token;

            var refreshToken = login.RefreshToken ?? throw new SpotifyException("No Spotify account is connected.");
            var tokens = await RequestTokensAsync(
                [
                    new("grant_type", "refresh_token"),
                    new("refresh_token", refreshToken),
                    new("client_id", options.CurrentValue.ClientId),
                ],
                cancellationToken);
            if (tokens is null)
            {
                // The login was revoked, or the app changed: it has to be done again.
                Disconnect();
                throw new SpotifyException("Spotify no longer accepts the login. Connect the account again.");
            }
            return Keep(tokens);
        }
        finally
        {
            _tokenLock.Release();
        }
    }

    private string Keep(ApiTokens tokens)
    {
        // Spotify may hand out a new refresh token, which replaces the old one.
        if (tokens.RefreshToken is { } refreshToken) login.Save(refreshToken);
        lock (_lock) _accessToken = (tokens.AccessToken, time.GetUtcNow() + TimeSpan.FromSeconds(tokens.ExpiresIn));
        return tokens.AccessToken;
    }

    /// <returns>Null if Spotify turned the code or refresh token down.</returns>
    private async Task<ApiTokens?> RequestTokensAsync(
        IEnumerable<KeyValuePair<string, string>> form, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{AccountsUrl}/api/token")
        {
            Content = new FormUrlEncodedContent(form),
        };
        using var response = await CallAsync(request, cancellationToken);
        if (response.StatusCode == HttpStatusCode.BadRequest) return null;
        if (!response.IsSuccessStatusCode) throw new SpotifyException($"Spotify's login answered {(int)response.StatusCode}.");
        return await ReadAsync<ApiTokens>(response, cancellationToken);
    }

    private async Task<HttpResponseMessage> CallAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        try
        {
            return await httpFactory.CreateClient(nameof(Spotify)).SendAsync(request, cancellationToken);
        }
        // A timeout surfaces as a cancellation the caller didn't ask for.
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
        {
            throw new SpotifyException("Couldn't reach Spotify.", ex);
        }
    }

    private static async Task<T> ReadAsync<T>(HttpResponseMessage response, CancellationToken cancellationToken) =>
        await response.Content.ReadFromJsonAsync<T>(Json, cancellationToken)
            ?? throw new SpotifyException("Spotify sent an empty response.");

    private static Playback ToPlayback(ApiPlayback playback) => new(
        playback.IsPlaying,
        playback.ProgressMs ?? 0,
        playback.Item is { } item
            ? new PlayingItem(
                item.Name,
                item.Show?.Name ?? string.Join(", ", (item.Artists ?? []).Select(a => a.Name)),
                item.Album?.Name,
                Cover(item.Album?.Images ?? item.Images),
                item.DurationMs)
            : null,
        playback.Device is { } device ? ToDevice(device) : null);

    // A device without an id can't be controlled from here, e.g. some cars and TVs.
    private static SpotifyDevice? ToDevice(ApiDevice device) =>
        device.Id is null
            ? null
            : new(device.Id, device.Name, device.Type, device.IsActive, device.SupportsVolume ? device.VolumePercent : null);

    // Spotify lists sizes such as 640, 300 and 64 pixels; the dashboard shows covers at about 300.
    private static string? Cover(IReadOnlyList<ApiImage>? images) =>
        images?.OrderBy(i => Math.Abs((i.Width ?? 300) - 300)).FirstOrDefault()?.Url;

    private static string Query(params (string Name, string Value)[] values) =>
        string.Join("&", values.Select(v => $"{v.Name}={Uri.EscapeDataString(v.Value)}"));

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    // The parts of Spotify's answers we use. Its fields are snake_case.
    private record ApiTokens(string AccessToken, int ExpiresIn, string? RefreshToken);

    private record ApiPlayback(bool IsPlaying, int? ProgressMs, ApiItem? Item, ApiDevice? Device);

    private record ApiItem(
        string Name, int DurationMs, IReadOnlyList<ApiNamed>? Artists, ApiAlbum? Album, ApiNamed? Show, IReadOnlyList<ApiImage>? Images);

    private record ApiNamed(string Name);

    private record ApiAlbum(string Name, IReadOnlyList<ApiImage>? Images);

    private record ApiImage(string Url, int? Width);

    private record ApiDevice(string? Id, string Name, string Type, bool IsActive, int? VolumePercent, bool SupportsVolume);

    private record ApiDevices(IReadOnlyList<ApiDevice> Devices);

    // Spotify sometimes lists a playlist it can't show any more as null.
    private record ApiPlaylists(IReadOnlyList<ApiPlaylist?> Items);

    private record ApiPlaylist(string Uri, string Name, IReadOnlyList<ApiImage>? Images);

    private record ApiPlay(string ContextUri);

    private record ApiTransfer(IReadOnlyList<string> DeviceIds, bool Play);
}
