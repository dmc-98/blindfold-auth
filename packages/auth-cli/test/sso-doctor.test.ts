import { test } from "node:test";
import assert from "node:assert";
import { analyzeSsoMetadata, checkSsoUrlSafety } from "../src/sso-doctor.js";

// Self-signed cert that sits inside the 30-day near-expiry warning window.
// Expires Jul 18 2026 (25 days from generation on Jun 23 2026).
// To regenerate: openssl req -x509 -newkey rsa:2048 -keyout /tmp/k.key -out /tmp/c.pem \
//   -days 25 -nodes -subj "/CN=idp.test" && \
//   openssl x509 -in /tmp/c.pem -outform DER | base64 -w 0
const SHORT_LIVED_CERT = "MIIDBzCCAe+gAwIBAgIUbfqa+GjKcq1Wm3+OFo7LQJXAoocwDQYJKoZIhvcNAQELBQAwEzERMA8GA1UEAwwIaWRwLnRlc3QwHhcNMjYwNjIzMTYyNDEyWhcNMjYwNzE4MTYyNDEyWjATMREwDwYDVQQDDAhpZHAudGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMT3c53AB7PAjHWv9EfTCJxcCqoQNAWpP0TGeBjR+Vs6Jr3k9FUmwBJ+ngpqHTCVs3d6wyjVtFkNjPYcPXHa1c3Ek28fCQ3KqJqK388K81/tHshuse+bggkbOOUUVeFpQ5sJKJr+z4cgbE8zWY2jAVK8O+RQsX4Wb3Bc23MU18xjfCeHb6x22wJqzXpGpxi1GNldAiSQO6b9UGD4WPToZz5IyeWWbVPJOPb1na4LiRbS4r/ck4WUixYjGk9yof2xfwW4B1gdqgTouHWaUnRpHrp+U0vf+fkyEdcsumyYHbK5wvwW3flKmaPfgdk7YZgj0drTtlatvESF0LsxF3fEY2sCAwEAAaNTMFEwHQYDVR0OBBYEFBvSp57kO4eW1g/w1uiNBFQRDnUPMB8GA1UdIwQYMBaAFBvSp57kO4eW1g/w1uiNBFQRDnUPMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBADLgj1wnMpAcXHQV0AQ5EjXhmb97Zv1aUAT7wpKq2in8dIYGkCizGpUyV2ojIvlYthIMGkqSbrYo8CSB1jP4qzQF+9+wN8uzgtucox1gjVjctj5+2RIo6Ptcl0a7WGVqQDHvcJwfxY7BjTY2/FzovboXrc/hdkIbdjcc+CptsXHLovez5cWo4rqx5fi854XA7DoYnUAl6ASwRCnpBJ43ytgOVIV/v1PWalP5HDHDbZKmvGh1FPwePo/RXm4uG2/dlN7hcNyejl3XhzEfE987B5r1Ne5kyaNwq+uB41oBNwmpUxGVM272csKz1cA+D8kXNEGgLy1nAY90Zfq0hvOATAs=";

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
