import { test } from "node:test";
import assert from "node:assert";
import { analyzeSsoMetadata, checkSsoUrlSafety } from "../src/sso-doctor.js";

// Self-signed cert generated for tests; expires ~2 days after generation,
// so it exercises the expiring-soon path (threshold 30 days).
const SHORT_LIVED_CERT = "MIIDBzCCAe+gAwIBAgIULOEiCnNVNk/DGl+HR+baQ1KlBncwDQYJKoZIhvcNAQELBQAwEzERMA8GA1UEAwwIaWRwLnRlc3QwHhcNMjYwNjEyMTUyNjQxWhcNMjYwNjE0MTUyNjQxWjATMREwDwYDVQQDDAhpZHAudGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALag1szTpPDXg36UQSHqcWx2vZ4afS+PX6LQ9cSTyGoP7mnROCSMxfR9hyUKkCcNcZ08M6F6tgclZyp68pP3ApzydiLFki5ROowEntj3ETrWxe2JGRgmxJjkB8Qv2c15vDvqfKEDriehqHNZ65Y9aOyhCR2n+7sSigwD9MTprpPPX+VhhwM7FnECOhi+kokRjhzVuD2XsNgSgEigIcz9bgxJxbofUKhsmqc763GneXJkAxUg5pfSJevztFyprEhMijXDC4CkOgRuZkACyy6zoj5TeY4chctjGQSBnM5iAm1DWuWOYh5vuxmiZaCMXAHfAMQ1nE8CFhfk4S9RFn1pcQ0CAwEAAaNTMFEwHQYDVR0OBBYEFOmQBU98jFRRmLQ4EYVwHF1Kk5MWMB8GA1UdIwQYMBaAFOmQBU98jFRRmLQ4EYVwHF1Kk5MWMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAKCXSdLbIqgebcPvP8wxynvNLc3tBJbslCnfxz2wVNqPUXeKNpf+JzZcbCPWSi54cAa6sxP4ZXqApylPaLYp6+I1gRDz5kXxNwyNHg7aFNmThIYJfV5sa94mlVysPDgbqh+ph5C12IQ0PPVSKE3k2/ZqHAvRHdHnt7Yw62J+upUHBS5rbRq2EHYBLx078o47IKn+JjeZHxbngwsF0yT5MvK/QEVKByYTMYUZwyjaaSMRUSZcJj6JTq8QbzgA7z7PNLQgfC8HviUxkPJCMQQW0XNbJio7JauAOBJTxaFE7bie0tdLAB8KYNMor5XnbrLK7kZfwpj8a31EkKpA+gpemnA=";

const GOOD_OIDC = JSON.stringify({
  issuer: "https://idp.example.com",
  authorization_endpoint: "https://idp.example.com/auth",
  token_endpoint: "https://idp.example.com/token",
  jwks_uri: "https://idp.example.com/jwks",
  code_challenge_methods_supported: ["S256"],
  id_token_signing_alg_values_supported: ["RS256"],
});

function samlMetadata(cert: string): string {
  return `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.com/saml">
  <IDPSSODescriptor>
    <KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data>
      <X509Certificate>${cert}</X509Certificate>
    </X509Data></KeyInfo></KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/>
  </IDPSSODescriptor>
</EntityDescriptor>`;
}

test("clean OIDC discovery passes with zero blocking findings", () => {
  const findings = analyzeSsoMetadata({ content: GOOD_OIDC });
  assert.deepEqual(findings.filter((f) => f.severity === "critical"), []);
});

test("OIDC with 'none' signing alg is critical; missing PKCE is a warning", () => {
  const doc = JSON.parse(GOOD_OIDC);
  doc.id_token_signing_alg_values_supported = ["none"];
  delete doc.code_challenge_methods_supported;
  const findings = analyzeSsoMetadata({ content: JSON.stringify(doc) });
  assert.ok(findings.some((f) => f.code === "oidc-alg-none" && f.severity === "critical"));
  assert.ok(findings.some((f) => f.code === "oidc-no-pkce" && f.severity === "warning"));
});

test("OIDC with http endpoints is critical", () => {
  const doc = JSON.parse(GOOD_OIDC);
  doc.token_endpoint = "http://idp.example.com/token";
  const findings = analyzeSsoMetadata({ content: JSON.stringify(doc) });
  assert.ok(findings.some((f) => f.code === "endpoint-not-https"));
});

test("SAML metadata: parses cert and flags near-expiry", () => {
  const findings = analyzeSsoMetadata({ content: samlMetadata(SHORT_LIVED_CERT) });
  assert.ok(findings.some((f) => f.code === "cert-expiring-soon" && f.severity === "warning"));
  assert.ok(!findings.some((f) => f.code === "saml-no-entity-id"));
  assert.ok(!findings.some((f) => f.code === "saml-no-sso-endpoint"));
});

test("SAML metadata without cert or SSO endpoint is critical", () => {
  const bare = '<EntityDescriptor entityID="https://idp.example.com"><IDPSSODescriptor></IDPSSODescriptor></EntityDescriptor>';
  const findings = analyzeSsoMetadata({ content: bare });
  assert.ok(findings.some((f) => f.code === "saml-no-signing-cert" && f.severity === "critical"));
  assert.ok(findings.some((f) => f.code === "saml-no-sso-endpoint" && f.severity === "critical"));
});

test("unparseable content is reported, not thrown", () => {
  const findings = analyzeSsoMetadata({ content: "not metadata at all" });
  assert.ok(findings.some((f) => f.code === "metadata-unrecognized" && f.severity === "critical"));
});

test("SSRF guard: https public hosts pass; private/loopback/non-https are rejected", () => {
  assert.equal(checkSsoUrlSafety("https://idp.example.com/.well-known/openid-configuration"), null);
  assert.match(checkSsoUrlSafety("http://idp.example.com/x") ?? "", /https/);
  assert.match(checkSsoUrlSafety("https://127.0.0.1/meta") ?? "", /private|loopback/i);
  assert.match(checkSsoUrlSafety("https://10.0.0.8/meta") ?? "", /private|loopback/i);
  assert.match(checkSsoUrlSafety("https://192.168.1.5/meta") ?? "", /private|loopback/i);
  assert.match(checkSsoUrlSafety("https://169.254.169.254/latest/meta-data") ?? "", /private|loopback/i);
  assert.match(checkSsoUrlSafety("https://localhost/meta") ?? "", /private|loopback/i);
});
