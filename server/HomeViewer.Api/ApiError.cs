namespace HomeViewer.Api;

/// <summary>
/// Why a request was turned down. The admin page shows its own text for <see cref="Code"/>, in the
/// dashboard's language, filled in with <see cref="Values"/>; <see cref="Message"/> is the English text,
/// for anything else that reads the API.
/// </summary>
public record ApiError(string Code, string Message, IReadOnlyDictionary<string, object>? Values = null);

/// <summary>An upload that can't be used as a background, with the reason to send back.</summary>
public sealed class InvalidImageException(ApiError error) : Exception(error.Message)
{
    public ApiError Error { get; } = error;
}
