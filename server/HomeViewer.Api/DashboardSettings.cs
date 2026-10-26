using System.Text.RegularExpressions;

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

    /// <summary>Published calendars to show. Settings files saved before this existed load with none.</summary>
    public IReadOnlyList<CalendarFeed> Calendars { get; init; } = [];

    /// <summary>Images from <see cref="BackgroundStore"/> the dashboard shows behind everything, in turn.</summary>
    public IReadOnlyList<string> Backgrounds { get; init; } = [];

    /// <summary>How long each background shows, in minutes.</summary>
    public int BackgroundMinutes { get; init; } = 10;

    public const int MaxBackgroundMinutes = 24 * 60;
}

/// <param name="Url">A published ICS link (https:// or webcal://).</param>
/// <param name="Color">The badge colour on the dashboard, as "#rrggbb". Older settings files load with the default.</param>
public record CalendarFeed(string Name, string Url, string Color = CalendarFeed.DefaultColor)
{
    public const string DefaultColor = "#3b82f6";

    public bool HasValidColor => Regex.IsMatch(Color, @"^#[0-9a-fA-F]{6}\z");

    public bool HasValidUrl =>
        Uri.TryCreate(Url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" or "webcal";
}
