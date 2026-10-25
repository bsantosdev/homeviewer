using System.Net;

namespace HomeViewer.Api.Tests;

/// <summary>Serves canned ICS responses by URL and records what was requested.</summary>
public sealed class FakeCalendarHandler : HttpMessageHandler
{
    public Dictionary<string, Func<HttpResponseMessage>> Responses { get; } = [];
    public List<string> Requests { get; } = [];

    public void Serve(string url, string ics) =>
        Responses[url] = () => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(ics) };

    public void Fail(string url) =>
        Responses[url] = () => new HttpResponseMessage(HttpStatusCode.InternalServerError);

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var url = request.RequestUri!.ToString();
        Requests.Add(url);
        return Task.FromResult(Responses.TryGetValue(url, out var respond)
            ? respond()
            : new HttpResponseMessage(HttpStatusCode.NotFound));
    }
}

public sealed class FakeHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
}

public sealed class FakeTimeProvider(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;

    public override DateTimeOffset GetUtcNow() => Now;
}

public static class Ics
{
    /// <summary>
    /// Shaped like an Outlook published calendar: a Windows time zone name, a daily meeting with one
    /// day skipped and one moved, all-day events, and a cancelled meeting. Europe/Vienna time, so
    /// 25 October 2026 is the switch from UTC+2 to UTC+1.
    /// </summary>
    public const string Outlook = """
        BEGIN:VCALENDAR
        VERSION:2.0
        PRODID:Microsoft Exchange Server 2010
        BEGIN:VTIMEZONE
        TZID:W. Europe Standard Time
        BEGIN:STANDARD
        DTSTART:16010101T030000
        TZOFFSETFROM:+0200
        TZOFFSETTO:+0100
        RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10
        END:STANDARD
        BEGIN:DAYLIGHT
        DTSTART:16010101T020000
        TZOFFSETFROM:+0100
        TZOFFSETTO:+0200
        RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3
        END:DAYLIGHT
        END:VTIMEZONE
        BEGIN:VEVENT
        UID:standup
        SUMMARY:Standup
        DTSTART;TZID=W. Europe Standard Time:20261005T093000
        DTEND;TZID=W. Europe Standard Time:20261005T094500
        RRULE:FREQ=DAILY;COUNT=60
        EXDATE;TZID=W. Europe Standard Time:20261026T093000
        END:VEVENT
        BEGIN:VEVENT
        UID:standup
        RECURRENCE-ID;TZID=W. Europe Standard Time:20261027T093000
        SUMMARY:Standup (moved)
        DTSTART;TZID=W. Europe Standard Time:20261027T140000
        DTEND;TZID=W. Europe Standard Time:20261027T141500
        END:VEVENT
        BEGIN:VEVENT
        UID:holiday
        SUMMARY:Holiday
        DTSTART;VALUE=DATE:20261014
        DTEND;VALUE=DATE:20261030
        END:VEVENT
        BEGIN:VEVENT
        UID:birthday
        SUMMARY:Birthday
        DTSTART;VALUE=DATE:20261025
        DTEND;VALUE=DATE:20261026
        END:VEVENT
        BEGIN:VEVENT
        UID:cancelled
        SUMMARY:Cancelled
        STATUS:CANCELLED
        DTSTART:20261025T100000Z
        DTEND:20261025T110000Z
        END:VEVENT
        END:VCALENDAR
        """;

    /// <summary>A "Customized Time Zone" block as Outlook writes it, from STANDARD/DAYLIGHT parts.</summary>
    public static string CustomZone(string parts, string vevent) => $"""
        BEGIN:VCALENDAR
        VERSION:2.0
        PRODID:Microsoft Exchange Server 2010
        BEGIN:VTIMEZONE
        TZID:Customized Time Zone
        {parts}
        END:VTIMEZONE
        BEGIN:VEVENT
        UID:custom
        {vevent}
        END:VEVENT
        END:VCALENDAR
        """;

    public const string EuropeRules = """
        BEGIN:STANDARD
        DTSTART:16010101T030000
        TZOFFSETFROM:+0200
        TZOFFSETTO:+0100
        RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10
        END:STANDARD
        BEGIN:DAYLIGHT
        DTSTART:16010101T020000
        TZOFFSETFROM:+0100
        TZOFFSETTO:+0200
        RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3
        END:DAYLIGHT
        """;

    // Daylight saving ends a week later than in Europe, on the first Sunday of November.
    public const string UsEasternRules = """
        BEGIN:STANDARD
        DTSTART:16010101T020000
        TZOFFSETFROM:-0400
        TZOFFSETTO:-0500
        RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11
        END:STANDARD
        BEGIN:DAYLIGHT
        DTSTART:16010101T020000
        TZOFFSETFROM:-0500
        TZOFFSETTO:-0400
        RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3
        END:DAYLIGHT
        """;

    public const string IndiaRules = """
        BEGIN:STANDARD
        DTSTART:16010101T000000
        TZOFFSETFROM:+0530
        TZOFFSETTO:+0530
        END:STANDARD
        """;

    public static string Single(string vevent) => $"""
        BEGIN:VCALENDAR
        VERSION:2.0
        PRODID:test
        BEGIN:VEVENT
        UID:single
        {vevent}
        END:VEVENT
        END:VCALENDAR
        """;
}
