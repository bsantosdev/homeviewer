using System.Text.Json;

namespace HomeViewer.Api;

public class SettingsStore(string path)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private readonly Lock _lock = new();
    private DashboardSettings _current = Load(path);

    public DashboardSettings Get()
    {
        lock (_lock) return _current;
    }

    public void Save(DashboardSettings settings)
    {
        lock (_lock)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(settings, JsonOptions));
            _current = settings;
        }
    }

    private static DashboardSettings Load(string path) =>
        File.Exists(path)
            ? JsonSerializer.Deserialize<DashboardSettings>(File.ReadAllText(path), JsonOptions) ?? DashboardSettings.Default
            : DashboardSettings.Default;
}
