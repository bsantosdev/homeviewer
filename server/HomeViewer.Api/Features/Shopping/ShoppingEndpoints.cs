using Microsoft.AspNetCore.SignalR;

namespace HomeViewer.Api;

public static class ShoppingEndpoints
{
    // The shopping list lives next to the settings too.
    public static IServiceCollection AddShopping(this IServiceCollection services) =>
        services.AddSingleton(sp => new ShoppingStore(sp.GetRequiredService<DataFolder>().PathOf("shopping.json")));

    public static IEndpointRouteBuilder MapShoppingEndpoints(this IEndpointRouteBuilder app)
    {
        // Every change sends the whole list to every screen, so the wall and phones stay in step.
        app.MapGet("/api/shopping", (ShoppingStore shopping) => shopping.Get());

        app.MapPost("/api/shopping", async (NewShoppingItem item, ShoppingStore shopping, IHubContext<DashboardHub> hub) =>
            item.IsValid
                ? await ShoppingUpdated(hub, shopping.Add(item.Text!))
                : Results.BadRequest($"Write what to buy, in at most {NewShoppingItem.MaxLength} characters."));

        app.MapPut("/api/shopping/{id:guid}", async (Guid id, ShoppingItemChange change, ShoppingStore shopping, IHubContext<DashboardHub> hub) =>
            shopping.Change(id, change.Done) is { } items ? await ShoppingUpdated(hub, items) : Results.NotFound());

        app.MapDelete("/api/shopping/done", async (ShoppingStore shopping, IHubContext<DashboardHub> hub) =>
            await ShoppingUpdated(hub, shopping.ClearDone()));

        return app;
    }

    private static async Task<IResult> ShoppingUpdated(IHubContext<DashboardHub> hub, IReadOnlyList<ShoppingItem> items)
    {
        await hub.Clients.All.SendAsync("ShoppingUpdated", items);
        return Results.Ok(items);
    }
}
