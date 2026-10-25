using Microsoft.Extensions.Logging.Abstractions;

namespace HomeViewer.Api.Tests;

public sealed class CalendarFeedReaderTests
{
    private const string Url = "https://outlook.example/calendar.ics";

    // Sunday 25 and Monday 26 October 2026, as local days in Vienna (UTC+1 after the clock change).
    private static readonly DateTimeOffset From = new(2026, 10, 25, 0, 0, 0, TimeSpan.FromHours(2));
    private static readonly DateTimeOffset To = new(2026, 10, 27, 0, 0, 0, TimeSpan.FromHours(1));

    private readonly FakeCalendarHandler _handler = new();
    private readonly FakeTimeProvider _time = new(From);
    private readonly CalendarFeedReader _reader;

    public CalendarFeedReaderTests()
    {
        _reader = new CalendarFeedReader(new FakeHttpClientFactory(_handler), _time, NullLogger<CalendarFeedReader>.Instance);
    }

    private Task<IReadOnlyList<DashboardEvent>> Read(params CalendarFeed[] feeds) =>
        _reader.GetEventsAsync(feeds, From, To, CancellationToken.None);

    [Fact]
    public async Task Expands_an_Outlook_calendar_into_the_range()
    {
        _handler.Serve(Url, Ics.Outlook);

        var events = await Read(new CalendarFeed("Family", Url, "#ef4444"));

        // The Standup is skipped on the 26th and moved to the 27th; the cancelled meeting is dropped.
        Assert.Equivalent(new DashboardEvent[]
        {
            new("Holiday", "Family", "#ef4444", true, "2026-10-14", "2026-10-30"),
            new("Birthday", "Family", "#ef4444", true, "2026-10-25", "2026-10-26"),
            new("Standup", "Family", "#ef4444", false, "2026-10-25T08:30:00Z", "2026-10-25T08:45:00Z"),
        }, events, strict: true);
    }

    [Fact]
    public async Task Keeps_timed_events_that_overlap_the_range_edges()
    {
        _handler.Serve(Url, Ics.Single("""
            SUMMARY:Overnight
            DTSTART:20261024T200000Z
            DTEND:20261024T230000Z
            """));

        var events = await Read(new CalendarFeed("Home", Url));

        Assert.Equal("Overnight", Assert.Single(events).Title);
    }

    [Theory]
    [InlineData("20261024T200000Z", "20261024T220000Z")] // ends as the range starts
    [InlineData("20261026T230000Z", "20261027T010000Z")] // starts as the range ends
    public async Task Leaves_out_timed_events_just_outside_the_range(string start, string end)
    {
        _handler.Serve(Url, Ics.Single($"SUMMARY:Outside\nDTSTART:{start}\nDTEND:{end}"));

        Assert.Empty(await Read(new CalendarFeed("Home", Url)));
    }

    [Fact]
    public async Task Passes_times_without_a_zone_through_as_local_times()
    {
        _handler.Serve(Url, Ics.Single("SUMMARY:Dinner\nDTSTART:20261025T190000\nDTEND:20261025T210000"));

        var e = Assert.Single(await Read(new CalendarFeed("Home", Url)));

        Assert.Equal(("2026-10-25T19:00:00", "2026-10-25T21:00:00"), (e.Start, e.End));
    }

    [Theory]
    // Europe switched to winter time at 01:00 UTC that morning; the US hadn't yet; India has no DST.
    [InlineData(Ics.EuropeRules, "20261025T110000", "2026-10-25T10:00:00Z")]
    [InlineData(Ics.UsEasternRules, "20261026T090000", "2026-10-26T13:00:00Z")]
    [InlineData(Ics.IndiaRules, "20261025T153000", "2026-10-25T10:00:00Z")]
    public async Task Reads_Outlook_customized_time_zones(string rules, string localStart, string utcStart)
    {
        // Outlook folds long lines, which can split the zone name.
        _handler.Serve(Url, Ics.CustomZone(rules, $"SUMMARY:Call\nDTSTART;TZID=Customized \n Time Zone:{localStart}\nDURATION:PT1H"));

        var e = Assert.Single(await Read(new CalendarFeed("Work", Url)));

        Assert.Equal(utcStart, e.Start);
    }

    [Fact]
    public async Task Skips_a_customized_time_zone_without_rules()
    {
        _handler.Serve(Url, Ics.CustomZone("", "SUMMARY:Call\nDTSTART;TZID=Customized Time Zone:20261025T110000\nDURATION:PT1H"));

        Assert.Empty(await Read(new CalendarFeed("Work", Url)));
    }

    [Fact]
    public async Task Skips_a_calendar_whose_events_cannot_be_placed_in_time()
    {
        _handler.Serve("https://broken.example/a.ics", Ics.Single("SUMMARY:Lost\nDTSTART;TZID=Mars Standard Time:20261025T120000\nDTEND;TZID=Mars Standard Time:20261025T130000"));
        _handler.Serve(Url, Ics.Outlook);

        var events = await Read(new CalendarFeed("Broken", "https://broken.example/a.ics"), new CalendarFeed("Family", Url));

        Assert.All(events, e => Assert.Equal("Family", e.Calendar));
        Assert.Equal(3, events.Count);
    }

