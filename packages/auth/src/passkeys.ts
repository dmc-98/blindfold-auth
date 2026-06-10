import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from "@simplewebauthn/server";
import { base64UrlToBuffer, bufferToBase64Url, ensureArray } from "./utils.js";
import type { AuthRequest } from "./types.js";

function resolveHost(value: unknown): string {
  return String(value || "localhost").split(":")[0]!;
}

export interface PasskeyConfig {
  rpID: string;
  rpName: string;
  origins: string[];
}

export interface ResolvePasskeyConfigInput {
  application?: any;
  appConfig: any;
  request?: AuthRequest;
}

export function resolvePasskeyConfig({ application, appConfig, request = {} }: ResolvePasskeyConfigInput): PasskeyConfig {
  const headers = (request.headers || {}) as Record<string, any>;
  const host = headers.host || headers.Host || request.host || "localhost";
  const inferredOrigin = request.origin || headers.origin || headers.Origin || `http://${host}`;
  const rpID = appConfig.passkeys?.rpId || resolveHost(host);
  const origins = [...new Set<string>([inferredOrigin, ...ensureArray(appConfig.passkeys?.origins || [])].filter(Boolean) as string[])];

  return {
    rpID,
    rpName: appConfig.passkeys?.rpName || application?.name || "Blindfold Auth",
    origins
  };
}

export interface CreatePasskeyRegistrationInput {
  application?: any;
  appConfig: any;
  request?: AuthRequest;
  principal: any;
  existingCredentials?: any[];
}

export async function createPasskeyRegistrationOptions({
  application,
  appConfig,
  request,
  principal,
  existingCredentials = []
}: CreatePasskeyRegistrationInput): Promise<{ options: any; passkeyConfig: PasskeyConfig }> {
  const passkeyConfig = resolvePasskeyConfig({ application, appConfig, request });
  const options = await generateRegistrationOptions({
    rpID: passkeyConfig.rpID,
    rpName: passkeyConfig.rpName,
    userID: Buffer.from(principal.id, "utf8"),
    userName: principal.email,
    userDisplayName: principal.displayName || principal.email,
    attestationType: "none",
    residentKey: "required",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred"
    },
    supportedAlgorithmIDs: [-7, -257],
    excludeCredentials: existingCredentials
      .filter((credential) => credential.status !== "revoked")
      .map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports || []
      }))
  } as any);

  return {
    options,
    passkeyConfig
  };
}

export interface FinishPasskeyRegistrationInput {
  response: any;
  challenge: string;
  expectedOrigins: string[];
  rpID: string;
}

export async function finishPasskeyRegistration({ response, challenge, expectedOrigins, rpID }: FinishPasskeyRegistrationInput): Promise<any> {
  return verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: expectedOrigins,
    expectedRPID: rpID,
    requireUserVerification: false
  });
}

export interface CreatePasskeyAuthInput {
  application?: any;
  appConfig: any;
  request?: AuthRequest;
  credentials?: any[];
}

export async function createPasskeyAuthenticationOptions({
  application,
  appConfig,
  request,
  credentials = []
}: CreatePasskeyAuthInput): Promise<{ options: any; passkeyConfig: PasskeyConfig }> {
  const passkeyConfig = resolvePasskeyConfig({ application, appConfig, request });
  const options = await generateAuthenticationOptions({
    rpID: passkeyConfig.rpID,
    userVerification: "preferred",
    allowCredentials:
      credentials.length > 0
        ? credentials
            .filter((credential) => credential.status !== "revoked")
            .map((credential) => ({
              id: credential.credentialId,
              transports: credential.transports || []
            }))
        : undefined
  });

  return {
    options,
    passkeyConfig
  };
}

export interface FinishPasskeyAuthInput {
  response: any;
  challenge: string;
  expectedOrigins: string[];
  rpID: string;
  credential: any;
}

export async function finishPasskeyAuthentication({ response, challenge, expectedOrigins, rpID, credential }: FinishPasskeyAuthInput): Promise<any> {
  return verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: expectedOrigins,
    expectedRPID: rpID,
    credential: {
      id: credential.credentialId,
      publicKey: base64UrlToBuffer(credential.publicKey) as any,
      counter: credential.counter,
      transports: credential.transports || []
    },
    requireUserVerification: false
  });
}

export interface RegistrationInfoToRecordInput {
  registrationInfo: any;
  principalId: string;
  applicationId: string;
  rpID: string;
  nickname?: string | null;
}

export function registrationInfoToCredentialRecord({
  registrationInfo,
  principalId,
  applicationId,
  rpID,
  nickname = null
}: RegistrationInfoToRecordInput): Record<string, any> {
  return {
    credentialId: registrationInfo.credential.id,
    publicKey: bufferToBase64Url(registrationInfo.credential.publicKey),
    counter: registrationInfo.credential.counter,
    transports: registrationInfo.credential.transports || [],
    deviceType: registrationInfo.credentialDeviceType,
    backedUp: registrationInfo.credentialBackedUp,
    aaguid: registrationInfo.aaguid,
    principalId,
    applicationId,
    rpID,
    nickname
  };
}
