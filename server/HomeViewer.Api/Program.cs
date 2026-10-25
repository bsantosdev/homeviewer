using HomeViewer.Api;
using Microsoft.AspNetCore.SignalR;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton(sp =>
{
    // Relative paths are resolved against the content root; tests point this at a temp file.
    var path = sp.GetRequiredService<IConfiguration>().GetValue("SettingsPath", "data/settings.json");
    return new SettingsStore(Path.Combine(builder.Environment.ContentRootPath, path));
});
builder.Services.AddSignalR();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpClient(nameof(CalendarFeedReader), http => http.Timeout = TimeSpan.FromSeconds(20));
builder.Services.AddSingleton<CalendarFeedReader>();
builder.Services.Configure<HueOptions>(builder.Configuration.GetSection("Hue"));
builder.Services.AddHttpClient(nameof(HueBridge), http => http.Timeout = TimeSpan.FromSeconds(5))
    // The bridge serves HTTPS with its own self-signed certificate, which nothing else trusts.
    // This client only ever talks to the configured bridge on the home network.
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
    });
builder.Services.AddSingleton<HueBridge>();

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

app.MapPut("/api/settings", async (DashboardSettings settings, SettingsStore store, IHubContext<DashboardHub> hub) =>
{
    if (settings.Calendars.FirstOrDefault(c => !c.HasValidUrl) is { } noLink)
        return Results.BadRequest($"Calendar \"{noLink.Name}\" needs an https:// or webcal:// link.");
    if (settings.Calendars.FirstOrDefault(c => !c.HasValidColor) is { } noColor)
        return Results.BadRequest($"Calendar \"{noColor.Name}\" needs a colour like #3b82f6.");

    store.Save(settings);
    await hub.Clients.All.SendAsync("SettingsUpdated", settings);
    return Results.Ok(settings);
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

app.MapPost("/api/scenes/{id:guid}/recall", (Guid id, HueBridge hue, CancellationToken cancellationToken) =>
    CallHue(hue, null, async () =>
        await hue.RecallSceneAsync(id, cancellationToken) ? Results.NoContent() : Results.NotFound()));

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

// Lets the test project start the app with WebApplicationFactory<Program>.
public partial class Program;
