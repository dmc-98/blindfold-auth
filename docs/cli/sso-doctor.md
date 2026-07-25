# blindfold sso doctor

The `sso doctor` command analyzes an identity provider's metadata URL (OIDC discovery document or SAML metadata XML) and surfaces configuration issues before you wire the provider into your application.

## Usage

```bash
# OIDC discovery endpoint
npx blindfold-auth sso doctor --url https://dev-xxxxx.okta.com/.well-known/openid-configuration

# SAML metadata URL
npx blindfold-auth sso doctor --url https://dev-xxxxx.okta.com/app/xxxxx/sso/saml/metadata
```

The command auto-detects OIDC vs SAML from the response content type and root element.

## Checks performed

### OIDC checks

| Check | Severity | Details |
|---|---|---|
| HTTPS-only endpoints | critical | All endpoint URLs in the discovery document must use HTTPS |
| `alg:none` supported | critical | If `none` appears in `id_token_signing_alg_values_supported`, an unsigned token could be accepted |
| PKCE S256 available | warning | `code_challenge_methods_supported` should include `S256` |
| Required fields | warning | `issuer`, `authorization_endpoint`, `token_endpoint`, `jwks_uri` must be present |

### SAML checks

| Check | Severity | Details |
|---|---|---|
| HTTPS binding URLs | critical | All `<SingleSignOnService Location>` and `<AssertionConsumerService Location>` must use HTTPS |
| Signing certificate present | critical | Metadata must include an `X509Certificate` in `<KeyDescriptor use="signing">` |
| Certificate expiry < 30 days | warning | Cert expiring soon — schedule rotation |
| Certificate expiry < 0 days | critical | Cert is expired — SAML auth will fail |
| POST binding available | warning | `urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST` should be in the metadata |

### SSRF protection

The `sso doctor` command only follows HTTPS URLs. Requests to private IP ranges (10.x, 172.16-31.x, 192.168.x), loopback addresses (127.x, ::1), and metadata service addresses (169.254.169.254) are rejected without making a network request. Redirects are not followed.

## Example output

```
blindfold sso doctor v0.1.1
Analyzing: https://dev-xxxxx.okta.com/.well-known/openid-configuration

Protocol detected: OIDC

✅ HTTPS endpoints: all endpoints use HTTPS
✅ alg:none not in supported algorithms
⚠  PKCE S256: not listed in code_challenge_methods_supported
✅ Required fields present: issuer, authorization_endpoint, token_endpoint, jwks_uri

HEALTHY — 0 critical, 1 warning
Issuer: https://dev-xxxxx.okta.com
```

## Cert expiry warning

When a SAML signing certificate is within 30 days of expiry:

```
⚠  Certificate expiry: expires in 12 days (2026-07-28)
   Certificate CN: Okta SAML
   Serial: 7a:b3:...

   Action: rotate the IdP signing certificate before it expires.
   Steps:
   1. In Okta admin → Applications → your app → Sign On → SAML certificates
   2. Generate a new certificate, download metadata XML
   3. Update your provider binding via admin.sso.providers.update()
   4. Re-run: blindfold sso doctor --url <new-metadata-url>
```

## Multi-tenant Entra ID

For multi-tenant Entra ID apps, the issuer in the discovery document contains `{tenantid}` as a placeholder:

```
ℹ  Multi-tenant issuer placeholder detected: https://login.microsoftonline.com/{tenantid}/v2.0
   This is expected for multi-tenant apps. Set issuerTemplate in your provider config:
   
   await auth.admin.sso.providers.create({
     type: 'oidc',
     issuerTemplate: 'https://login.microsoftonline.com/{tenantid}/v2.0',
     // ...
   })
```

## Running in CI (SSO regression gate)

```yaml
- name: Check SSO provider metadata
  run: |
    npx blindfold-auth sso doctor --url $OKTA_METADATA_URL
    npx blindfold-auth sso doctor --url $ENTRA_METADATA_URL
  env:
    OKTA_METADATA_URL: ${{ vars.OKTA_METADATA_URL }}
    ENTRA_METADATA_URL: ${{ vars.ENTRA_METADATA_URL }}
```

This catches certificate expiry and IdP configuration drift before they become production incidents.

## Programmatic use

```ts
import { runSsoDoctor } from '@dmc--98/blindfold-sso'

const findings = await runSsoDoctor({
  url: 'https://dev-xxxxx.okta.com/.well-known/openid-configuration',
})

const critical = findings.filter(f => f.severity === 'critical')
if (critical.length > 0) {
  throw new Error('SSO provider metadata has critical issues: ' + critical.map(f => f.message).join(', '))
}
```

## Related

- [Okta SSO recipe](/sso/okta)
- [Microsoft Entra ID recipe](/sso/entra)
- [SSO overview](/sso/)
