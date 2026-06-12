import { DEFAULT_AUTH_METHODS, DEFAULT_SECURITY_CONFIG, DEFAULT_SESSION_CONFIG, TABLES } from "./constants.js";
import { buildOidcRedirectUrl, buildSamlMetadata, mapFederationClaims, resolveProviderChoice } from "./federation.js";
import { buildOidcAuthorizationRequest, calculateOidcCodeChallenge, discoverOidcConfiguration, exchangeOidcAuthorizationCode } from "./oidc.js";
import {
  createPasskeyAuthenticationOptions,
  createPasskeyRegistrationOptions,
  finishPasskeyAuthentication as verifyPasskeyAuthenticationResult,
  finishPasskeyRegistration as verifyPasskeyRegistrationResult,
  registrationInfoToCredentialRecord
} from "./passkeys.js";
import { evaluatePolicies, explainPolicies } from "./policy.js";
import { createSamlClient, samlProfileToClaims } from "./saml.js";
import { createFileStorage, createMemoryStorage } from "./storage.js";
import { generateRecoveryCodes, generateTotpSecret, getTotpCode, verifyTotpCode } from "./totp.js";
import {
  bufferToBase64Url,
  clone,
  hashPassword,
  isSafeRedirectTarget,
  maskValue,
  normalizeEmail,
  now,
  parseDuration,
  randomId,
  randomToken,
  readBearerToken,
  sha256,
  signToken,
  verifyPassword,
  verifySignedToken
} from "./utils.js";

function withTimestamps(record: any, existingRecord: any) {
  return {
    ...existingRecord,
    ...record,
    createdAt: existingRecord?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function toResponse(statusCode: number, payload: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload, null, 2)
  };
}

function mergeObjects(...values: any[]) {
  return Object.assign({}, ...values.filter(Boolean));
}

interface CreateAuthOptions {
  workspaceId?: string;
  secret: string;
  storage?: any;
  session?: any;
  security?: any;
  authMethods?: any;
}

