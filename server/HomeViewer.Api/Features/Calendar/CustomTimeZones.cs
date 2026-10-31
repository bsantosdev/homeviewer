using System.Text.RegularExpressions;
using Ical.Net;
using Ical.Net.CalendarComponents;
using Ical.Net.DataTypes;
using Calendar = Ical.Net.Calendar;

namespace HomeViewer.Api;

/// <summary>
/// Outlook writes some time zones, such as those of invites from other organisations, as
/// "Customized Time Zone" with the rules spelled out in a VTIMEZONE block. Ical.Net only looks zones
/// up by name, so it can't read them. This swaps each unknown name for a system time zone whose
/// offsets match the block's rules on every day of the year.
/// </summary>
public static class CustomTimeZones
{
    public static string Resolve(string ics, int year)
    {
        // Undo line folding so a long TZID can be matched on one line.
        var text = Regex.Replace(ics, @"\r?\n[ \t]", "");
        Calendar calendar;
        try
        {
            calendar = Calendar.Load(text) ?? throw new FormatException("Empty calendar");
        }
        catch (Exception)
        {
            return ics; // Not a calendar; reading it later reports the problem.
        }

        foreach (var zone in calendar.TimeZones)
        {
            if (zone.TzId is not { } id || IsKnown(id) || MatchingZone(zone, year) is not { } match) continue;
            text = Regex.Replace(
                text,
                @"(?<=TZID[=:]""?)" + Regex.Escape(id) + @"(?=""?(?:[:;,]|\r?$))",
                _ => match,
                RegexOptions.Multiline);
        }
        return text;
    }

    private static bool IsKnown(string tzId)
    {
        try
        {
            return TimeZoneResolvers.Default(tzId) is not null;
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>The system zone agreeing with the block on the most days, preferring the server's own.</summary>
    private static string? MatchingZone(VTimeZone zone, int year)
    {
        var transitions = Transitions(zone, year);
        if (transitions.Count == 0) return null;

        var days = Enumerable.Range(0, 365)
            .Select(d => new DateTime(year, 1, 1, 12, 0, 0, DateTimeKind.Utc).AddDays(d))
            .Select(day => (day, offset: transitions.LastOrDefault(t => t.Utc <= day, transitions[0]).Offset))
            .ToList();
        return new[] { TimeZoneInfo.Local }
            .Concat(TimeZoneInfo.GetSystemTimeZones())
            .MaxBy(candidate => days.Count(d => candidate.GetUtcOffset(d.day) == d.offset))!
            .Id;
    }

    /// <summary>When each STANDARD/DAYLIGHT rule takes effect, in UTC, up to the end of the year.</summary>
    private static List<(DateTime Utc, TimeSpan Offset)> Transitions(VTimeZone zone, int year)
    {
        var end = new CalDateTime(new DateTime(year + 1, 1, 1));
        return zone.TimeZoneInfos
            .SelectMany(info => info.GetOccurrences(info.DtStart, null)
                .TakeWhileBefore(end)
                .Select(o => (Utc: o.Period.StartTime.Value - info.OffsetFrom.Offset, info.OffsetTo.Offset)))
            .OrderBy(t => t.Utc)
            .ToList();
    }
}
