using System.Collections.Concurrent;
using System.Globalization;
using Ical.Net;
using Calendar = Ical.Net.Calendar;
using Ical.Net.CalendarComponents;
using Ical.Net.DataTypes;

namespace HomeViewer.Api;

/// <summary>One event occurrence, as the dashboard shows it.</summary>
/// <param name="Start">
/// A UTC time ("2026-10-24T08:30:00Z"); a date ("2026-10-24") for all-day events; or, for times the feed
/// gives without a time zone, a local wall-clock time ("2026-10-24T18:00:00").
/// </param>
/// <param name="End">The exclusive end, in the same form as <paramref name="Start"/>.</param>
/// <param name="Color">The calendar's badge colour, as "#rrggbb".</param>
public record DashboardEvent(string Title, string Calendar, string Color, bool AllDay, string Start, string End);

/// <summary>
/// Reads published ICS calendars. Each feed is downloaded at most once per <see cref="CacheDuration"/>,
/// and the last good copy is kept if a download fails.
/// </summary>
public class CalendarFeedReader(IHttpClientFactory httpFactory, TimeProvider time, ILogger<CalendarFeedReader> logger)
{
    public static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(5);

    // All-day dates have no time zone, so keep any that could fall in the range somewhere on Earth.
    // The client does the exact filtering in its own time zone.
    private static readonly TimeSpan AllDaySlack = TimeSpan.FromHours(14);

    // Cache the raw text rather than parsed calendars: Ical.Net objects aren't safe to share across requests.
    private readonly ConcurrentDictionary<string, (DateTimeOffset FetchedAt, string Ics)> _cache = new();

    public async Task<IReadOnlyList<DashboardEvent>> GetEventsAsync(
        IEnumerable<CalendarFeed> feeds, DateTimeOffset from, DateTimeOffset to, CancellationToken cancellationToken)
    {
        var loaded = await Task.WhenAll(feeds.Select(async feed => (feed, ics: await LoadAsync(feed, cancellationToken))));
        return [.. loaded.SelectMany(f => f.ics is null ? [] : Occurrences(f.ics, f.feed, from, to))];
    }

    private async Task<string?> LoadAsync(CalendarFeed feed, CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var cached = _cache.TryGetValue(feed.Url, out var entry) ? entry : default;
        if (cached.Ics is not null && now - cached.FetchedAt < CacheDuration) return cached.Ics;

        try
        {
            var ics = CustomTimeZones.Resolve(
                await httpFactory.CreateClient(nameof(CalendarFeedReader)).GetStringAsync(ToHttp(feed.Url), cancellationToken),
                now.Year);
            _cache[feed.Url] = (now, ics);
            return ics;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Don't log the URL: a published calendar link works like a password.
            logger.LogWarning(ex, "Couldn't download calendar {Calendar}", feed.Name);
            return cached.Ics;
        }
    }

    private IEnumerable<DashboardEvent> Occurrences(string ics, CalendarFeed feed, DateTimeOffset from, DateTimeOffset to)
    {
        var start = new CalDateTime((from - AllDaySlack).UtcDateTime, "UTC");
        var end = new CalDateTime((to + AllDaySlack).UtcDateTime, "UTC");
        // Expanding occurrences can throw too (an unknown time zone, say). Skip that calendar, not the request.
        try
        {
            var calendar = Calendar.Load(ics) ?? throw new FormatException("Empty calendar");
            return calendar.GetOccurrences(start).TakeWhileBefore(end)
                .Select(occurrence => ToEvent(occurrence, feed, from, to))
                .OfType<DashboardEvent>()
                .ToList();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Couldn't read calendar {Calendar}", feed.Name);
            return [];
        }
    }

    /// <summary>Returns null for cancelled events and timed events outside the range.</summary>
    private static DashboardEvent? ToEvent(Occurrence occurrence, CalendarFeed feed, DateTimeOffset from, DateTimeOffset to)
    {
        if (occurrence.Source is not CalendarEvent e || string.Equals(e.Status, "CANCELLED", StringComparison.OrdinalIgnoreCase))
            return null;

        var title = string.IsNullOrWhiteSpace(e.Summary) ? "Busy" : e.Summary;
        var period = occurrence.Period;
        var startTime = period.StartTime;
        var endTime = period.EffectiveEndTime ?? startTime;
        if (!startTime.HasTime) return new(title, feed.Name, feed.Color, true, Date(startTime), Date(endTime));
        // A time without a zone means that wall-clock time wherever you are, so the client places it.
        if (startTime.IsFloating) return new(title, feed.Name, feed.Color, false, Local(startTime), Local(endTime));

        var (startUtc, endUtc) = (startTime.AsUtc, endTime.AsUtc);
        return endUtc > from.UtcDateTime && startUtc < to.UtcDateTime
            ? new(title, feed.Name, feed.Color, false, Utc(startUtc), Utc(endUtc))
            : null;
    }

    private static string ToHttp(string url) =>
        url.StartsWith("webcal://", StringComparison.OrdinalIgnoreCase) ? "https://" + url["webcal://".Length..] : url;

    private static string Utc(DateTime utc) => utc.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);

    private static string Local(CalDateTime value) => value.Value.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);

    private static string Date(CalDateTime value) => value.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
