namespace HomeViewer.Api.Tests;

public sealed class ShoppingStoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "homeviewer-tests", Guid.NewGuid().ToString());
    private string ShoppingPath => Path.Combine(_dir, "data", "shopping.json");

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    [Fact]
    public void Starts_empty_when_no_file_exists()
    {
        Assert.Empty(new ShoppingStore(ShoppingPath).Get());
        Assert.False(File.Exists(ShoppingPath));
    }

    [Fact]
    public void Keeps_the_list_across_instances()
    {
        var store = new ShoppingStore(ShoppingPath);
        var milk = store.Add("Milk").Single();
        store.Change(milk.Id, done: true);

        Assert.Equal([new ShoppingItem(milk.Id, "Milk", true)], new ShoppingStore(ShoppingPath).Get());
    }

    [Fact]
    public void Treats_an_empty_file_as_an_empty_list()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(ShoppingPath)!);
        File.WriteAllText(ShoppingPath, "null");

        Assert.Empty(new ShoppingStore(ShoppingPath).Get());
    }
}
