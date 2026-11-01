namespace HomeViewer.Api;

public static class BackgroundEndpoints
{
    // Background images live in a folder next to the settings file.
    public static IServiceCollection AddBackgrounds(this IServiceCollection services) =>
        services.AddSingleton(sp => new BackgroundStore(sp.GetRequiredService<DataFolder>().PathOf("backgrounds")));

    public static IEndpointRouteBuilder MapBackgroundEndpoints(this IEndpointRouteBuilder app)
    {
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

        return app;
    }
}
