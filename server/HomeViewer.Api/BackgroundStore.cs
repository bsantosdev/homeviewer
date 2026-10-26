using System.Text.RegularExpressions;

namespace HomeViewer.Api;

/// <param name="Name">The stored file's name, to list in <see cref="DashboardSettings.Backgrounds"/>.</param>
public record BackgroundUpload(string Name);

/// <summary>
/// The dashboard's background images, kept as files in one folder. Each upload gets a new random name,
/// so a file never changes and browsers can cache it for good.
/// </summary>
public partial class BackgroundStore(string folder)
{
    /// <summary>The admin page shrinks photos before uploading them; this only stops runaway files.</summary>
    public const int MaxBytes = 15 * 1024 * 1024;

    /// <summary>Stores a JPEG or PNG and returns its new name.</summary>
    /// <exception cref="InvalidDataException">The upload is too large or not a JPEG or PNG.</exception>
    public async Task<string> SaveAsync(Stream content, CancellationToken cancellationToken)
    {
        var bytes = await ReadAsync(content, cancellationToken);
        var extension = ExtensionOf(bytes)
            ?? throw new InvalidDataException("Only JPEG and PNG images can be used as backgrounds.");
        var name = Guid.NewGuid().ToString("N") + extension;
        Directory.CreateDirectory(folder);
        await File.WriteAllBytesAsync(Path.Combine(folder, name), bytes, cancellationToken);
        return name;
    }

    /// <summary>The file's full path, or null if there's no stored image by that name.</summary>
    public string? PathOf(string name)
    {
        if (!StoredName().IsMatch(name)) return null;
        var path = Path.Combine(folder, name);
        return File.Exists(path) ? path : null;
    }

    public static string ContentTypeOf(string name) => name.EndsWith(".png", StringComparison.Ordinal) ? "image/png" : "image/jpeg";

    /// <summary>Deletes stored images that aren't in <paramref name="keep"/>, such as uploads that were never saved.</summary>
    public void DeleteAllExcept(IEnumerable<string> keep)
    {
        if (!Directory.Exists(folder)) return;
        var kept = keep.ToHashSet(StringComparer.Ordinal);
        foreach (var path in Directory.EnumerateFiles(folder))
        {
            var name = Path.GetFileName(path);
            if (StoredName().IsMatch(name) && !kept.Contains(name)) File.Delete(path);
        }
    }

    private static async Task<byte[]> ReadAsync(Stream content, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await content.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > MaxBytes)
                throw new InvalidDataException($"Images can be at most {MaxBytes / 1024 / 1024} MB.");
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }

    // Trust the file's first bytes, not the name or content type the browser sent.
    private static string? ExtensionOf(byte[] bytes) =>
        bytes switch
        {
            [0xFF, 0xD8, 0xFF, ..] => ".jpg",
            [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ..] => ".png",
            _ => null,
        };

    // Only names this class made, so a request can never reach another file.
    [GeneratedRegex(@"^[0-9a-f]{32}\.(jpg|png)\z", RegexOptions.None, matchTimeoutMilliseconds: 100)]
    private static partial Regex StoredName();
}
