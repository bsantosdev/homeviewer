namespace HomeViewer.Api.Tests;

public sealed class SettingsStoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "homeviewer-tests", Guid.NewGuid().ToString());
    private string SettingsPath => Path.Combine(_dir, "data", "settings.json");

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    [Fact]
    public void Returns_defaults_when_no_file_exists()
    {
        var store = new SettingsStore(SettingsPath);

        Assert.Same(DashboardSettings.Default, store.Get());
        Assert.False(File.Exists(SettingsPath));
    }

    [Fact]
    public void Save_creates_the_folder_and_persists_across_instances()
    {
        var settings = DashboardSettings.Default with { Title = "Kitchen", Theme = "light" };

        new SettingsStore(SettingsPath).Save(settings);

        Assert.True(File.Exists(SettingsPath));
        Assert.Equivalent(settings, new SettingsStore(SettingsPath).Get(), strict: true);
    }

    [Fact]
    public void Save_updates_the_current_settings()
    {
        var store = new SettingsStore(SettingsPath);
        var settings = DashboardSettings.Default with { Message = "Hello" };

        store.Save(settings);

        Assert.Equal(settings, store.Get());
    }

    [Fact]
    public void Writes_camel_case_json()
    {
        new SettingsStore(SettingsPath).Save(DashboardSettings.Default);

        Assert.Contains("\"locationName\"", File.ReadAllText(SettingsPath));
    }

    [Fact]
    public void Falls_back_to_defaults_when_the_file_holds_null()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        File.WriteAllText(SettingsPath, "null");

        Assert.Same(DashboardSettings.Default, new SettingsStore(SettingsPath).Get());
    }

    [Fact]
    public void Gives_calendars_saved_before_colours_existed_the_default_colour()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        File.WriteAllText(SettingsPath, """
            {"title":"Old","message":"","theme":"dark","locationName":"Lisbon","latitude":1,"longitude":2,
             "calendars":[{"name":"Family","url":"https://outlook.example/a.ics"}]}
            """);

        var calendar = Assert.Single(new SettingsStore(SettingsPath).Get().Calendars);

        Assert.Equal(CalendarFeed.DefaultColor, calendar.Color);
    }

    [Fact]
    public void Loads_settings_saved_before_calendars_existed()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        File.WriteAllText(SettingsPath, """
            {"title":"Old","message":"","theme":"dark","locationName":"Lisbon","latitude":1,"longitude":2}
            """);

        var settings = new SettingsStore(SettingsPath).Get();

        Assert.Equal("Old", settings.Title);
        Assert.Empty(settings.Calendars);
    }
}
