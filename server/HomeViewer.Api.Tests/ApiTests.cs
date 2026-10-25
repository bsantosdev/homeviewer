using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace HomeViewer.Api.Tests;

/// <summary>
/// Runs the real app in memory, with settings and static files in a temp folder
/// and calendar downloads answered by <see cref="Calendars"/>.
/// </summary>
public sealed class HomeViewerFactory : WebApplicationFactory<Program>
{
    public string Root { get; } = Path.Combine(Path.GetTempPath(), "homeviewer-tests", Guid.NewGuid().ToString());
    public string SettingsPath => Path.Combine(Root, "settings.json");
    public string WebRoot => Path.Combine(Root, "wwwroot");
    public FakeCalendarHandler Calendars { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        Directory.CreateDirectory(WebRoot);
        File.WriteAllText(Path.Combine(WebRoot, "index.html"), "<app-root></app-root>");
        File.WriteAllText(Path.Combine(WebRoot, "main-ABC123.js"), "console.log('app');");
        builder.UseSetting("SettingsPath", SettingsPath);
        builder.UseWebRoot(WebRoot);
        builder.ConfigureTestServices(services =>
            services.AddHttpClient(nameof(CalendarFeedReader)).ConfigurePrimaryHttpMessageHandler(() => Calendars));
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

        Assert.Equivalent(DashboardSettings.Default, settings, strict: true);
    }

    [Fact]
    public async Task Put_saves_the_settings_to_disk()
    {
        var updated = DashboardSettings.Default with { Title = "Kitchen" };

        var response = await _client.PutAsJsonAsync("/api/settings", updated);

        response.EnsureSuccessStatusCode();
        Assert.Equivalent(updated, await response.Content.ReadFromJsonAsync<DashboardSettings>(), strict: true);
        Assert.Equivalent(updated, await _client.GetFromJsonAsync<DashboardSettings>("/api/settings"), strict: true);
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

        Assert.Equivalent(updated, await received.Task.WaitAsync(TimeSpan.FromSeconds(10)), strict: true);
    }

    [Fact]
    public async Task Put_saves_the_calendars()
    {
        var updated = DashboardSettings.Default with { Calendars = [new("Family", "webcal://outlook.example/a.ics")] };

        var response = await _client.PutAsJsonAsync("/api/settings", updated);

        response.EnsureSuccessStatusCode();
        Assert.Equivalent(updated, await _client.GetFromJsonAsync<DashboardSettings>("/api/settings"), strict: true);
    }

    [Fact]
    public async Task Put_rejects_calendars_without_a_web_link()
    {
        var updated = DashboardSettings.Default with { Calendars = [new("Family", "ftp://example.com/calendar.ics")] };

        var response = await _client.PutAsJsonAsync("/api/settings", updated);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Family", await response.Content.ReadAsStringAsync());
        Assert.Empty((await _client.GetFromJsonAsync<DashboardSettings>("/api/settings"))!.Calendars);
    }

    [Fact]
    public async Task Put_rejects_calendars_with_an_invalid_colour()
    {
        var updated = DashboardSettings.Default with { Calendars = [new("Family", "https://outlook.example/a.ics", "red")] };

        var response = await _client.PutAsJsonAsync("/api/settings", updated);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("colour", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Events_are_read_from_the_configured_calendars()
    {
        _factory.Calendars.Serve("https://outlook.example/a.ics", Ics.Outlook);
        await _client.PutAsJsonAsync("/api/settings",
            DashboardSettings.Default with { Calendars = [new("Family", "https://outlook.example/a.ics")] });

        var events = await _client.GetFromJsonAsync<DashboardEvent[]>(
            "/api/events?from=2026-10-24T22:00:00Z&to=2026-10-26T23:00:00Z");

        Assert.Equal(["Holiday", "Birthday", "Standup"], events!.Select(e => e.Title));
    }

    [Fact]
    public async Task Events_are_empty_without_calendars()
    {
        var events = await _client.GetFromJsonAsync<DashboardEvent[]>(
            "/api/events?from=2026-10-24T22:00:00Z&to=2026-10-26T23:00:00Z");

        Assert.Empty(events!);
    }

    [Theory]
    [InlineData("from=2026-10-25T00:00:00Z&to=2026-10-25T00:00:00Z")]
    [InlineData("from=2026-10-01T00:00:00Z&to=2026-11-02T00:00:00Z")]
    public async Task Events_reject_empty_or_oversized_ranges(string query)
    {
        var response = await _client.GetAsync($"/api/events?{query}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/index.html")]
    [InlineData("/admin")]
    public async Task Makes_browsers_check_for_a_new_build_on_every_load(string path)
    {
        var response = await _client.GetAsync(path);

        Assert.True(response.Headers.CacheControl?.NoCache, $"{path} should be sent with Cache-Control: no-cache");
    }

    [Fact]
    public async Task Lets_browsers_cache_hashed_bundles()
    {
        var response = await _client.GetAsync("/main-ABC123.js");

        response.EnsureSuccessStatusCode();
        Assert.Null(response.Headers.CacheControl);
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
