using System.Net.Security;
using System.Security.Cryptography.X509Certificates;

namespace HomeViewer.Api;

/// <summary>
/// Checks the bridge's HTTPS certificate. Each bridge has its own certificate, signed by Signify's private
/// "root-bridge" CA, which no operating system trusts, so the client trusts that root and nothing else.
/// </summary>
public static class HueCertificate
{
    // Signify's CA for Hue bridges, as published in the Hue developer docs. Valid until 2038.
    private const string RootPem = """
        -----BEGIN CERTIFICATE-----
        MIICMjCCAdigAwIBAgIUO7FSLbaxikuXAljzVaurLXWmFw4wCgYIKoZIzj0EAwIw
        OTELMAkGA1UEBhMCTkwxFDASBgNVBAoMC1BoaWxpcHMgSHVlMRQwEgYDVQQDDAty
        b290LWJyaWRnZTAiGA8yMDE3MDEwMTAwMDAwMFoYDzIwMzgwMTE5MDMxNDA3WjA5
        MQswCQYDVQQGEwJOTDEUMBIGA1UECgwLUGhpbGlwcyBIdWUxFDASBgNVBAMMC3Jv
        b3QtYnJpZGdlMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjNw2tx2AplOf9x86
        aTdvEcL1FU65QDxziKvBpW9XXSIcibAeQiKxegpq8Exbr9v6LBnYbna2VcaK0G22
        jOKkTqOBuTCBtjAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNV
        HQ4EFgQUZ2ONTFrDT6o8ItRnKfqWKnHFGmQwdAYDVR0jBG0wa4AUZ2ONTFrDT6o8
        ItRnKfqWKnHFGmShPaQ7MDkxCzAJBgNVBAYTAk5MMRQwEgYDVQQKDAtQaGlsaXBz
        IEh1ZTEUMBIGA1UEAwwLcm9vdC1icmlkZ2WCFDuxUi22sYpLlwJY81Wrqy11phcO
        MAoGCCqGSM49BAMCA0gAMEUCIEBYYEOsa07TH7E5MJnGw557lVkORgit2Rm1h3B2
        sFgDAiEA1Fj/C3AN5psFMjo0//mrQebo0eKd3aWRx+pQY08mk48=
        -----END CERTIFICATE-----
        """;

    public static X509Certificate2 Root { get; } = X509Certificate2.CreateFromPem(RootPem);

    /// <summary>For <see cref="HttpClientHandler.ServerCertificateCustomValidationCallback"/>.</summary>
    public static bool Validate(HttpRequestMessage request, X509Certificate2? certificate, X509Chain? chain, SslPolicyErrors errors) =>
        IsSignedBy(certificate, Root);

    /// <summary>
    /// Whether <paramref name="certificate"/> chains up to <paramref name="root"/>. The host name isn't checked:
    /// the certificate names the bridge by its id, while the server reaches it by IP address.
    /// </summary>
    public static bool IsSignedBy(X509Certificate2? certificate, X509Certificate2 root)
    {
        if (certificate is null)
        {
            return false;
        }

        using var chain = new X509Chain();
        chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        chain.ChainPolicy.CustomTrustStore.Add(root);
        // A private CA publishes no revocation lists.
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        return chain.Build(certificate);
    }
}
