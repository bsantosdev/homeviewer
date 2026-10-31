namespace HomeViewer.Api;

public static class CalendarEndpoints
{
    public static IServiceCollection AddCalendar(this IServiceCollection services)
    {
        services.AddHttpClient(nameof(CalendarFeedReader), http => http.Timeout = TimeSpan.FromSeconds(20));
        return services.AddSingleton<CalendarFeedReader>();
    }

    public static IEndpointRouteBuilder MapCalendarEndpoints(this IEndpointRouteBuilder app)
    {
        // The client asks for its own local days; a range is capped to keep recurring events cheap to expand.
        app.MapGet("/api/events", async (DateTimeOffset from, DateTimeOffset to, SettingsStore store, CalendarFeedReader reader, CancellationToken cancellationToken) =>
            to <= from || to - from > TimeSpan.FromDays(31)
                ? Results.BadRequest("'to' must be after 'from', at most 31 days later.")
                : Results.Ok(await reader.GetEventsAsync(store.Get().Calendars, from, to, cancellationToken)));

        return app;
    }
}
