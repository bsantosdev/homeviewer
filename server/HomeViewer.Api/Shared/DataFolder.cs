namespace HomeViewer.Api;

/// <summary>Where the settings file is. Everything else the server keeps lives next to it.</summary>
public class DataFolder(string settingsPath)
{
    public string SettingsPath { get; } = settingsPath;

    public string PathOf(string name) => Path.Combine(Path.GetDirectoryName(SettingsPath)!, name);
}

public static class DataFolderSetup
{
    // Relative paths are resolved against the content root; tests point this at a temp file.
    public static IServiceCollection AddDataFolder(this IServiceCollection services) =>
        services.AddSingleton(sp => new DataFolder(Path.Combine(
            sp.GetRequiredService<IHostEnvironment>().ContentRootPath,
            sp.GetRequiredService<IConfiguration>().GetValue("SettingsPath", "data/settings.json")!)));
}
