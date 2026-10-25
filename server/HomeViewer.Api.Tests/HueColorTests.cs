namespace HomeViewer.Api.Tests;

public class HueColorTests
{
    [Theory]
    [InlineData(2000, 500)]
    [InlineData(2700, 370)]
    [InlineData(6500, 154)]
    public void Kelvin_and_mirek_convert_both_ways(int kelvin, int mirek)
    {
        Assert.Equal(mirek, HueColor.KelvinToMirek(kelvin));
        Assert.Equal(kelvin, HueColor.MirekToKelvin(mirek), tolerance: 15);
    }

    [Theory]
    [InlineData(446, "#ff942c")] // 2242 K, the Hue app's "Relax"
    [InlineData(346, "#ffad66")] // 2890 K, "Read"
    [InlineData(153, "#fffffb")] // 6536 K, the coolest white Hue lights do
    [InlineData(100, "#cadaff")] // 10000 K, bluer than any Hue light
    [InlineData(600, "#ff7700")] // 1667 K, redder than any Hue light
    public void Whites_get_warmer_as_the_temperature_drops(int mirek, string expected)
    {
        Assert.Equal(expected, HueColor.FromMirek(mirek));
    }

    [Theory]
    [InlineData("#ff0000")]
    [InlineData("#00ff00")]
    [InlineData("#0000ff")]
    [InlineData("#ff8800")]
    [InlineData("#ffffff")]
    public void Colours_survive_a_round_trip_through_xy(string hex)
    {
        var (x, y) = HueColor.ToXy(hex);

        AssertClose(hex, HueColor.FromXy(x, y));
    }

    [Fact]
    public void Colours_come_out_at_full_brightness()
    {
        var (x, y) = HueColor.ToXy("#400000");

        AssertClose("#ff0000", HueColor.FromXy(x, y));
    }

    // The bridge takes xy to four decimals, which can move a channel by a step or two.
    private static void AssertClose(string expected, string actual)
    {
        for (var i = 1; i < 7; i += 2)
            Assert.InRange(Convert.ToInt32(actual.Substring(i, 2), 16) - Convert.ToInt32(expected.Substring(i, 2), 16), -3, 3);
    }

    [Fact]
    public void Black_has_no_colour_so_becomes_white()
    {
        Assert.Equal((0.3127, 0.3290), HueColor.ToXy("#000000"));
    }
}
