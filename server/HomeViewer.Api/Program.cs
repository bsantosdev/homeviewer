using HomeViewer.Api;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDataFolder();
builder.Services.AddSignalR();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSettings();
builder.Services.AddBackgrounds();
builder.Services.AddCalendar();
builder.Services.AddLights(builder.Configuration);
builder.Services.AddShopping();
builder.Services.AddSpotify(builder.Configuration);

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

app.MapSettingsEndpoints();
app.MapBackgroundEndpoints();
app.MapCalendarEndpoints();
app.MapLightsEndpoints();
app.MapShoppingEndpoints();
app.MapSpotifyEndpoints();

app.MapHub<DashboardHub>("/hubs/dashboard");
app.MapFallbackToFile("index.html", staticFiles);

app.Run();

// Lets the test project start the app with WebApplicationFactory<Program>.
public partial class Program;