    [Fact]
    public async Task Ignores_tasks_in_the_feed()
    {
        _handler.Serve(Url, """
            BEGIN:VCALENDAR
            VERSION:2.0
            PRODID:test
            BEGIN:VTODO
            UID:todo
            SUMMARY:Buy milk
            DTSTART:20261025T120000Z
            DUE:20261025T130000Z
            END:VTODO
            END:VCALENDAR
            """);

        Assert.Empty(await Read(new CalendarFeed("Home", Url)));
    }

    [Fact]
    public async Task Skips_an_empty_feed()
    {
        _handler.Serve(Url, "");

        Assert.Empty(await Read(new CalendarFeed("Home", Url)));
    }

    [Fact]
    public async Task Names_untitled_events_busy()
    {
        _handler.Serve(Url, Ics.Single("""
            DTSTART:20261025T120000Z
            DTEND:20261025T130000Z
            """));

        var events = await Read(new CalendarFeed("Work", Url));

        Assert.Equal("Busy", Assert.Single(events).Title);
    }

    [Fact]
    public async Task Treats_events_without_an_end_as_instants()
    {
        _handler.Serve(Url, Ics.Single("""
            SUMMARY:Reminder
            DTSTART:20261025T120000Z
            """));

        var e = Assert.Single(await Read(new CalendarFeed("Home", Url)));

        Assert.Equal(e.Start, e.End);
    }

    [Fact]
    public async Task Merges_several_calendars()
    {
        _handler.Serve(Url, Ics.Single("SUMMARY:Dentist\nDTSTART:20261025T120000Z\nDTEND:20261025T130000Z"));
        _handler.Serve("https://other.example/b.ics", Ics.Single("SUMMARY:Football\nDTSTART:20261026T170000Z\nDTEND:20261026T180000Z"));

        var events = await Read(new CalendarFeed("Me", Url), new CalendarFeed("Kids", "https://other.example/b.ics"));

        Assert.Equal(["Me: Dentist", "Kids: Football"], events.Select(e => $"{e.Calendar}: {e.Title}"));
    }

    [Fact]
    public async Task Downloads_webcal_links_over_https()
    {
        _handler.Serve(Url, Ics.Outlook);

        await Read(new CalendarFeed("Family", "webcal://outlook.example/calendar.ics"));

        Assert.Equal([Url], _handler.Requests);
    }

    [Fact]
    public async Task Downloads_each_feed_at_most_once_per_cache_period()
    {
        _handler.Serve(Url, Ics.Outlook);
        var feed = new CalendarFeed("Family", Url);

        await Read(feed);
        _time.Now += CalendarFeedReader.CacheDuration - TimeSpan.FromSeconds(1);
        await Read(feed);
        Assert.Single(_handler.Requests);

        _time.Now += TimeSpan.FromSeconds(1);
        await Read(feed);
        Assert.Equal(2, _handler.Requests.Count);
    }

    [Fact]
    public async Task Keeps_the_last_good_copy_when_a_download_fails()
    {
        _handler.Serve(Url, Ics.Outlook);
        var feed = new CalendarFeed("Family", Url);
        await Read(feed);

        _handler.Fail(Url);
        _time.Now += CalendarFeedReader.CacheDuration;
        var events = await Read(feed);

        Assert.Equal(2, _handler.Requests.Count);
        Assert.Equal(3, events.Count);
    }

    [Fact]
    public async Task Skips_calendars_that_cannot_be_downloaded_or_read()
    {
        _handler.Fail("https://down.example/a.ics");
        _handler.Serve("https://junk.example/b.ics", "<html>Not a calendar</html>");
        _handler.Serve(Url, Ics.Outlook);

        var events = await Read(
            new CalendarFeed("Down", "https://down.example/a.ics"),
            new CalendarFeed("Junk", "https://junk.example/b.ics"),
            new CalendarFeed("Family", Url));

        Assert.All(events, e => Assert.Equal("Family", e.Calendar));
        Assert.Equal(3, events.Count);
    }

    [Fact]
    public async Task Stops_when_the_request_is_cancelled()
    {
        _handler.Serve(Url, Ics.Outlook);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            _reader.GetEventsAsync([new CalendarFeed("Family", Url)], From, To, new CancellationToken(canceled: true)));
    }

    [Theory]
    [InlineData("#3b82f6", true)]
    [InlineData("#ABCDEF", true)]
    [InlineData("blue", false)]
    [InlineData("#fff", false)]
    [InlineData("#3b82f6\n", false)]
    [InlineData("#3b82f6; background: url(x)", false)]
    public void Accepts_only_hex_colours(string color, bool valid)
    {
        Assert.Equal(valid, new CalendarFeed("Any", Url, color).HasValidColor);
    }

    [Theory]
    [InlineData("https://outlook.live.com/owa/calendar/x/reachcalendar.ics", true)]
    [InlineData("http://example.com/a.ics", true)]
    [InlineData("webcal://outlook.office365.com/a.ics", true)]
    [InlineData("file:///etc/passwd", false)]
    [InlineData("not a url", false)]
    public void Accepts_only_web_links(string url, bool valid)
    {
        Assert.Equal(valid, new CalendarFeed("Any", url).HasValidUrl);
    }
}
