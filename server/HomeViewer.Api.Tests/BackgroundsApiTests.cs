using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;

namespace HomeViewer.Api.Tests;

public sealed class BackgroundsApiTests : IAsyncLifetime
{
    // Just enough of each format for the server to recognise it.
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3];
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 4, 5, 6];

    private readonly HomeViewerFactory _factory = new();
    private HttpClient _client = null!;

    private string Folder => Path.Combine(_factory.Root, "backgrounds");

    public Task InitializeAsync()
    {
        _client = _factory.CreateClient();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<HttpResponseMessage> UploadAsync(byte[] bytes, string contentType = "image/jpeg")
    {
        var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return await _client.PostAsync("/api/backgrounds", content);
    }

    private async Task<string> UploadNameAsync(byte[] bytes)
    {
        var response = await UploadAsync(bytes);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<BackgroundUpload>())!.Name;
    }

    private Task<HttpResponseMessage> SaveAsync(IReadOnlyList<string> backgrounds, int minutes = 10) =>
        _client.PutAsJsonAsync(
            "/api/settings",
            DashboardSettings.Default with { Backgrounds = backgrounds, BackgroundMinutes = minutes });

    [Fact]
    public async Task Settings_have_no_backgrounds_and_ten_minutes_by_default()
    {
        var settings = await _client.GetFromJsonAsync<DashboardSettings>("/api/settings");

        Assert.Empty(settings!.Backgrounds);
        Assert.Equal(10, settings.BackgroundMinutes);
    }

    [Theory]
    [InlineData(true, ".jpg", "image/jpeg")]
    [InlineData(false, ".png", "image/png")]
    public async Task Stores_an_upload_under_a_new_name_and_serves_it(bool jpeg, string extension, string contentType)
    {
        var bytes = jpeg ? Jpeg : Png;

        var name = await UploadNameAsync(bytes);
        var response = await _client.GetAsync($"/api/backgrounds/{name}");

        Assert.Matches($"^[0-9a-f]{{32}}\\{extension}$", name);
        response.EnsureSuccessStatusCode();
        Assert.Equal(bytes, await response.Content.ReadAsByteArrayAsync());
        Assert.Equal(contentType, response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("immutable", response.Headers.CacheControl?.ToString());
    }

    [Fact]
    public async Task Rejects_files_that_are_not_jpeg_or_png()
    {
        // The content type is the browser's claim; the bytes decide.
        var response = await UploadAsync("GIF89a"u8.ToArray());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("JPEG and PNG", await response.Content.ReadAsStringAsync());
        Assert.False(Directory.Exists(Folder) && Directory.EnumerateFiles(Folder).Any());
    }

    [Fact]
    public async Task Rejects_files_that_are_too_large()
    {
        var bytes = new byte[BackgroundStore.MaxBytes + 1];
        Jpeg.CopyTo(bytes, 0);

        var response = await UploadAsync(bytes);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("at most 15 MB", await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("0123456789abcdef0123456789abcdef.jpg")]
    [InlineData("settings.json")]
    [InlineData("..%2Fsettings.json")]
    public async Task Answers_404_for_anything_but_a_stored_image(string name)
    {
        await SaveAsync([]);

        var response = await _client.GetAsync($"/api/backgrounds/{name}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Saving_keeps_the_listed_images_and_deletes_the_rest()
    {
        var kept = await UploadNameAsync(Jpeg);
        var unsaved = await UploadNameAsync(Png);
        // Someone else's file in the folder is left alone.
        File.WriteAllText(Path.Combine(Folder, "notes.txt"), "mine");

        var response = await SaveAsync([kept], minutes: 5);

        response.EnsureSuccessStatusCode();
        var settings = await _client.GetFromJsonAsync<DashboardSettings>("/api/settings");
        Assert.Equal([kept], settings!.Backgrounds);
        Assert.Equal(5, settings.BackgroundMinutes);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/backgrounds/{unsaved}")).StatusCode);
        Assert.Equivalent(new[] { kept, "notes.txt" }, Directory.EnumerateFiles(Folder).Select(Path.GetFileName));
    }

    [Fact]
    public async Task Removing_an_image_from_the_settings_deletes_it()
    {
        var name = await UploadNameAsync(Jpeg);
        (await SaveAsync([name])).EnsureSuccessStatusCode();

        (await SaveAsync([])).EnsureSuccessStatusCode();

        Assert.Empty(Directory.EnumerateFiles(Folder));
    }

    [Fact]
    public async Task Rejects_settings_listing_a_missing_image()
    {
        var response = await SaveAsync(["0123456789abcdef0123456789abcdef.jpg"]);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("missing", await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(DashboardSettings.MaxBackgroundMinutes + 1)]
    public async Task Rejects_an_interval_out_of_range(int minutes)
    {
        var response = await SaveAsync([], minutes);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("1 to 1440 minutes", await response.Content.ReadAsStringAsync());
    }
}
