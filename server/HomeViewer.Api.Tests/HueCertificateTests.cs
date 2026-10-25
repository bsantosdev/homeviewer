using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using HomeViewer.Api;

namespace HomeViewer.Api.Tests;

public class HueCertificateTests
{
    [Fact]
    public void TrustsSignifysBridgeCa()
    {
        Assert.Equal("CN=root-bridge, O=Philips Hue, C=NL", HueCertificate.Root.Subject);
    }

    [Fact]
    public void AcceptsACertificateSignedByTheRoot()
    {
        using var root = CreateRoot("root-bridge");
        using var bridge = CreateSignedBy(root, "0123456789abcdef");

        Assert.True(HueCertificate.IsSignedBy(bridge, root));
    }

    [Fact]
    public void RejectsACertificateFromAnotherRootWithTheSameName()
    {
        using var root = CreateRoot("root-bridge");
        using var impostor = CreateRoot("root-bridge");
        using var bridge = CreateSignedBy(impostor, "0123456789abcdef");

        Assert.False(HueCertificate.IsSignedBy(bridge, root));
    }

    [Fact]
    public void RejectsASelfSignedCertificate()
    {
        using var selfSigned = CreateRoot("0123456789abcdef");

        Assert.False(HueCertificate.Validate(new HttpRequestMessage(), selfSigned, null, default));
    }

    [Fact]
    public void RejectsAMissingCertificate()
    {
        Assert.False(HueCertificate.IsSignedBy(null, HueCertificate.Root));
    }

    private static X509Certificate2 CreateRoot(string name)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest($"CN={name}, O=Philips Hue, C=NL", key, HashAlgorithmName.SHA256);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        request.CertificateExtensions.Add(
            new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        return request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));
    }

    private static X509Certificate2 CreateSignedBy(X509Certificate2 issuer, string bridgeId)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest($"CN={bridgeId}, O=Philips Hue, C=NL", key, HashAlgorithmName.SHA256);
        return request.Create(
            issuer,
            DateTimeOffset.UtcNow.AddDays(-1),
            DateTimeOffset.UtcNow.AddMonths(6),
            RandomNumberGenerator.GetBytes(8));
    }
}
