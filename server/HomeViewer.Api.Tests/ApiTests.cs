using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;

namespace HomeViewer.Api.Tests;

/// <summary>
/// Runs the real app in memory, with settings and static files in a temp folder.
/// </summary>
public sealed class HomeViewerFactory : WebApplicationFactory<Program>
{
    public string Root { get; } = Path.Combine(Path.GetTempPath(), "homeviewer-tests", Guid.NewGuid().ToString());
    public string SettingsPath => Path.Combine(Root, "settings.json");
    public string WebRoot => Path.Combine(Root, "wwwroot");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        Directory.CreateDirectory(WebRoot);
        File.WriteAllText(Path.Combine(WebRoot, "index.html"), "<app-root></app-root>");
        builder.UseSetting("SettingsPath", SettingsPath);
        builder.UseWebRoot(WebRoot);
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        if (Directory.Exists(Root)) Directory.Delete(Root, recursive: true);
    }
}

public sealed class ApiTests : IAsyncLifetime
{
    private readonly HomeViewerFactory _factory = new();
    private HttpClient _client = null!;

    public Task InitializeAsync()
    {
        _client = _factory.CreateClient();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Get_returns_the_default_settings()
    {
        var settings = await _client.GetFromJsonAsync<DashboardSettings>("/api/settings");

        Assert.Equal(DashboardSettings.Default, settings);
    }

    [Fact]
    public async Task Put_saves_the_settings_to_disk()
    {
        var updated = DashboardSettings.Default with { Title = "Kitchen" };

        var response = await _client.PutAsJsonAsync("/api/settings", updated);

        response.EnsureSuccessStatusCode();
        Assert.Equal(updated, await response.Content.ReadFromJsonAsync<DashboardSettings>());
        Assert.Equal(updated, await _client.GetFromJsonAsync<DashboardSettings>("/api/settings"));
        Assert.Contains("Kitchen", await File.ReadAllTextAsync(_factory.SettingsPath));
    }

    [Fact]
    public async Task Put_pushes_the_settings_to_connected_dashboards()
    {
        var server = _factory.Server;
        await using var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(server.BaseAddress, "/hubs/dashboard"), options =>
            {
                options.HttpMessageHandlerFactory = _ => server.CreateHandler();
                options.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
            })
            .Build();
        var received = new TaskCompletionSource<DashboardSettings>();
        hub.On<DashboardSettings>("SettingsUpdated", s => received.TrySetResult(s));
        await hub.StartAsync();

        var updated = DashboardSettings.Default with { Message = "Live!" };
        await _client.PutAsJsonAsync("/api/settings", updated);

        Assert.Equal(updated, await received.Task.WaitAsync(TimeSpan.FromSeconds(10)));
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/admin")]
    public async Task Serves_the_angular_app_for_client_routes(string path)
    {
        var response = await _client.GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("<app-root>", await response.Content.ReadAsStringAsync());
    }
}