export function createAuth({
  workspaceId = "workspace_local",
  secret,
  storage = createMemoryStorage(),
  session = {},
  security = {},
  authMethods = {}
}: CreateAuthOptions = {} as CreateAuthOptions) {
  if (!secret) {
    throw new Error("createAuth requires a secret");
  }

  const sessionConfig = mergeObjects(DEFAULT_SESSION_CONFIG, session);
  const securityConfig = mergeObjects(DEFAULT_SECURITY_CONFIG, security);
  const enabledAuthMethods = mergeObjects(DEFAULT_AUTH_METHODS, authMethods);
  const accessTokenTtlMs = parseDuration(sessionConfig.accessTokenTtl);
  const refreshTokenTtlMs = parseDuration(sessionConfig.refreshTokenTtl);
  const initialization = storage.ensureTables(TABLES);
  const oidcConfigurationCache = new Map();

  async function writeAuditEvent(event: any) {
    const record = withTimestamps(
      {
        id: event.id || randomId("audit"),
        workspaceId,
        ...event
      },
      null
    );

    await storage.put("audit_events", record);
    return record;
  }

  async function getWorkspaceConfig() {
    await initialization;
    return storage.get("workspace_config", workspaceId);
  }

  async function upsertWorkspaceConfig(config: any) {
    const existing = await getWorkspaceConfig();
    const record = withTimestamps(
      {
        id: workspaceId,
        workspaceId,
        name: config.name || existing?.name || "Blindfold Workspace",
        defaults: mergeObjects(existing?.defaults || {}, config.defaults || {})
      },
      existing
    );

    await storage.put("workspace_config", record);
    return record;
  }

  async function getApplication(applicationId: any) {
    await initialization;
    return storage.get("applications", applicationId);
  }

  async function getApplicationConfig(applicationId: any) {
    const configs = await storage.list("application_auth_config", { applicationId });
    return configs.sort((left: any, right: any) => right.updatedAt.localeCompare(left.updatedAt))[0] || null;
  }

  async function getEffectiveAppConfig(applicationId: any) {
    const workspace = await getWorkspaceConfig();
    const appConfig = await getApplicationConfig(applicationId);
    return mergeObjects(
      {
        session: sessionConfig,
        security: securityConfig,
        authMethods: enabledAuthMethods
      },
      workspace?.defaults || {},
      appConfig?.config || {}
    );
  }

  async function listMemberships(principalId: any, applicationId: any, tenantId: any = null) {
    const memberships = await storage.list("memberships", { principalId, applicationId });
    return memberships.filter((membership: any) => {
      if (tenantId === null || tenantId === undefined) {
        return true;
      }

      return membership.tenantId === tenantId;
    });
  }

  async function getRolePermissions(roleIds: any, applicationId: any) {
    const rows = await storage.list("role_permissions", { applicationId });
    return rows.filter((row: any) => roleIds.includes(row.roleId));
  }

  async function getDirectGrants(principalId: any, applicationId: any) {
    return storage.list("direct_grants", { principalId, applicationId });
  }

  async function getPolicies(applicationId: any) {
    return storage.list("policy_rules", { applicationId });
  }

  async function getIdentityProviders() {
    return storage.list("identity_providers");
  }

  async function getIdentityProvider(providerId: any) {
    return storage.get("identity_providers", providerId);
  }

  async function listApplicationProviders(applicationId: any) {
    return storage.list("application_identity_providers", { applicationId });
  }

  async function getApplicationProvider(bindingId: any) {
    return storage.get("application_identity_providers", bindingId);
  }

  async function listPasskeys({ principalId = null, applicationId = null }: { principalId?: any; applicationId?: any } = {}) {
    const filter: Record<string, any> = {};
    if (principalId) {
      filter.principalId = principalId;
    }
    if (applicationId) {
      filter.applicationId = applicationId;
    }

    return storage.list("webauthn_credentials", filter);
  }

  async function findPasskeyCredential({ applicationId, credentialId }: { applicationId: any; credentialId: any }) {
    const credentials = await storage.list("webauthn_credentials", { applicationId, credentialId });
    return credentials.find((credential: any) => credential.status !== "revoked") || null;
  }

  async function listFederatedIdentities(filter: any = {}) {
    return storage.list("federated_identities", filter);
  }

  async function createChallengeRecord(record: any) {
    const challengeRecord = withTimestamps(
      {
        id: randomId("challenge"),
        workspaceId,
        status: "active",
        ...record
      },
      null
    );

    await storage.put("auth_challenges", challengeRecord);
    return challengeRecord;
  }

  async function getChallengeRecord(id: any) {
    return storage.get("auth_challenges", id);
  }

  async function completeChallengeRecord(record: any, status = "used") {
    const nextRecord = withTimestamps(
      {
        ...record,
        status
      },
      record
    );
    await storage.put("auth_challenges", nextRecord);
    return nextRecord;
  }

  async function assertChallengeRecord({ id, type, applicationId, providerId = null, allowNoState = false }: { id?: any; type?: any; applicationId?: any; providerId?: any; allowNoState?: any }) {
    if (!id && allowNoState) {
      return null;
    }

    const record = await getChallengeRecord(id);
    if (!record || record.status !== "active") {
      throw new Error("Challenge not found");
    }

    if (type && record.type !== type) {
      throw new Error("Challenge type mismatch");
    }

    if (applicationId && record.applicationId !== applicationId) {
      throw new Error("Challenge application mismatch");
    }

    if (providerId && record.providerId !== providerId) {
      throw new Error("Challenge provider mismatch");
    }

    if (new Date(record.expiresAt).getTime() < now()) {
      throw new Error("Challenge expired");
    }

    return record;
  }

  async function findPrincipalCandidatesByEmail(email: any) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return [];
    }

    return storage.list("principals", { email: normalizedEmail });
  }

  async function getPrincipalByEmail(email: any) {
    const normalizedEmail = normalizeEmail(email);
    const principals = await storage.list("principals", { email: normalizedEmail });
    return principals[0] || null;
  }

  async function assertPrincipalApplicationAccess({ principalId, applicationId, tenantId = null }: { principalId: any; applicationId: any; tenantId?: any }) {
    const memberships = await listMemberships(principalId, applicationId, tenantId);
    if (memberships.length === 0) {
      throw new Error("Principal has no access to this application");
    }

    return memberships;
  }

  async function assertLoginRateLimit(applicationId: any, identifier: any) {
    const limitConfig = mergeObjects(DEFAULT_SECURITY_CONFIG.rateLimits.login, securityConfig.rateLimits?.login);
    const normalizedIdentifier = normalizeEmail(identifier) || String(identifier || "");
    const scopeKey = `login:${applicationId}:${normalizedIdentifier}`;
    const id = sha256(scopeKey);
    const existing = await storage.get("rate_limit_counters", id);
    const timestamp = now();

    if (existing?.blockedUntil && timestamp < existing.blockedUntil) {
      throw new Error("Too many attempts. Try again later.");
    }

    return async function recordAttempt(success: any) {
      const current = await storage.get("rate_limit_counters", id);
      const windowStart = current && timestamp - current.windowStart < limitConfig.windowMs ? current.windowStart : timestamp;
      const count = success ? 0 : (current?.count || 0) + 1;
      const blockedUntil = count >= limitConfig.limit ? timestamp + limitConfig.blockMs : null;
      await storage.put(
        "rate_limit_counters",
        withTimestamps(
          {
            id,
            scope: "login",
            key: scopeKey,
            applicationId,
            identifier,
            count,
            windowStart,
            blockedUntil
          },
          current
        )
      );
    };
  }

  async function issueSession({
    applicationId,
    principal,
    authStrength = "password",
    tenantId = null,
    device = null,
    requireApplicationAccess = true
  }: { applicationId: any; principal: any; authStrength?: any; tenantId?: any; device?: any; requireApplicationAccess?: any }) {
    const application = await getApplication(applicationId);
    if (!application || application.status !== "active") {
      throw new Error("Application is not active");
    }

    if (!principal) {
      throw new Error("Principal not found");
    }

    if (principal.status !== "active") {
      throw new Error("Principal is not active");
    }

    if (requireApplicationAccess) {
      await assertPrincipalApplicationAccess({
        principalId: principal.id,
        applicationId,
        tenantId
      });
    }

    const sessionId = randomId("session");
    const refreshToken = `${sessionId}.${randomToken(32)}`;
    const accessToken = signToken(
      {
        sid: sessionId,
        pid: principal.id,
        aid: applicationId,
        wid: workspaceId,
        iat: Math.floor(now() / 1000),
        exp: Math.floor((now() + accessTokenTtlMs) / 1000)
      },
      secret
    );

    const record = withTimestamps(
      {
        id: sessionId,
        workspaceId,
        applicationId,
        principalId: principal.id,
        tenantId,
        device,
        authStrength,
        status: "active",
        accessTokenHash: sha256(accessToken),
        refreshTokenHash: sha256(refreshToken),
        accessExpiresAt: new Date(now() + accessTokenTtlMs).toISOString(),
        refreshExpiresAt: new Date(now() + refreshTokenTtlMs).toISOString(),
        rotationCounter: 0
      },
      null
    );

    await storage.put("sessions", record);
    await writeAuditEvent({
      type: "session.created",
      actorId: principal.id,
      principalId: principal.id,
      applicationId,
      data: { sessionId }
    });

    return {
      session: record,
      accessToken,
      refreshToken
    };
  }

  async function verifySession({ accessToken }: { accessToken: any }): Promise<any> {
    const payload: any = verifySignedToken(accessToken, secret);
    if (!payload) {
      return { ok: false, reason: "invalid token" };
    }

    if (payload.exp * 1000 < now()) {
      return { ok: false, reason: "token expired" };
    }

    const sessionRecord = await storage.get("sessions", payload.sid);
    if (!sessionRecord || sessionRecord.status !== "active") {
      return { ok: false, reason: "session revoked" };
    }

    if (sessionRecord.accessTokenHash !== sha256(accessToken)) {
      return { ok: false, reason: "token mismatch" };
    }

    const application = await getApplication(sessionRecord.applicationId);
    const principal = await storage.get("principals", sessionRecord.principalId);
    if (!application || application.status !== "active") {
      return { ok: false, reason: "application inactive" };
    }

    if (!principal || principal.status !== "active") {
      return { ok: false, reason: "principal inactive" };
    }

    try {
      await assertPrincipalApplicationAccess({
        principalId: principal.id,
        applicationId: sessionRecord.applicationId,
        tenantId: sessionRecord.tenantId
      });
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }

    return {
      ok: true,
      payload,
      session: sessionRecord,
      application,
      principal
    };
  }

  async function refreshSession({ refreshToken }: { refreshToken: any }) {
    const [sessionId] = String(refreshToken || "").split(".");
    const sessionRecord = await storage.get("sessions", sessionId);
    if (!sessionRecord || sessionRecord.status !== "active") {
      throw new Error("Session not found");
    }

    if (sessionRecord.refreshTokenHash !== sha256(refreshToken)) {
      throw new Error("Invalid refresh token");
    }

    if (new Date(sessionRecord.refreshExpiresAt).getTime() < now()) {
      throw new Error("Refresh token expired");
    }

    const principal = await storage.get("principals", sessionRecord.principalId);
    const nextSession = await issueSession({
      applicationId: sessionRecord.applicationId,
      principal,
      authStrength: sessionRecord.authStrength,
      tenantId: sessionRecord.tenantId,
      device: sessionRecord.device
    });

    await storage.put(
      "sessions",
      withTimestamps(
        {
          ...sessionRecord,
          status: "rotated",
          rotatedToSessionId: nextSession.session.id
        },
        sessionRecord
      )
    );

    await storage.put(
      "revocations",
      withTimestamps(
        {
          id: randomId("revocation"),
          sessionId: sessionRecord.id,
          principalId: sessionRecord.principalId,
          applicationId: sessionRecord.applicationId,
          reason: "refresh rotation"
        },
        null
      )
    );

    return nextSession;
  }

  async function revokeSession({ sessionId, refreshToken, reason = "manual revoke" }: { sessionId?: any; refreshToken?: any; reason?: any }) {
    const resolvedSessionId = sessionId || String(refreshToken || "").split(".")[0];
    const sessionRecord = await storage.get("sessions", resolvedSessionId);
    if (!sessionRecord) {
      return false;
    }

    if (refreshToken && sessionRecord.refreshTokenHash !== sha256(refreshToken)) {
      return false;
    }

    await storage.put(
      "sessions",
      withTimestamps(
        {
          ...sessionRecord,
          status: "revoked"
        },
        sessionRecord
      )
    );

    await storage.put(
      "revocations",
      withTimestamps(
        {
          id: randomId("revocation"),
          sessionId: sessionRecord.id,
          principalId: sessionRecord.principalId,
          applicationId: sessionRecord.applicationId,
          reason
        },
        null
      )
    );

    await writeAuditEvent({
      type: "session.revoked",
      actorId: sessionRecord.principalId,
      principalId: sessionRecord.principalId,
      applicationId: sessionRecord.applicationId,
      data: { sessionId: sessionRecord.id, reason }
    });

    return true;
  }

  async function authenticatePassword({ applicationId, email, password, mfaCode, recoveryCode }: { applicationId: any; email: any; password: any; mfaCode?: any; recoveryCode?: any }) {
    const normalizedEmail = normalizeEmail(email);
    const appConfig = await getEffectiveAppConfig(applicationId);
    if (appConfig.authMethods?.password === false) {
      throw new Error("Password authentication is disabled");
    }

    const principal = await getPrincipalByEmail(normalizedEmail);
    const recordAttempt = await assertLoginRateLimit(applicationId, normalizedEmail);

    if (!principal) {
      await recordAttempt(false);
      throw new Error("Invalid credentials");
    }

    if (!verifyPassword(password, principal.passwordHash)) {
      await recordAttempt(false);
      await writeAuditEvent({
        type: "auth.failed",
        actorId: principal.id,
        principalId: principal.id,
        applicationId,
        data: { reason: "invalid password" }
      });
      throw new Error("Invalid credentials");
    }

    try {
      await assertPrincipalApplicationAccess({
        principalId: principal.id,
        applicationId
      });
    } catch (error) {
      await recordAttempt(false);
      throw error;
    }

    const requiresTotp = principal.mfa?.totp?.enabled || appConfig.mfa?.required;
    if (requiresTotp) {
      const acceptedRecoveryCodes = principal.mfa?.recoveryCodes || [];
      const recoveryCodeIndex = acceptedRecoveryCodes.findIndex((code: any) => sha256(recoveryCode) === code);
      const hasValidTotp = mfaCode && principal.mfa?.totp?.secret && verifyTotpCode(principal.mfa.totp.secret, mfaCode);
      const hasValidRecoveryCode = recoveryCodeIndex >= 0;
      if (!hasValidTotp && !hasValidRecoveryCode) {
        await recordAttempt(false);
        throw new Error("MFA required");
      }

      if (hasValidRecoveryCode) {
        principal.mfa.recoveryCodes.splice(recoveryCodeIndex, 1);
        await storage.put("principals", withTimestamps(principal, principal));
      }
    }

    await recordAttempt(true);
    return issueSession({
      applicationId,
      principal,
      authStrength: requiresTotp ? "mfa" : "password"
    });
  }

  async function createMagicLink({ applicationId, email, redirectTo = "/" }: { applicationId: any; email: any; redirectTo?: any }) {
    const appConfig = await getEffectiveAppConfig(applicationId);
    if (appConfig.authMethods?.magicLink === false) {
      throw new Error("Magic link authentication is disabled");
    }

    const application = await getApplication(applicationId);
    if (!application || application.status !== "active") {
      throw new Error("Application is not active");
    }

    if (appConfig.security?.magicLinks?.requireRelativeRedirects && !isSafeRedirectTarget(redirectTo)) {
      throw new Error("Redirect target must be a relative path");
    }

    const principal = await getPrincipalByEmail(email);
    if (!principal) {
      throw new Error("Unknown principal");
    }

    await assertPrincipalApplicationAccess({
      principalId: principal.id,
      applicationId
    });

    const token = randomToken(24);
    const challenge = withTimestamps(
      {
        id: randomId("challenge"),
        type: "magic_link",
        applicationId,
        principalId: principal.id,
        tokenHash: sha256(token),
        redirectTo,
        expiresAt: new Date(now() + 15 * 60_000).toISOString(),
        status: "active"
      },
      null
    );

    await storage.put("auth_challenges", challenge);
    await writeAuditEvent({
      type: "magic_link.created",
      actorId: principal.id,
      principalId: principal.id,
      applicationId,
      data: { challengeId: challenge.id }
    });

    return {
      token,
      url: `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}token=${token}&applicationId=${applicationId}`
    };
  }

  async function consumeMagicLink({ applicationId, token }: { applicationId: any; token: any }) {
    const appConfig = await getEffectiveAppConfig(applicationId);
    if (appConfig.authMethods?.magicLink === false) {
      throw new Error("Magic link authentication is disabled");
    }

    const challenges = await storage.list("auth_challenges", {
      applicationId,
      status: "active",
      tokenHash: sha256(token)
    });
    const challenge = challenges[0] || null;
    if (!challenge) {
      throw new Error("Magic link not found");
    }

    if (new Date(challenge.expiresAt).getTime() < now()) {
      throw new Error("Magic link expired");
    }

    await storage.put(
      "auth_challenges",
      withTimestamps(
        {
          ...challenge,
          status: "used"
        },
        challenge
      )
    );

    const principal = await storage.get("principals", challenge.principalId);
    return issueSession({
      applicationId,
      principal,
      authStrength: "magic_link"
    });
  }

  function getRequestHost(request: any = {}) {
    return request.headers?.host || request.headers?.Host || request.host || "localhost";
  }

  function getRequestOrigin(request: any = {}) {
    return request.origin || request.headers?.origin || request.headers?.Origin || `http://${getRequestHost(request)}`;
  }

  function normalizeClaimsPayload(value: any) {
    if (!value) {
      return {};
    }

    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    }

    return value;
  }

  async function verifyRequestSession(request: any = {}, expectedApplicationId: any = null) {
    const accessToken = request.body?.accessToken || readBearerToken(request.headers || {});
    if (!accessToken) {
      throw new Error("missing bearer token");
    }

    const verified = await verifySession({ accessToken });
    if (!verified.ok) {
      throw new Error(verified.reason);
    }

    if (expectedApplicationId && verified.session.applicationId !== expectedApplicationId) {
      throw new Error("session application mismatch");
    }

    return verified;
  }

  async function setApplicationPrincipalPreference({ applicationId, principalId, preferredAuthMethod = "passkey" }: { applicationId: any; principalId: any; preferredAuthMethod?: any }) {
    const existing = (await storage.list("application_principals", { applicationId, principalId }))[0] || null;
    const record = withTimestamps(
      {
        id: existing?.id || randomId("appprincipal"),
        workspaceId,
        applicationId,
        principalId,
        preferredAuthMethod
      },
      existing
    );

    await storage.put("application_principals", record);
    return record;
  }

  async function beginPasskeyRegistration({ applicationId, nickname = null }: { applicationId: any; nickname?: any }, request: any = {}) {
    const verified = await verifyRequestSession(request, applicationId);
    const appConfig = await getEffectiveAppConfig(applicationId);
    if (appConfig.authMethods?.passkey === false) {
      throw new Error("Passkey authentication is disabled");
    }

    const existingCredentials = await listPasskeys({
      principalId: verified.principal.id,
      applicationId
    });
    const { options, passkeyConfig } = await createPasskeyRegistrationOptions({
      application: verified.application,
      appConfig,
      request,
      principal: verified.principal,
      existingCredentials
    });

    const challenge = await createChallengeRecord({
      type: "webauthn_registration",
      applicationId,
      principalId: verified.principal.id,
      challenge: options.challenge,
      rpID: passkeyConfig.rpID,
      expectedOrigins: passkeyConfig.origins,
      nickname,
      expiresAt: new Date(now() + 5 * 60_000).toISOString()
    });

    return {
      challengeId: challenge.id,
      options
    };
  }

  async function finishPasskeyRegistration({ applicationId, challengeId, response, nickname = null }: { applicationId: any; challengeId: any; response: any; nickname?: any }, request: any = {}) {
    const verified = await verifyRequestSession(request, applicationId);
    const challenge = await assertChallengeRecord({
      id: challengeId,
      type: "webauthn_registration",
      applicationId
    });

    if (challenge.principalId !== verified.principal.id) {
      throw new Error("Challenge principal mismatch");
    }

    const verification = await verifyPasskeyRegistrationResult({
      response,
      challenge: challenge.challenge,
      expectedOrigins: challenge.expectedOrigins,
      rpID: challenge.rpID
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error("Passkey registration failed");
    }

    const credentialRecord = withTimestamps(
      {
        id: randomId("passkey"),
        workspaceId,
        ...registrationInfoToCredentialRecord({
          registrationInfo: verification.registrationInfo,
          principalId: verified.principal.id,
          applicationId,
          rpID: challenge.rpID,
          nickname: nickname || challenge.nickname || null
        }),
        status: "active",
        createdBySessionId: verified.session.id,
        lastUsedAt: null
      },
      null
    );

    await storage.put("webauthn_credentials", credentialRecord);
    await setApplicationPrincipalPreference({
      applicationId,
      principalId: verified.principal.id,
      preferredAuthMethod: "passkey"
    });
    await completeChallengeRecord(challenge);
    await writeAuditEvent({
      type: "passkey.registered",
      actorId: verified.principal.id,
      principalId: verified.principal.id,
      applicationId,
      data: { credentialId: credentialRecord.credentialId }
    });

    return {
      ok: true,
      credential: credentialRecord
    };
  }

  async function beginPasskeyAuthentication({ applicationId, email = null }: { applicationId: any; email?: any }, request: any = {}) {
    const application = await getApplication(applicationId);
    if (!application || application.status !== "active") {
      throw new Error("Application is not active");
    }

    const appConfig = await getEffectiveAppConfig(applicationId);
    if (appConfig.authMethods?.passkey === false) {
      throw new Error("Passkey authentication is disabled");
    }

    let credentials: any[] = [];
    let principalId = null;
    if (email) {
      const principal = await getPrincipalByEmail(email);
      if (principal) {
        principalId = principal.id;
        credentials = await listPasskeys({ principalId: principal.id, applicationId });
      }
    }

    const { options, passkeyConfig } = await createPasskeyAuthenticationOptions({
      application,
      appConfig,
      request,
      credentials
    });

    const challenge = await createChallengeRecord({
      type: "webauthn_authentication",
      applicationId,
      principalId,
      challenge: options.challenge,
      rpID: passkeyConfig.rpID,
      expectedOrigins: passkeyConfig.origins,
      expiresAt: new Date(now() + 5 * 60_000).toISOString()
    });

    return {
      challengeId: challenge.id,
      options
    };
  }

  async function finishPasskeyAuthentication({ applicationId, challengeId, response }: { applicationId: any; challengeId: any; response: any }, request: any = {}) {
    const challenge = await assertChallengeRecord({
      id: challengeId,
      type: "webauthn_authentication",
      applicationId
    });

    const credential = await findPasskeyCredential({
      applicationId,
      credentialId: response?.id
    });
    if (!credential) {
      throw new Error("Passkey credential not found");
    }

    const verification = await verifyPasskeyAuthenticationResult({
      response,
      challenge: challenge.challenge,
      expectedOrigins: challenge.expectedOrigins,
      rpID: challenge.rpID,
      credential
    });

    if (!verification.verified) {
      throw new Error("Passkey authentication failed");
    }

    const nextCredential = withTimestamps(
      {
        ...credential,
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date().toISOString()
      },
      credential
    );
    await storage.put("webauthn_credentials", nextCredential);
    await completeChallengeRecord(challenge);

    const principal = await storage.get("principals", credential.principalId);
    const sessionResult = await issueSession({
      applicationId,
      principal,
      authStrength: "passkey"
    });
    await writeAuditEvent({
      type: "passkey.authenticated",
      actorId: principal.id,
      principalId: principal.id,
      applicationId,
      data: { credentialId: credential.credentialId }
    });

    return sessionResult;
  }

  async function getProviderContext({ applicationId }: { applicationId: any }) {
    const bindings = await listApplicationProviders(applicationId);
    const providers = await getIdentityProviders();
    return {
      bindings,
      providersById: new Map<string, any>(providers.map((provider: any): [string, any] => [provider.id, provider]))
    };
  }

  async function assignDefaultRolesIfNeeded({ principalId, applicationId, binding, actorId = "system" }: { principalId: any; applicationId: any; binding: any; actorId?: any }) {
    const existingMemberships = await listMemberships(principalId, applicationId);
    if (existingMemberships.length > 0) {
      return existingMemberships;
    }

    const assignedMemberships = [];
    for (const roleId of binding.defaultRoleIds || []) {
      assignedMemberships.push(
        await admin.memberships.assignRole({
          principalId,
          applicationId,
          roleId,
          actorId,
          attributes: { source: "federation_jit" }
        })
      );
    }

    return assignedMemberships;
  }

  async function provisionFederatedPrincipal({ applicationId, provider, binding, claims, protocol, actorId = "system" }: { applicationId: any; provider: any; binding: any; claims: any; protocol: any; actorId?: any }) {
    const mappedClaims = mapFederationClaims({
      claims,
      claimMappings: mergeObjects(provider.claimMappings || {}, binding.claimMappings || {})
    });

    if (!mappedClaims.subject) {
      throw new Error("Federation claims missing subject");
    }

    const existingIdentity = (
      await listFederatedIdentities({
        applicationId,
        providerId: provider.id,
        externalSubject: mappedClaims.subject
      })
    )[0] || null;

    let principal = existingIdentity ? await storage.get("principals", existingIdentity.principalId) : null;
    if (!principal) {
      if (!mappedClaims.email) {
        throw new Error("Federation claims missing email");
      }

      const candidates = await findPrincipalCandidatesByEmail(mappedClaims.email);
      if (candidates.length > 1) {
        throw new Error("Federation claims map ambiguously to multiple principals");
      }

      principal =
        candidates[0] ||
        (await admin.principals.create({
          email: mappedClaims.email,
          displayName: mappedClaims.displayName || mappedClaims.email,
          password: null,
          actorId,
          attributes: {
            federationProtocol: protocol,
            federationProviderId: provider.id
          }
        }));

      if (!existingIdentity) {
        await storage.put(
          "federated_identities",
          withTimestamps(
            {
              id: randomId("fedident"),
              workspaceId,
              applicationId,
              providerId: provider.id,
              principalId: principal.id,
              externalSubject: mappedClaims.subject,
              protocol,
              email: mappedClaims.email,
              claimMappings: binding.claimMappings || {}
            },
            null
          )
        );
      }
    }

    await assignDefaultRolesIfNeeded({
      principalId: principal.id,
      applicationId,
      binding,
      actorId
    });

    await writeAuditEvent({
      type: `${protocol}.linked`,
      actorId,
      principalId: principal.id,
      applicationId,
      data: {
        providerId: provider.id,
        subject: mappedClaims.subject,
        email: mappedClaims.email
      }
    });

    return principal;
  }

  function buildProtocolRedirectUri(request: any, protocol: any) {
    const origin = getRequestOrigin(request);
    return `${origin}/auth/${protocol}/callback`;
  }

  function buildProtocolCallbackUrl(request: any, protocol: any, payload: any = {}) {
    const url = new URL(buildProtocolRedirectUri(request, protocol));
    for (const [key, value] of Object.entries(payload)) {
      if (value === null || value === undefined) {
        continue;
      }

      if (typeof value === "object") {
        url.searchParams.set(key, JSON.stringify(value));
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    return url;
  }

  function isDemoProvider(provider: any) {
    return provider?.mode === "demo";
  }

  function serializeProviderForClient(provider: any) {
    if (!provider) {
      return null;
    }

    return {
      id: provider.id,
      key: provider.key,
      name: provider.name,
      type: provider.type,
      mode: provider.mode || "live",
      issuer: provider.issuer || null,
      discoveryUrl: provider.discoveryUrl || null,
      status: provider.status,
      authorizationUrl: provider.authorizationUrl || null,
      ssoUrl: provider.ssoUrl || null,
      clientId: provider.clientId || null,
      claimMappings: provider.claimMappings || {}
    };
  }

  function createSamlCacheProvider({ applicationId, providerId, bindingId }: { applicationId: any; providerId: any; bindingId: any }) {
    return {
      async saveAsync(key: any, value: any) {
        const existing = await storage.get("auth_challenges", `samlreq_${key}`);
        const record = withTimestamps(
          {
            id: `samlreq_${key}`,
            workspaceId,
            applicationId,
            providerId,
            bindingId,
            type: "saml_request_id",
            requestId: key,
            value,
            status: "active",
            expiresAt: new Date(now() + 10 * 60_000).toISOString()
          },
          existing
        );
        await storage.put("auth_challenges", record);
        return {
          value,
          createdAt: new Date(record.createdAt).getTime()
        };
      },
      async getAsync(key: any) {
        const record = await storage.get("auth_challenges", `samlreq_${key}`);
        if (!record || record.status !== "active") {
          return null;
        }

        if (new Date(record.expiresAt).getTime() < now()) {
          await storage.delete("auth_challenges", record.id);
          return null;
        }

        return record.value || key;
      },
      async removeAsync(key: any) {
        if (!key) {
          return null;
        }

        const record = await storage.get("auth_challenges", `samlreq_${key}`);
        if (!record) {
          return null;
        }

        await storage.delete("auth_challenges", record.id);
        return record.value || key;
      }
    };
  }

  async function startFederation(protocol: any, { applicationId, providerId = null, email = null }: { applicationId: any; providerId?: any; email?: any }, request: any = {}) {
    const application = await getApplication(applicationId);
    if (!application || application.status !== "active") {
      throw new Error("Application is not active");
    }

    const appConfig = await getEffectiveAppConfig(applicationId);
    if (appConfig.authMethods?.[protocol] === false) {
      throw new Error(`${protocol.toUpperCase()} authentication is disabled`);
    }

    const providerContext = await getProviderContext({ applicationId });
    const choice = await resolveProviderChoice({
      bindings: providerContext.bindings,
      providersById: providerContext.providersById,
      protocol,
      providerId,
      email
    });

    if (choice.multiple) {
      return {
        ok: false,
        multipleProviders: true,
        providerChoices: choice.choices
      };
    }

    const { binding, provider } = choice;
    const state = randomToken(16);
    let challenge = await createChallengeRecord({
      type: `${protocol}_state`,
      applicationId,
      providerId: provider.id,
      bindingId: binding.id,
      state,
      nonce: protocol === "oidc" ? randomToken(16) : null,
      requestedEmail: normalizeEmail(email),
      expiresAt: new Date(now() + 10 * 60_000).toISOString()
    });

    if (protocol === "oidc") {
      if (isDemoProvider(provider)) {
        return {
          ok: true,
          provider: serializeProviderForClient(provider),
          binding,
          state,
          redirectTo: buildOidcRedirectUrl({
            provider,
            binding,
            state,
            nonce: challenge.nonce,
            applicationId,
            redirectUri: buildProtocolRedirectUri(request, "oidc"),
            loginHint: email
          } as any),
          demoCallback: {
            state,
            applicationId,
            providerId: provider.id,
            claims: {
              sub: `${provider.key || provider.id}:${normalizeEmail(email) || "principal"}`,
              email: normalizeEmail(email),
              name: email ? email.split("@")[0] : provider.name
            }
          }
        };
      }

      const codeVerifier = randomToken(32);
      challenge = await storage.put(
        "auth_challenges",
        withTimestamps(
          {
            ...challenge,
            codeVerifier
          },
          challenge
        )
      );
      const scope = binding.scope || provider.scope || "openid profile email";
      let redirectTo = null;
      if (provider.authorizationUrl || binding.authorizationUrl) {
        redirectTo = buildOidcRedirectUrl({
          provider,
          binding,
          state,
          nonce: challenge.nonce,
          applicationId,
          redirectUri: buildProtocolRedirectUri(request, "oidc"),
          loginHint: email,
          scope,
          codeChallenge: await calculateOidcCodeChallenge(codeVerifier)
        } as any);
      } else {
        const configuration = await discoverOidcConfiguration({
          cache: oidcConfigurationCache,
          provider,
          binding
        });
        redirectTo = await buildOidcAuthorizationRequest({
          configuration,
          redirectUri: buildProtocolRedirectUri(request, "oidc"),
          loginHint: email,
          scope,
          state,
          nonce: challenge.nonce,
          codeVerifier
        });
      }

      return {
        ok: true,
        provider: serializeProviderForClient(provider),
        binding,
        state,
        redirectTo
      };
    }

    if (isDemoProvider(provider)) {
      return {
        ok: true,
        provider: serializeProviderForClient(provider),
        binding,
        state,
        relayState: state,
        redirectTo: provider.ssoUrl || binding.ssoUrl || null,
        samlRequest: bufferToBase64Url(
          JSON.stringify({
            applicationId,
            providerId: provider.id,
            relayState: state
          })
        ),
        demoCallback: {
          relayState: state,
          applicationId,
          providerId: provider.id,
          claims: {
            sub: `${provider.key || provider.id}:${normalizeEmail(email) || "principal"}`,
            email: normalizeEmail(email),
            name: email ? email.split("@")[0] : provider.name
          }
        }
      };
    }

    const requestId = `_${randomToken(16)}`;
    challenge = await storage.put(
      "auth_challenges",
      withTimestamps(
        {
          ...challenge,
          requestId
        },
        challenge
      )
    );
    const samlClient = createSamlClient({
      application,
      provider,
      binding,
      callbackUrl: buildProtocolRedirectUri(request, "saml"),
      cacheProvider: createSamlCacheProvider({
        applicationId,
        providerId: provider.id,
        bindingId: binding.id
      }),
      requestId,
      validateInResponseTo: binding.allowIdpInitiated ? "ifPresent" : "always"
    });
    const redirectTo = await samlClient.getAuthorizeUrlAsync(state, getRequestHost(request), {});
    const samlRequest = new URL(redirectTo).searchParams.get("SAMLRequest");

    return {
      ok: true,
      provider: serializeProviderForClient(provider),
      binding,
      state,
      relayState: state,
      redirectTo,
      samlRequest
    };
  }

  async function finishFederation(protocol: any, payload: any, request: any = {}) {
    const stateValue = protocol === "oidc" ? payload.state : payload.relayState || payload.RelayState || null;
    let challenge = null;

    if (stateValue) {
      const matches = await storage.list("auth_challenges", {
        type: `${protocol}_state`,
        state: stateValue
      });
      const current = matches[0] || null;
      challenge = current
        ? await assertChallengeRecord({
            id: current.id,
            type: `${protocol}_state`,
            applicationId: payload.applicationId || current.applicationId,
            providerId: payload.providerId || current.providerId
          })
        : null;
    }

    const applicationId = payload.applicationId || challenge?.applicationId;
    const providerId = payload.providerId || challenge?.providerId;
    if (!applicationId || !providerId) {
      throw new Error(`${protocol.toUpperCase()} callback is missing applicationId or providerId`);
    }

    const application = await getApplication(applicationId);
    if (!application || application.status !== "active") {
      throw new Error("Application is not active");
    }

    const provider = await getIdentityProvider(providerId);
    if (!provider || provider.status === "disabled") {
      throw new Error("Identity provider not found");
    }

    const bindings = await listApplicationProviders(applicationId);
    const binding = bindings.find((entry: any) => entry.providerId === providerId && entry.enabled !== false);
    if (!binding) {
      throw new Error("Application provider binding not found");
    }

    let claims = null;
    if (protocol === "oidc") {
      if (!challenge) {
        throw new Error("OIDC state not found");
      }

      if (isDemoProvider(provider) && payload.claims) {
        claims = normalizeClaimsPayload(payload.claims || {});
      } else {
        if (payload.claims) {
          throw new Error("Direct OIDC claims are only allowed for demo providers");
        }

        if (!payload.code) {
          throw new Error("OIDC callback is missing authorization code");
        }

        const configuration = await discoverOidcConfiguration({
          cache: oidcConfigurationCache,
          provider,
          binding
        });
        const tokens = await exchangeOidcAuthorizationCode({
          configuration,
          currentUrl: buildProtocolCallbackUrl(request, "oidc", {
            code: payload.code,
            state: payload.state,
            iss: payload.iss,
            error: payload.error,
            error_description: payload.error_description,
            error_uri: payload.error_uri
          }),
          state: challenge.state,
          nonce: challenge.nonce,
          codeVerifier: challenge.codeVerifier
        });
        claims = tokens.claims();
        if (!claims) {
          throw new Error("OIDC callback did not return ID token claims");
        }
      }
    } else if (isDemoProvider(provider) && payload.claims) {
      claims = normalizeClaimsPayload(payload.claims || {});
    } else {
      if (payload.claims) {
        throw new Error("Direct SAML claims are only allowed for demo providers");
      }

      if (!payload.SAMLResponse) {
        throw new Error("SAML callback is missing SAMLResponse");
      }

      if (!challenge && !binding.allowIdpInitiated) {
        throw new Error("IdP-initiated SAML is not enabled for this binding");
      }

      const samlClient = createSamlClient({
        application,
        provider,
        binding,
        callbackUrl: buildProtocolRedirectUri(request, "saml"),
        cacheProvider: createSamlCacheProvider({
          applicationId,
          providerId,
          bindingId: binding.id
        }),
        validateInResponseTo: challenge ? "always" : binding.allowIdpInitiated ? "ifPresent" : "always"
      });
      const validation = await samlClient.validatePostResponseAsync({
        SAMLResponse: payload.SAMLResponse
      });
      if (!validation.profile) {
        throw new Error("SAML callback did not return a validated profile");
      }

      claims = samlProfileToClaims(validation.profile);
    }

    const principal = await provisionFederatedPrincipal({
      applicationId,
      provider,
      binding,
      claims,
      protocol
    });

    if (challenge) {
      await completeChallengeRecord(challenge);
    }

    const result = await issueSession({
      applicationId,
      principal,
      authStrength: protocol
    });

    await writeAuditEvent({
      type: `${protocol}.authenticated`,
      actorId: principal.id,
      principalId: principal.id,
      applicationId,
      data: {
        providerId,
        idpInitiated: protocol === "saml" ? !challenge : false
      }
    });

    return result;
  }

  async function evaluateAuthorization({
    principalId,
    applicationId,
    action,
    resource,
    field = null,
    tenantId = null,
    resourceAttributes = {},
    request = {},
    principal: preloadedPrincipal = null,
    application: preloadedApplication = null,
    includeTrace = false
  }: { principalId: any; applicationId: any; action: any; resource: any; field?: any; tenantId?: any; resourceAttributes?: any; request?: any; principal?: any; application?: any; includeTrace?: boolean }) {
    const application = preloadedApplication || (await getApplication(applicationId));
    const principal = preloadedPrincipal || (await storage.get("principals", principalId));
    const hardDenyReasons = [];

    if (!application || application.status !== "active") {
      hardDenyReasons.push("application inactive");
    }

    if (!principal || principal.status !== "active") {
      hardDenyReasons.push("principal inactive");
    }

    const memberships = await listMemberships(principalId, applicationId, tenantId);
    const roleIds = memberships.map((membership: any) => membership.roleId).filter(Boolean);
    const rolePermissions = await getRolePermissions(roleIds, applicationId);
    const directGrants = await getDirectGrants(principalId, applicationId);
    const policies = await getPolicies(applicationId);

    const context = {
      subject: {
        id: principal?.id,
        email: principal?.email,
        roleIds,
        tenantId,
        authStrength: request.authStrength,
        ...(principal?.attributes || {})
      },
      resource: {
        type: resource,
        tenantId,
        ...resourceAttributes
      },
      request: {
        applicationId,
        action,
        field,
        ip: request.ip,
        method: request.method,
        path: request.path
      }
    };

    const explanation = explainPolicies({
      rolePermissions,
      directGrants,
      policies,
      context,
      query: {
        applicationId,
        tenantId,
        principalId,
        roleIds,
        resource,
        action,
        field
      },
      hardDenyReasons
    });

    return {
      ...explanation.decision,
      principal,
      application,
      roleIds,
      ...(includeTrace
        ? {
            trace: {
              steps: explanation.steps,
              decidingRuleId: explanation.decidingRuleId,
              defaultDeny: explanation.defaultDeny,
              hardDenyReason: explanation.hardDenyReason,
              context
            }
          }
        : {})
    };
  }

  async function exportSnapshot() {
    const snapshot: Record<string, any> = {};
    for (const table of TABLES) {
      snapshot[table] = await storage.list(table);
    }

    return snapshot;
  }

  async function debugDecision(input: any) {
    // The Studio debugger always wants the full story: decision + trace.
    return evaluateAuthorization({ ...input, includeTrace: true });
  }

  const admin = {
    async bootstrapWorkspace({ name = "Blindfold Workspace", defaults = {}, actorId = "system" }: { name?: any; defaults?: any; actorId?: any } = {}) {
      const workspace = await upsertWorkspaceConfig({ name, defaults });
      await writeAuditEvent({
        type: "workspace.bootstrapped",
        actorId,
        data: { workspaceId, name }
      });
      return workspace;
    },
    async getWorkspace() {
      return getWorkspaceConfig();
    },
    applications: {
      async list() {
        return storage.list("applications");
      },
      async create({ slug, name, description = "", directoryMode = "shared", ssoMode = "platform_sso", actorId = "system", config = {} }: { slug: any; name: any; description?: any; directoryMode?: any; ssoMode?: any; actorId?: any; config?: any }) {
        const existingApplications = await storage.list("applications");
        if (existingApplications.some((application: any) => application.slug === slug)) {
          throw new Error("Application slug already exists");
        }

        const application = withTimestamps(
          {
            id: randomId("app"),
            workspaceId,
            slug,
            name,
            description,
            directoryMode,
            ssoMode,
            status: "active"
          },
          null
        );

        const configuration = withTimestamps(
          {
            id: randomId("appcfg"),
            workspaceId,
            applicationId: application.id,
            version: 1,
            config
          },
          null
        );

        await storage.put("applications", application);
        await storage.put("application_auth_config", configuration);
        await storage.put(
          "policy_versions",
          withTimestamps(
            {
              id: randomId("policyver"),
              workspaceId,
              applicationId: application.id,
              version: 1,
              reason: "initial bootstrap"
            },
            null
          )
        );

        await writeAuditEvent({
          type: "application.created",
          actorId,
          applicationId: application.id,
          data: { slug, name }
        });
        return application;
      },
      async configure({ applicationId, config, actorId = "system" }: { applicationId: any; config: any; actorId?: any }) {
        const current = await getApplicationConfig(applicationId);
        const nextVersion = (current?.version || 0) + 1;
        const record = withTimestamps(
          {
            id: current?.id || randomId("appcfg"),
            workspaceId,
            applicationId,
            version: nextVersion,
            config: mergeObjects(current?.config || {}, config || {})
          },
          current
        );

        await storage.put("application_auth_config", record);
        await storage.put(
          "policy_versions",
          withTimestamps(
            {
              id: randomId("policyver"),
              workspaceId,
              applicationId,
              version: nextVersion,
              reason: "application config updated"
            },
            null
          )
        );
        await writeAuditEvent({
          type: "application.configured",
          actorId,
          applicationId,
          data: { version: nextVersion }
        });
        return record;
      }
    },
    identityProviders: {
      async list() {
        return storage.list("identity_providers");
      },
      async create({
        key,
        name,
        type,
        mode = "live",
        issuer = null,
        discoveryUrl = null,
        status = "active",
        authorizationUrl = null,
        ssoUrl = null,
        clientId = null,
        clientSecret = null,
        allowInsecureDiscovery = false,
        claimMappings = {},
        x509Certificate = null,
        actorId = "system"
      }: { key: any; name: any; type: any; mode?: any; issuer?: any; discoveryUrl?: any; status?: any; authorizationUrl?: any; ssoUrl?: any; clientId?: any; clientSecret?: any; allowInsecureDiscovery?: any; claimMappings?: any; x509Certificate?: any; actorId?: any }) {
        if (!["oidc", "saml"].includes(type)) {
          throw new Error("Identity provider type must be oidc or saml");
        }

        if (!["live", "demo"].includes(mode)) {
          throw new Error("Identity provider mode must be live or demo");
        }

        const existing = await storage.list("identity_providers", { key });
        if (existing.length > 0) {
          throw new Error("Identity provider key already exists");
        }

        if (mode === "live" && type === "oidc" && !issuer && !discoveryUrl) {
          throw new Error("Live OIDC providers require issuer or discoveryUrl");
        }

        if (mode === "live" && type === "oidc" && !clientId) {
          throw new Error("Live OIDC providers require clientId");
        }

        if (mode === "live" && type === "saml" && !ssoUrl) {
          throw new Error("Live SAML providers require ssoUrl");
        }

        if (mode === "live" && type === "saml" && !x509Certificate) {
          throw new Error("Live SAML providers require x509Certificate");
        }

        const provider = withTimestamps(
          {
            id: randomId("idp"),
            workspaceId,
            key,
            name,
            type,
            mode,
            issuer,
            discoveryUrl,
            status,
            authorizationUrl,
            ssoUrl,
            clientId,
            clientSecret,
            allowInsecureDiscovery,
            claimMappings,
            x509Certificate
          },
          null
        );

        await storage.put("identity_providers", provider);
        await writeAuditEvent({
          type: "identity_provider.created",
          actorId,
          data: { providerId: provider.id, key, type, mode }
        });
        return provider;
      }
    },
    applicationProviders: {
      async list({ applicationId }: { applicationId?: any } = {}) {
        return applicationId ? storage.list("application_identity_providers", { applicationId }) : storage.list("application_identity_providers");
      },
      async bind({
        applicationId,
        providerId,
        domains = [],
        defaultRoleIds = [],
        claimMappings = {},
        enabled = true,
        allowIdpInitiated = false,
        authorizationUrl = null,
        ssoUrl = null,
        clientId = null,
        audience = null,
        authnRequestBinding = null,
        entityId = null,
        actorId = "system"
      }: { applicationId: any; providerId: any; domains?: any; defaultRoleIds?: any; claimMappings?: any; enabled?: any; allowIdpInitiated?: any; authorizationUrl?: any; ssoUrl?: any; clientId?: any; audience?: any; authnRequestBinding?: any; entityId?: any; actorId?: any }) {
        const application = await getApplication(applicationId);
        if (!application) {
          throw new Error("Application not found");
        }

        const provider = await getIdentityProvider(providerId);
        if (!provider) {
          throw new Error("Identity provider not found");
        }

        const binding = withTimestamps(
          {
            id: randomId("appidp"),
            workspaceId,
            applicationId,
            providerId,
            domains,
            defaultRoleIds,
            claimMappings,
            enabled,
            allowIdpInitiated,
            authorizationUrl,
            ssoUrl,
            clientId,
            audience,
            authnRequestBinding,
            entityId
          },
          null
        );

        await storage.put("application_identity_providers", binding);
        await writeAuditEvent({
          type: "application_provider.bound",
          actorId,
          applicationId,
          data: { bindingId: binding.id, providerId, domains }
        });
        return binding;
      }
    },
    principals: {
      async list() {
        return storage.list("principals");
      },
      async create({ email, password, displayName, attributes = {}, actorId = "system" }: { email: any; password: any; displayName: any; attributes?: any; actorId?: any }) {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail) {
          throw new Error("Principal email is required");
        }

        const existingPrincipal = await getPrincipalByEmail(normalizedEmail);
        if (existingPrincipal) {
          throw new Error("Principal email already exists");
        }

        const principal = withTimestamps(
          {
            id: randomId("principal"),
            workspaceId,
            email: normalizedEmail,
            displayName,
            attributes,
            status: "active",
            passwordHash: password ? hashPassword(password) : null,
            mfa: {
              totp: { enabled: false, secret: null },
              recoveryCodes: []
            }
          },
          null
        );

        await storage.put("principals", principal);
        await writeAuditEvent({
          type: "principal.created",
          actorId,
          principalId: principal.id,
          data: { email }
        });
        return principal;
      },
      async enableTotp({ principalId, actorId = "system" }: { principalId: any; actorId?: any }) {
        const principal = await storage.get("principals", principalId);
        if (!principal) {
          throw new Error("Principal not found");
        }

        const secretValue = generateTotpSecret();
        const recoveryCodes = generateRecoveryCodes();
        principal.mfa ||= {};
        principal.mfa.totp = { enabled: false, secret: secretValue };
        principal.mfa.recoveryCodes = recoveryCodes.map((code) => sha256(code));
        await storage.put("principals", withTimestamps(principal, principal));
        await writeAuditEvent({
          type: "principal.mfa_totp_prepared",
          actorId,
          principalId,
          data: {}
        });
        return {
          secret: secretValue,
          recoveryCodes,
          currentCode: getTotpCode(secretValue)
        };
      },
      async confirmTotp({ principalId, code, actorId = "system" }: { principalId: any; code: any; actorId?: any }) {
        const principal = await storage.get("principals", principalId);
        if (!principal?.mfa?.totp?.secret) {
          throw new Error("TOTP not prepared");
        }

        if (!verifyTotpCode(principal.mfa.totp.secret, code)) {
          throw new Error("Invalid TOTP code");
        }

        principal.mfa.totp.enabled = true;
        await storage.put("principals", withTimestamps(principal, principal));
        await writeAuditEvent({
          type: "principal.mfa_totp_enabled",
          actorId,
          principalId,
          data: {}
        });
        return principal;
      },
      /** Set a principal's status (`active` | `disabled`). */
      async setStatus({ principalId, status, actorId = "system" }: { principalId: any; status: "active" | "disabled"; actorId?: any }) {
        if (status !== "active" && status !== "disabled") {
          throw new Error('Principal status must be "active" or "disabled"');
        }
        const principal = await storage.get("principals", principalId);
        if (!principal) {
          throw new Error("Principal not found");
        }
        const next = withTimestamps({ ...principal, status }, principal);
        await storage.put("principals", next);
        await writeAuditEvent({
          type: "principal.status_changed",
          actorId,
          principalId,
          data: { status }
        });
        return next;
      },
      /**
       * Emergency disable: mark the principal disabled AND revoke all active
       * sessions immediately. Disabled principals can no longer authenticate or
       * verify existing sessions (the runtime rejects non-active principals).
       */
      async disable({ principalId, reason = "emergency disable", actorId = "system" }: { principalId: any; reason?: any; actorId?: any }) {
        const principal = await admin.principals.setStatus({ principalId, status: "disabled", actorId });
        const { revoked } = await admin.sessions.revokeAll({ principalId, reason });
        await writeAuditEvent({
          type: "principal.disabled",
          actorId,
          principalId,
          data: { reason, sessionsRevoked: revoked }
        });
        return { principal, sessionsRevoked: revoked };
      },
      /** Re-enable a previously disabled principal (does not restore old sessions). */
      async enable({ principalId, actorId = "system" }: { principalId: any; actorId?: any }) {
        return admin.principals.setStatus({ principalId, status: "active", actorId });
      }
    },
    passkeys: {
      async list({ principalId = null, applicationId = null }: { principalId?: any; applicationId?: any } = {}) {
        return listPasskeys({ principalId, applicationId });
      },
      async revoke({ credentialId, actorId = "system" }: { credentialId: any; actorId?: any }) {
        const credential =
          (await storage.list("webauthn_credentials", { credentialId }))[0] ||
          (await storage.get("webauthn_credentials", credentialId));
        if (!credential) {
          throw new Error("Passkey credential not found");
        }

        const nextCredential = withTimestamps(
          {
            ...credential,
            status: "revoked"
          },
          credential
        );
        await storage.put("webauthn_credentials", nextCredential);
        await writeAuditEvent({
          type: "passkey.revoked",
          actorId,
          principalId: credential.principalId,
          applicationId: credential.applicationId,
          data: { credentialId: credential.credentialId }
        });
        return nextCredential;
      }
    },
    roles: {
      async list({ applicationId }: { applicationId: any }) {
        return storage.list("roles", { applicationId });
      },
      async create({ applicationId, name, description = "", actorId = "system" }: { applicationId: any; name: any; description?: any; actorId?: any }) {
        const role = withTimestamps(
          {
            id: randomId("role"),
            workspaceId,
            applicationId,
            name,
            description
          },
          null
        );
        await storage.put("roles", role);
        await writeAuditEvent({
          type: "role.created",
          actorId,
          applicationId,
          data: { roleId: role.id, name }
        });
        return role;
      },
      async grantPermission({ roleId, applicationId, resource, action, field = "*", effect = "allow", priority = 10, actorId = "system" }: { roleId: any; applicationId: any; resource: any; action: any; field?: any; effect?: any; priority?: any; actorId?: any }) {
        const permission = withTimestamps(
          {
            id: randomId("perm"),
            workspaceId,
            roleId,
            applicationId,
            resource,
            action,
            field,
            effect,
            priority
          },
          null
        );
        await storage.put("role_permissions", permission);
        await writeAuditEvent({
          type: "role.permission_granted",
          actorId,
          applicationId,
          data: { roleId, permissionId: permission.id, resource, action, field }
        });
        return permission;
      }
    },
    memberships: {
      async assignRole({ principalId, applicationId, tenantId = null, roleId, attributes = {}, actorId = "system" }: { principalId: any; applicationId: any; tenantId?: any; roleId: any; attributes?: any; actorId?: any }) {
        const membership = withTimestamps(
          {
            id: randomId("membership"),
            workspaceId,
            principalId,
            applicationId,
            tenantId,
            roleId,
            attributes
          },
          null
        );
        await storage.put("memberships", membership);
        await writeAuditEvent({
          type: "membership.assigned",
          actorId,
          principalId,
          applicationId,
          data: { membershipId: membership.id, roleId }
        });
        return membership;
      }
    },
    policies: {
      async list({ applicationId }: { applicationId: any }) {
        return storage.list("policy_rules", { applicationId });
      },
      async add({
        applicationId,
        tenantId = null,
        principalId = null,
        roleId = null,
        resource,
        action,
        field = null,
        effect = "allow",
        conditionJson = null,
        priority = 100,
        actorId = "system"
      }: { applicationId: any; tenantId?: any; principalId?: any; roleId?: any; resource: any; action: any; field?: any; effect?: any; conditionJson?: any; priority?: any; actorId?: any }) {
        const rule = withTimestamps(
          {
            id: randomId("policy"),
            workspaceId,
            applicationId,
            tenantId,
            principalId,
            roleId,
            resource,
            action,
            field,
            effect,
            conditionJson,
            priority
          },
          null
        );

        await storage.put("policy_rules", rule);
        await writeAuditEvent({
          type: "policy.created",
          actorId,
          applicationId,
          data: { policyId: rule.id, resource, action, effect }
        });
        return rule;
      }
    },
    directGrants: {
      async add({
        principalId,
        applicationId,
        resource,
        action,
        field = null,
        effect = "allow",
        conditionJson = null,
        priority = 150,
        actorId = "system"
      }: { principalId: any; applicationId: any; resource: any; action: any; field?: any; effect?: any; conditionJson?: any; priority?: any; actorId?: any }) {
        const grant = withTimestamps(
          {
            id: randomId("grant"),
            workspaceId,
            principalId,
            applicationId,
            resource,
            action,
            field,
            effect,
            conditionJson,
            priority
          },
          null
        );

        await storage.put("direct_grants", grant);
        await writeAuditEvent({
          type: "grant.created",
          actorId,
          principalId,
          applicationId,
          data: { grantId: grant.id, resource, action, effect }
        });
        return grant;
      }
    },
    /**
     * Delegated application administration. Grants a principal full admin
     * authority over ONE application (a `*`/`*` allow direct-grant scoped to
     * that applicationId, tagged `delegatedAdmin`). This lets a workspace owner
     * hand operational control of an app to a team lead without making them a
     * workspace-wide admin. Authority is enforced through the normal `can()`
     * path, so delegated admins pass authorization checks for their app only.
     */
    delegation: {
      async grant({ principalId, applicationId, actorId = "system" }: { principalId: any; applicationId: any; actorId?: any }) {
        if (!principalId || !applicationId) {
          throw new Error("delegation.grant requires principalId and applicationId");
        }
        const application = await getApplication(applicationId);
        if (!application) {
          throw new Error("Application not found");
        }
        const existing = (await storage.list("direct_grants", { principalId, applicationId })).find(
          (entry: any) => entry.delegatedAdmin === true
        );
        if (existing) {
          return existing;
        }
        const grant = withTimestamps(
          {
            id: randomId("grant"),
            workspaceId,
            principalId,
            applicationId,
            resource: "*",
            action: "*",
            field: "*",
            effect: "allow",
            conditionJson: null,
            priority: 200,
            delegatedAdmin: true
          },
          null
        );
        await storage.put("direct_grants", grant);
        await writeAuditEvent({
          type: "delegated_admin.granted",
          actorId,
          principalId,
          applicationId,
          data: { grantId: grant.id }
        });
        return grant;
      },
      async list({ applicationId = null }: { applicationId?: any } = {}) {
        const grants = await storage.list("direct_grants", applicationId ? { applicationId } : {});
        return grants.filter((entry: any) => entry.delegatedAdmin === true);
      },
      async revoke({ principalId, applicationId, actorId = "system" }: { principalId: any; applicationId: any; actorId?: any }) {
        if (!principalId || !applicationId) {
          throw new Error("delegation.revoke requires principalId and applicationId");
        }
        const grants = (await storage.list("direct_grants", { principalId, applicationId })).filter(
          (entry: any) => entry.delegatedAdmin === true
        );
        for (const grant of grants) {
          await storage.delete("direct_grants", grant.id);
        }
        if (grants.length > 0) {
          await writeAuditEvent({
            type: "delegated_admin.revoked",
            actorId,
            principalId,
            applicationId,
            data: { revoked: grants.length }
          });
        }
        return { revoked: grants.length };
      },
      /** Authoritative check: is this principal a delegated admin of the app? */
      async isAdmin({ principalId, applicationId }: { principalId: any; applicationId: any }) {
        const decision = await evaluateAuthorization({
          principalId,
          applicationId,
          action: "*",
          resource: "*",
          field: "*",
          resourceAttributes: {}
        });
        return Boolean(decision.allowed);
      }
    },
    sessions: {
      async list({ applicationId }: { applicationId?: any } = {}) {
        const sessions = await storage.list("sessions");
        return applicationId ? sessions.filter((sessionRow: any) => sessionRow.applicationId === applicationId) : sessions;
      },
      /**
       * Session + device inventory for one principal. Returns each session with
       * its device fingerprint, auth strength, status, and timestamps — newest
       * first. Pass `includeRevoked: true` to include already-revoked sessions.
       */
      async listForPrincipal({ principalId, applicationId = null, includeRevoked = false }: { principalId: any; applicationId?: any; includeRevoked?: boolean }) {
        if (!principalId) {
          throw new Error("listForPrincipal requires principalId");
        }
        const filter: Record<string, any> = { principalId };
        if (applicationId) {
          filter.applicationId = applicationId;
        }
        const sessions = await storage.list("sessions", filter);
        return sessions
          .filter((sessionRow: any) => includeRevoked || sessionRow.status === "active")
          .map((sessionRow: any) => ({
            id: sessionRow.id,
            applicationId: sessionRow.applicationId,
            tenantId: sessionRow.tenantId,
            device: sessionRow.device || null,
            authStrength: sessionRow.authStrength,
            status: sessionRow.status,
            createdAt: sessionRow.createdAt,
            updatedAt: sessionRow.updatedAt,
            accessExpiresAt: sessionRow.accessExpiresAt,
            refreshExpiresAt: sessionRow.refreshExpiresAt
          }))
          .sort((left: any, right: any) => String(right.createdAt).localeCompare(String(left.createdAt)));
      },
      /**
       * Revoke every active session for a principal ("sign out everywhere").
       * Optionally scope to one application, or exclude one session (e.g. the
       * current one). Returns the number of sessions revoked.
       */
      async revokeAll({ principalId, applicationId = null, exceptSessionId = null, reason = "revoke all sessions" }: { principalId: any; applicationId?: any; exceptSessionId?: any; reason?: any }) {
        if (!principalId) {
          throw new Error("revokeAll requires principalId");
        }
        const filter: Record<string, any> = { principalId };
        if (applicationId) {
          filter.applicationId = applicationId;
        }
        const sessions = await storage.list("sessions", filter);
        let revoked = 0;
        for (const sessionRow of sessions) {
          if (sessionRow.status !== "active" || sessionRow.id === exceptSessionId) {
            continue;
          }
          if (await revokeSession({ sessionId: sessionRow.id, reason })) {
            revoked += 1;
          }
        }
        return { revoked };
      }
    },
    audit: {
      async list({ limit = 100 }: { limit?: any } = {}) {
        const events = await storage.list("audit_events");
        return events.sort((left: any, right: any) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit);
      }
    },
    exportSnapshot,
    debugDecision
  };

  const api = {
    workspaceId,
    storage,
    admin,
    authMethods: enabledAuthMethods,
    async can(inputOrPrincipalId: any, action?: any, resource?: any, context: any = {}) {
      const args =
        typeof inputOrPrincipalId === "object"
          ? inputOrPrincipalId
          : {
              principalId: inputOrPrincipalId,
              action,
              resource,
              ...context
            };

      return evaluateAuthorization({
        principalId: args.principalId,
        applicationId: args.applicationId,
        action: args.action,
        resource: args.resource,
        field: args.field,
        tenantId: args.tenantId,
        resourceAttributes: args.resourceAttributes || {},
        request: args.request || {}
      });
    },
    /**
     * Like can(), but also returns a `trace`: every rule's outcome
     * (applied / shadowed / skipped-scope with the failing components /
     * skipped-condition), the deciding rule id, default-deny flag, and the
     * evaluation context. Powers the Studio policy debugger.
     */
    async explain(inputOrPrincipalId: any, action?: any, resource?: any, context: any = {}) {
      const args =
        typeof inputOrPrincipalId === "object"
          ? inputOrPrincipalId
          : {
              principalId: inputOrPrincipalId,
              action,
              resource,
              ...context
            };

      return evaluateAuthorization({
        principalId: args.principalId,
        applicationId: args.applicationId,
        action: args.action,
        resource: args.resource,
        field: args.field,
        tenantId: args.tenantId,
        resourceAttributes: args.resourceAttributes || {},
        request: args.request || {},
        includeTrace: true
      });
    },
    protect(optionsOrHandler: any, maybeHandler?: any) {
      const options: any = typeof optionsOrHandler === "function" ? {} : optionsOrHandler || {};
      const handler = typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler;
      if (typeof handler !== "function") {
        throw new Error("auth.protect requires a handler");
      }

      return async function protectedHandler(request: any = {}) {
        const accessToken = options.accessToken || readBearerToken(request.headers || {});
        if (!accessToken) {
          return toResponse(401, { error: "missing bearer token" });
        }

        const verified = await verifySession({ accessToken });
        if (!verified.ok) {
          return toResponse(401, { error: verified.reason });
        }

        if (options.applicationId && options.applicationId !== verified.session.applicationId) {
          return toResponse(403, { error: "session application mismatch" });
        }

        let decision = null;
        if (options.resource && options.action) {
          decision = await evaluateAuthorization({
            principalId: verified.principal.id,
            applicationId: options.applicationId || verified.session.applicationId,
            action: options.action,
            resource: options.resource,
            field: options.field || null,
            tenantId: options.tenantId || verified.session.tenantId,
            resourceAttributes: options.resourceAttributes || request.resourceAttributes || {},
            request: {
              ip: request.ip,
              method: request.method,
              path: request.path,
              authStrength: verified.session.authStrength
            },
            principal: verified.principal,
            application: verified.application
          });

          if (!decision.allowed) {
            return toResponse(403, { error: decision.reason, matchedRuleIds: decision.matchedRuleIds });
          }
        }

        return handler(
          {
            auth: api,
            application: verified.application,
            session: verified.session,
            subject: verified.principal,
            decision
          },
          request
        );
      };
    },
    session: {
      create: issueSession,
      verify: verifySession,
      refresh: refreshSession,
      revoke: revokeSession
    },
    handlers: {
      login() {
        return async (request: any = {}) => {
          try {
            const result = await authenticatePassword({
              applicationId: request.body?.applicationId,
              email: request.body?.email,
              password: request.body?.password,
              mfaCode: request.body?.mfaCode,
              recoveryCode: request.body?.recoveryCode
            });
            return toResponse(200, result);
          } catch (error) {
            return toResponse(401, { error: (error as Error).message });
          }
        };
      },
      refresh() {
        return async (request: any = {}) => {
          try {
            const result = await refreshSession({ refreshToken: request.body?.refreshToken });
            return toResponse(200, result);
          } catch (error) {
            return toResponse(401, { error: (error as Error).message });
          }
        };
      },
      logout() {
        return async (request: any = {}) => {
          await revokeSession({ refreshToken: request.body?.refreshToken, reason: "logout" });
          return toResponse(200, { ok: true });
        };
      },
      requestMagicLink() {
        return async (request: any = {}) => {
          try {
            const result = await createMagicLink({
              applicationId: request.body?.applicationId,
              email: request.body?.email,
              redirectTo: request.body?.redirectTo || "/"
            });
            const appConfig = await getEffectiveAppConfig(request.body?.applicationId);
            if (appConfig.security?.magicLinks?.returnTokenInResponse) {
              return toResponse(200, {
                ok: true,
                token: result.token,
                url: result.url
              });
            }

            return toResponse(200, { ok: true });
          } catch (error) {
            if ((error as Error).message === "Unknown principal" || (error as Error).message === "Principal has no access to this application") {
              return toResponse(200, { ok: true });
            }

            return toResponse(400, { error: (error as Error).message });
          }
        };
      },
      consumeMagicLink() {
        return async (request: any = {}) => {
          try {
            const result = await consumeMagicLink({
              applicationId: request.body?.applicationId,
              token: request.body?.token
            });
            return toResponse(200, result);
          } catch (error) {
            return toResponse(401, { error: (error as Error).message });
          }
        };
      },
      passkeys: {
        beginRegistration() {
          return async (request: any = {}) => {
            try {
              const result = await beginPasskeyRegistration(
                {
                  applicationId: request.body?.applicationId,
                  nickname: request.body?.nickname || null
                },
                request
              );
              return toResponse(200, result);
            } catch (error) {
              return toResponse(401, { error: (error as Error).message });
            }
          };
        },
        finishRegistration() {
          return async (request: any = {}) => {
            try {
              const result = await finishPasskeyRegistration(
                {
                  applicationId: request.body?.applicationId,
                  challengeId: request.body?.challengeId,
                  response: request.body?.response,
                  nickname: request.body?.nickname || null
                },
                request
              );
              return toResponse(200, result);
            } catch (error) {
              return toResponse(400, { error: (error as Error).message });
            }
          };
        },
        beginAuthentication() {
          return async (request: any = {}) => {
            try {
              const result = await beginPasskeyAuthentication(
                {
                  applicationId: request.body?.applicationId,
                  email: request.body?.email || null
                },
                request
              );
              return toResponse(200, result);
            } catch (error) {
              return toResponse(400, { error: (error as Error).message });
            }
          };
        },
        finishAuthentication() {
          return async (request: any = {}) => {
            try {
              const result = await finishPasskeyAuthentication(
                {
                  applicationId: request.body?.applicationId,
                  challengeId: request.body?.challengeId,
                  response: request.body?.response
                },
                request
              );
              return toResponse(200, result);
            } catch (error) {
              return toResponse(401, { error: (error as Error).message });
            }
          };
        }
      },
      oidc: {
        start() {
          return async (request: any = {}) => {
            try {
              const result = await startFederation(
                "oidc",
                {
                  applicationId: request.body?.applicationId || request.query?.applicationId,
                  providerId: request.body?.providerId || request.query?.providerId || null,
                  email: request.body?.email || request.query?.email || null
                },
                request
              );
              return toResponse(result.multipleProviders ? 409 : 200, result);
            } catch (error) {
              return toResponse(400, { error: (error as Error).message });
            }
          };
        },
        callback() {
          return async (request: any = {}) => {
            try {
              const result = await finishFederation(
                "oidc",
                {
                  applicationId: request.body?.applicationId || request.query?.applicationId,
                  providerId: request.body?.providerId || request.query?.providerId,
                  state: request.body?.state || request.query?.state,
                  code: request.body?.code || request.query?.code,
                  iss: request.body?.iss || request.query?.iss,
                  error: request.body?.error || request.query?.error,
                  error_description: request.body?.error_description || request.query?.error_description,
                  error_uri: request.body?.error_uri || request.query?.error_uri,
                  claims: request.body?.claims || request.query?.claims || {
                    sub: request.body?.sub || request.query?.sub,
                    email: request.body?.email || request.query?.email,
                    name: request.body?.name || request.query?.name
                  }
                },
                request
              );
              return toResponse(200, result);
            } catch (error) {
              return toResponse(401, { error: (error as Error).message });
            }
          };
        }
      },
      saml: {
        start() {
          return async (request: any = {}) => {
            try {
              const result = await startFederation(
                "saml",
                {
                  applicationId: request.body?.applicationId || request.query?.applicationId,
                  providerId: request.body?.providerId || request.query?.providerId || null,
                  email: request.body?.email || request.query?.email || null
                },
                request
              );
              return toResponse(result.multipleProviders ? 409 : 200, result);
            } catch (error) {
              return toResponse(400, { error: (error as Error).message });
            }
          };
        },
        callback() {
          return async (request: any = {}) => {
            try {
              const result = await finishFederation(
                "saml",
                {
                  applicationId: request.body?.applicationId || request.query?.applicationId,
                  providerId: request.body?.providerId || request.query?.providerId,
                  relayState: request.body?.relayState || request.body?.RelayState || request.query?.relayState || request.query?.RelayState,
                  SAMLResponse: request.body?.SAMLResponse || request.query?.SAMLResponse,
                  claims: request.body?.claims || request.query?.claims || {
                    sub: request.body?.sub || request.query?.sub || request.body?.subject || request.query?.subject,
                    email: request.body?.email || request.query?.email,
                    name: request.body?.name || request.query?.name
                  }
                },
                request
              );
              return toResponse(200, result);
            } catch (error) {
              return toResponse(401, { error: (error as Error).message });
            }
          };
        },
        metadata() {
          return async (request: any = {}) => {
            try {
              const applicationId = request.body?.applicationId || request.query?.applicationId;
              const providerId = request.body?.providerId || request.query?.providerId;
              const application = await getApplication(applicationId);
              const bindings = await listApplicationProviders(applicationId);
              const binding = bindings.find((entry: any) => entry.providerId === providerId);
              const provider = await getIdentityProvider(providerId);
              if (!application || !binding || !provider) {
                return toResponse(404, { error: "SAML binding not found" });
              }

              let xml;
              try {
                const samlClient = createSamlClient({
                  application,
                  provider,
                  binding,
                  callbackUrl: buildProtocolRedirectUri(request, "saml"),
                  cacheProvider: createSamlCacheProvider({
                    applicationId,
                    providerId,
                    bindingId: binding.id
                  }),
                  validateInResponseTo: binding.allowIdpInitiated ? "ifPresent" : "always"
                });
                xml = samlClient.generateServiceProviderMetadata(null, provider.publicCert || binding.publicCert || null);
              } catch {
                xml = buildSamlMetadata({
                  application,
                  provider,
                  binding,
                  callbackUrl: buildProtocolRedirectUri(request, "saml")
                });
              }
              return {
                statusCode: 200,
                headers: { "content-type": "application/xml; charset=utf-8" },
                body: xml
              };
            } catch (error) {
              return toResponse(400, { error: (error as Error).message });
            }
          };
        }
      }
    }
  };

  return api;
}

export { createMemoryStorage, createFileStorage, maskValue };
