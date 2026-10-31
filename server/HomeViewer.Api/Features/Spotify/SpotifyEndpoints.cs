namespace HomeViewer.Api;

public static class SpotifyEndpoints
{
    public static IServiceCollection AddSpotify(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<SpotifyOptions>(configuration.GetSection("Spotify"));
        services.AddHttpClient(nameof(Spotify), http => http.Timeout = TimeSpan.FromSeconds(10));
        // The account's login is kept next to the settings, in the data folder that stays out of git.
        services.AddSingleton(sp => new SpotifyLogin(sp.GetRequiredService<DataFolder>().PathOf("spotify.json")));
        return services.AddSingleton<Spotify>();
    }

    public static IEndpointRouteBuilder MapSpotifyEndpoints(this IEndpointRouteBuilder app)
    {
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

        return app;
    }

    private static Task<IResult> SpotifyCommand(Spotify spotify, Func<Task> command) =>
        CallSpotify(spotify, async () =>
        {
            await command();
            return Results.NoContent();
        });

    // 503: not set up. 409: nothing to play on, or the account isn't connected; the dashboard explains these.
    // 502: Spotify couldn't be reached or failed.
    private static async Task<IResult> CallSpotify(Spotify spotify, Func<Task<IResult>> call)
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
}
