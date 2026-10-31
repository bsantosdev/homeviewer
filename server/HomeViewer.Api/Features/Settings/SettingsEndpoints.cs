using Microsoft.AspNetCore.SignalR;

namespace HomeViewer.Api;

public static class SettingsEndpoints
{
    public static IServiceCollection AddSettings(this IServiceCollection services) =>
        services.AddSingleton(sp => new SettingsStore(sp.GetRequiredService<DataFolder>().SettingsPath));

    public static IEndpointRouteBuilder MapSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/settings", (SettingsStore store) => store.Get());

        // The settings list the backgrounds to show, so saving them checks and tidies the stored images.
        app.MapPut("/api/settings", async (DashboardSettings settings, SettingsStore store, BackgroundStore backgrounds, IHubContext<DashboardHub> hub) =>
        {
            if (settings.Calendars.FirstOrDefault(c => !c.HasValidUrl) is { } noLink)
                return Rejected("calendarLink", $"Calendar \"{noLink.Name}\" needs an https:// or webcal:// link.", ("name", noLink.Name));
            if (settings.Calendars.FirstOrDefault(c => !c.HasValidColor) is { } noColor)
                return Rejected("calendarColour", $"Calendar \"{noColor.Name}\" needs a colour like #3b82f6.", ("name", noColor.Name));
            if (settings.BackgroundMinutes is < 1 or > DashboardSettings.MaxBackgroundMinutes)
                return Rejected("backgroundMinutes", $"Backgrounds can change every 1 to {DashboardSettings.MaxBackgroundMinutes} minutes.",
                    ("max", DashboardSettings.MaxBackgroundMinutes));
            if (!settings.HasValidNightHours)
                return Rejected("nightHours", "Night mode needs a start and end time like 22:00.");
            if (settings.Backgrounds.Any(name => backgrounds.PathOf(name) is null))
                return Rejected("backgroundMissing", "A background image is missing. Remove it and add it again.");
            if (!settings.HasValidLanguage)
                return Rejected("language", $"The language must be one of {string.Join(", ", DashboardSettings.Languages)}.");

            store.Save(settings);
            // Uploads that didn't make it into the saved settings, and images just removed, aren't needed any more.
            backgrounds.DeleteAllExcept(settings.Backgrounds);
            await hub.Clients.All.SendAsync("SettingsUpdated", settings);
            return Results.Ok(settings);
        });

        return app;
    }

    // The admin page shows these, so they carry a code it can translate.
    private static IResult Rejected(string code, string message, params (string Name, object Value)[] values) =>
        Results.BadRequest(new ApiError(code, message, values.Length == 0 ? null : values.ToDictionary(v => v.Name, v => v.Value)));
}
