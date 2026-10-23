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

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/settings", (SettingsStore store) => store.Get());

app.MapPut("/api/settings", async (DashboardSettings settings, SettingsStore store, IHubContext<DashboardHub> hub) =>
{
    store.Save(settings);
    await hub.Clients.All.SendAsync("SettingsUpdated", settings);
    return Results.Ok(settings);
});

app.MapHub<DashboardHub>("/hubs/dashboard");
app.MapFallbackToFile("index.html");

app.Run();

// Lets the test project start the app with WebApplicationFactory<Program>.
public partial class Program;
