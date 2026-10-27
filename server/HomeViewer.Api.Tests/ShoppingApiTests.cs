using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.SignalR.Client;

namespace HomeViewer.Api.Tests;

public sealed class ShoppingApiTests : IAsyncLifetime
{
    private readonly HomeViewerFactory _factory = new();
    private HttpClient _client = null!;

    public Task InitializeAsync()
    {
        _client = _factory.CreateClient();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<ShoppingItem[]> Add(string text)
    {
        var response = await _client.PostAsJsonAsync("/api/shopping", new NewShoppingItem(text));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ShoppingItem[]>())!;
    }

    private async Task<ShoppingItem[]> Tick(Guid id, bool done = true)
    {
        var response = await _client.PutAsJsonAsync($"/api/shopping/{id}", new ShoppingItemChange(done));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ShoppingItem[]>())!;
    }

    [Fact]
    public async Task Starts_empty()
    {
        Assert.Empty((await _client.GetFromJsonAsync<ShoppingItem[]>("/api/shopping"))!);
    }

    [Fact]
    public async Task Adds_items_at_the_end_without_the_spaces_around_them()
    {
        await Add("Milk");
        var items = await Add("  Bread ");

        Assert.Equal(["Milk", "Bread"], items.Select(i => i.Text));
        Assert.All(items, i => Assert.False(i.Done));
        Assert.Equivalent(items, await _client.GetFromJsonAsync<ShoppingItem[]>("/api/shopping"), strict: true);
        Assert.Contains("Bread", await File.ReadAllTextAsync(Path.Combine(_factory.Root, "shopping.json")));
    }

    [Fact]
    public async Task Does_not_add_something_already_on_the_list()
    {
        await Add("Milk");
        var items = await Add("milk");

        Assert.Equal(["Milk"], items.Select(i => i.Text));
    }

    [Fact]
    public async Task Puts_something_bought_back_on_the_list_at_the_end()
    {
        var milk = (await Add("Milk")).Single();
        await Add("Bread");
        await Tick(milk.Id);

        var items = await Add("Milk");

        Assert.Equal([("Bread", false), ("Milk", false)], items.Select(i => (i.Text, i.Done)));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task Rejects_empty_items(string? text)
    {
        var response = await _client.PostAsJsonAsync("/api/shopping", new NewShoppingItem(text));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("what to buy", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Rejects_items_that_are_too_long()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/shopping", new NewShoppingItem(new string('a', NewShoppingItem.MaxLength + 1)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Ticks_items_off_and_back_on()
    {
        var milk = (await Add("Milk")).Single();

        Assert.True((await Tick(milk.Id)).Single().Done);
        Assert.False((await Tick(milk.Id, done: false)).Single().Done);
    }

    [Fact]
    public async Task Ticking_returns_not_found_for_items_not_on_the_list()
    {
        var response = await _client.PutAsJsonAsync($"/api/shopping/{Guid.NewGuid()}", new ShoppingItemChange(true));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Clears_the_ticked_items()
    {
        var milk = (await Add("Milk")).Single();
        await Add("Bread");
        await Tick(milk.Id);

        var response = await _client.DeleteAsync("/api/shopping/done");

        response.EnsureSuccessStatusCode();
        Assert.Equal(["Bread"], (await response.Content.ReadFromJsonAsync<ShoppingItem[]>())!.Select(i => i.Text));
    }

    [Fact]
    public async Task Pushes_every_change_to_connected_screens()
    {
        var server = _factory.Server;
        await using var hub = new HubConnectionBuilder()
            .WithUrl(new Uri(server.BaseAddress, "/hubs/dashboard"), options =>
            {
                options.HttpMessageHandlerFactory = _ => server.CreateHandler();
                options.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
            })
            .Build();
        var received = new TaskCompletionSource<ShoppingItem[]>();
        hub.On<ShoppingItem[]>("ShoppingUpdated", items => received.TrySetResult(items));
        await hub.StartAsync();

        await Add("Milk");

        Assert.Equal(["Milk"], (await received.Task.WaitAsync(TimeSpan.FromSeconds(10))).Select(i => i.Text));
    }
}
