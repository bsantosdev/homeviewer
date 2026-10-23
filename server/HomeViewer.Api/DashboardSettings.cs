namespace HomeViewer.Api;

public record DashboardSettings(
    string Title,
    string Message,
    string Theme,
    string LocationName,
    double Latitude,
    double Longitude)
{
    public static DashboardSettings Default { get; } =
        new("Home", "Welcome home!", "dark", "Lisbon", 38.72, -9.14);
}
