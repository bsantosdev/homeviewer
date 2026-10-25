using System.Globalization;

namespace HomeViewer.Api;

/// <summary>
/// Converts between what Hue lights report (CIE xy points, colour temperatures in mirek) and
/// screen colours ("#rrggbb"). Colours come out at full brightness: the dashboard shows the
/// brightness separately, as how full a tile is.
/// </summary>
public static class HueColor
{
    /// <summary>The temperature range the dashboard offers, warmest first. Each light clamps to what it can do.</summary>
    public const int MinKelvin = 2000;
    public const int MaxKelvin = 6500;

    public static int MirekToKelvin(int mirek) => (int)Math.Round(1_000_000.0 / mirek);

    public static int KelvinToMirek(int kelvin) => (int)Math.Round(1_000_000.0 / kelvin);

    /// <summary>The usual blackbody approximation (Tanner Helland's), good enough to tint a tile.</summary>
    public static string FromMirek(int mirek)
    {
        var t = MirekToKelvin(mirek) / 100.0;
        var r = t <= 66 ? 255 : 329.698727446 * Math.Pow(t - 60, -0.1332047592);
        var g = t <= 66 ? 99.4708025861 * Math.Log(t) - 161.1195681661 : 288.1221695283 * Math.Pow(t - 60, -0.0755148492);
        var b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.Log(t - 10) - 305.0447927307;
        return Hex(r, g, b);
    }

    /// <summary>Philips' xy-to-RGB conversion (wide gamut D65), scaled so the brightest channel is full.</summary>
    public static string FromXy(double x, double y)
    {
        var (bigX, bigZ) = (x / y, (1 - x - y) / y);
        var r = bigX * 1.656492 - 0.354851 - bigZ * 0.255038;
        var g = -bigX * 0.707196 + 1.655397 + bigZ * 0.036152;
        var b = bigX * 0.051713 - 0.121364 + bigZ * 1.011530;
        var (gr, gg, gb) = (Gamma(r), Gamma(g), Gamma(b));
        var max = Math.Max(gr, Math.Max(gg, gb));
        return Hex(gr / max * 255, gg / max * 255, gb / max * 255);
    }

    /// <summary>The reverse of <see cref="FromXy"/>, for colours picked on the dashboard.</summary>
    public static (double X, double Y) ToXy(string hex)
    {
        var (r, g, b) = (Linear(hex, 1), Linear(hex, 3), Linear(hex, 5));
        var bigX = r * 0.664511 + g * 0.154324 + b * 0.162028;
        var bigY = r * 0.283881 + g * 0.668433 + b * 0.047685;
        var bigZ = r * 0.000088 + g * 0.072310 + b * 0.986039;
        var sum = bigX + bigY + bigZ;
        return sum == 0 ? (0.3127, 0.3290) : (Math.Round(bigX / sum, 4), Math.Round(bigY / sum, 4));
    }

    private static double Gamma(double value) =>
        Math.Max(0, value <= 0.0031308 ? 12.92 * value : 1.055 * Math.Pow(value, 1 / 2.4) - 0.055);

    private static double Linear(string hex, int start)
    {
        var value = int.Parse(hex.AsSpan(start, 2), NumberStyles.HexNumber) / 255.0;
        return value > 0.04045 ? Math.Pow((value + 0.055) / 1.055, 2.4) : value / 12.92;
    }

    private static string Hex(double r, double g, double b) =>
        $"#{Channel(r):x2}{Channel(g):x2}{Channel(b):x2}";

    private static int Channel(double value) => (int)Math.Round(Math.Clamp(value, 0, 255));
}
