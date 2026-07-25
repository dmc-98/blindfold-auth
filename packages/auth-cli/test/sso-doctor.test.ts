import { test } from "node:test";
import assert from "node:assert";
import { analyzeSsoMetadata, checkSsoUrlSafety } from "../src/sso-doctor.js";

// Self-signed cert that sits inside the 30-day near-expiry warning window.
// Expires Aug 9 2026 (20 days from generation on Jul 20 2026).
// To regenerate: openssl req -x509 -newkey rsa:2048 -keyout /tmp/k.key -out /tmp/c.pem \
//   -days 20 -nodes -subj "/CN=idp.test" && \
//   openssl x509 -in /tmp/c.pem -outform DER | base64 -w 0
const SHORT_LIVED_CERT = "MIIDBzCCAe+gAwIBAgIUT/s8U40vuplbcynROWAwgLrpm0IwDQYJKoZIhvcNAQELBQAwEzERMA8GA1UEAwwIaWRwLnRlc3QwHhcNMjYwNzIwMTEyMDQwWhcNMjYwODA5MTEyMDQwWjATMREwDwYDVQQDDAhpZHAudGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAOOQ9LAzAn22rJqobzPjiqpTJUU9Qi8/Rj88NfUkvX3tjn25sUcrP39fLqh6hZhEy0GFGAEj+kJaHfIBiMhZF3Xw8PaRUeDotY+qA0dzjBGoWXP5JjvSsizIlsPNpX9FJGwWJfslGFW9lv0JpVpfkkWIRGiATdZF9Ekxgp58UIFVtVrSnpmnK5ELccBeqj7Ta6P39yfYtJTVvdJvJGbB3S/bluDBHCIMwquXOICg7rWjQ8evwDAhC5USn7YItEkkCKt3QS4Isu3EGaasa9+V6E7ES08ymk9S4C4s2OSYEJNvxWp2lI/D6rXZW8flBzc9pQVwZERbnms+1jJ1Mh60pzsCAwEAAaNTMFEwHQYDVR0OBBYEFBcr84kdRrOgDdoMFDxVr0iF5lEOMB8GA1UdIwQYMBaAFBcr84kdRrOgDdoMFDxVr0iF5lEOMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAMGmZvmzLGd9ee9iBbFz67lMDX67nn5q9mX41xaQXLdJ/0/bWQ9sQBgo0uInnysSGMUxysr5udDQsoy8GO05k+XbuCxQHJnapTxF+kp0hRByL2FjjGO5OhJx5bo9gXmOL3aOrAnZyN1ZxMTtvyzCGYQX2//83FvoTnA/tNRgFIjWulbY+ArSXly/PSFjMqKv/KXdW7Ds8UT5qAVD9aV/UPDsVzmM6MwqPSJTRdbGsZjycgDBol9WLNoS666sRAHJLkraNHWUVclgQhN8PlncMZkiquL7SehAQzvvWPpN8l8Kv7bq0qf/6E3++qzNwdjcB5najlIsST3aM7pU4K46JDQ=";

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
