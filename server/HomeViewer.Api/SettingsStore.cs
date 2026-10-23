using System.Text.Json;

namespace HomeViewer.Api;

public class SettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private readonly string _path;
    private readonly Lock _lock = new();
    private DashboardSettings _current;

    public SettingsStore(IWebHostEnvironment env)
    {
        _path = Path.Combine(env.ContentRootPath, "data", "settings.json");
        _current = File.Exists(_path)
            ? JsonSerializer.Deserialize<DashboardSettings>(File.ReadAllText(_path), JsonOptions) ?? DashboardSettings.Default
            : DashboardSettings.Default;
    }

    public DashboardSettings Get()
    {
        lock (_lock) return _current;
    }

    public void Save(DashboardSettings settings)
    {
        lock (_lock)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            File.WriteAllText(_path, JsonSerializer.Serialize(settings, JsonOptions));
            _current = settings;
        }
    }
}
