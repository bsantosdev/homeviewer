using System.Text.Json;

namespace HomeViewer.Api;

/// <summary>Something to buy. Ticked items stay on the list, struck through, until they're cleared.</summary>
public record ShoppingItem(Guid Id, string Text, bool Done);

/// <summary>What to add to the shopping list.</summary>
public record NewShoppingItem(string? Text)
{
    public const int MaxLength = 80;

    public bool IsValid => !string.IsNullOrWhiteSpace(Text) && Text.Trim().Length <= MaxLength;
}

/// <summary>Ticks an item off, or puts it back.</summary>
public record ShoppingItemChange(bool Done);

/// <summary>The shared shopping list, kept in a JSON file next to the settings.</summary>
public class ShoppingStore(string path)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private readonly Lock _lock = new();
    private IReadOnlyList<ShoppingItem> _items = Load(path);

    public IReadOnlyList<ShoppingItem> Get()
    {
        lock (_lock) return _items;
    }

    /// <summary>Adds an item at the end, unless the same thing is still on the list to buy.</summary>
    public IReadOnlyList<ShoppingItem> Add(string text)
    {
        text = text.Trim();
        lock (_lock)
        {
            if (_items.Any(i => !i.Done && string.Equals(i.Text, text, StringComparison.CurrentCultureIgnoreCase)))
                return _items;
            // Something bought before goes back on the list rather than showing twice.
            return Save([.. _items.Where(i => !string.Equals(i.Text, text, StringComparison.CurrentCultureIgnoreCase)), new(Guid.NewGuid(), text, false)]);
        }
    }

    /// <returns>Null if there's no item with that id.</returns>
    public IReadOnlyList<ShoppingItem>? Change(Guid id, bool done)
    {
        lock (_lock)
        {
            if (_items.All(i => i.Id != id)) return null;
            return Save([.. _items.Select(i => i.Id == id ? i with { Done = done } : i)]);
        }
    }

    public IReadOnlyList<ShoppingItem> ClearDone()
    {
        lock (_lock) return Save([.. _items.Where(i => !i.Done)]);
    }

    private IReadOnlyList<ShoppingItem> Save(IReadOnlyList<ShoppingItem> items)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(items, JsonOptions));
        return _items = items;
    }

    private static IReadOnlyList<ShoppingItem> Load(string path) =>
        File.Exists(path)
            ? JsonSerializer.Deserialize<IReadOnlyList<ShoppingItem>>(File.ReadAllText(path), JsonOptions) ?? []
            : [];
}
