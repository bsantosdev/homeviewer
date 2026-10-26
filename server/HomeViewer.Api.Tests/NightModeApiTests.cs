using System.Net;
using System.Net.Http.Json;

namespace HomeViewer.Api.Tests;

public sealed class NightModeApiTests : IAsyncLifetime
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
    public async Task Is_off_from_ten_at_night_to_seven_by_default()
    {
        var settings = await _client.GetFromJsonAsync<DashboardSettings>("/api/settings");

        Assert.False(settings!.NightMode);
        Assert.Equal("22:00", settings.NightStart);
        Assert.Equal("07:00", settings.NightEnd);
    }

    [Fact]
    public async Task Saves_the_night_hours()
    {
        var night = DashboardSettings.Default with { NightMode = true, NightStart = "23:30", NightEnd = "06:15" };

        var response = await _client.PutAsJsonAsync("/api/settings", night);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var settings = await _client.GetFromJsonAsync<DashboardSettings>("/api/settings");
        Assert.True(settings!.NightMode);
        Assert.Equal("23:30", settings.NightStart);
        Assert.Equal("06:15", settings.NightEnd);
    }

    [Theory]
    [InlineData("25:00", "07:00")]
    [InlineData("22:00", "7am")]
    [InlineData("", "07:00")]
    public async Task Rejects_times_that_are_not_hours_and_minutes(string start, string end)
    {
        var response = await _client.PutAsJsonAsync(
            "/api/settings", DashboardSettings.Default with { NightStart = start, NightEnd = end });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("like 22:00", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Leaves_the_validity_check_out_of_the_json()
    {
        var json = await _client.GetStringAsync("/api/settings");
        Assert.DoesNotContain("hasValidNightHours", json);
    }
}
