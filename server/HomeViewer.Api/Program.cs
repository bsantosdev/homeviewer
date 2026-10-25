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

app.MapHub<DashboardHub>("/hubs/dashboard");
app.MapFallbackToFile("index.html", staticFiles);

app.Run();

// Lets the test project start the app with WebApplicationFactory<Program>.
public partial class Program;
