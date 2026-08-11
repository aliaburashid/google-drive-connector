import { ConnectorError, assertCredentialsPresent } from "../errors/normalize.js";
import type { OAuthCredentials } from "../types.js";
import { DRIVE_SCOPE } from "../types.js";

const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface AccessTokenResult {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
  scope?: string;
  obtainedAt: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/**
 * Exchange a refresh token for a short-lived access token.
 * Does not persist tokens — callers keep secrets outside the repo.
 */
export async function refreshAccessToken(
  credentials: OAuthCredentials,
  options?: { tokenUrl?: string; fetchImpl?: typeof fetch },
): Promise<AccessTokenResult> {
  assertCredentialsPresent(credentials);

  const tokenUrl = options?.tokenUrl ?? process.env.GOOGLE_TOKEN_URL ?? DEFAULT_TOKEN_URL;
  const fetchImpl = options?.fetchImpl ?? fetch;

  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: "refresh_token",
  });

  let response: Response;
  try {
    response = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
  } catch (err) {
    throw new ConnectorError({
      code: "token_network_error",
      message: err instanceof Error ? err.message : "Failed to reach token endpoint",
      retryClass: "retryable",
    });
  }

  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("x-guploader-uploadid") ??
    undefined;

  let payload: TokenResponse;
  try {
    payload = (await response.json()) as TokenResponse;
  } catch {
    throw new ConnectorError({
      code: "token_invalid_response",
      message: `Token endpoint returned non-JSON (HTTP ${response.status})`,
      retryClass: "retryable",
      httpStatus: response.status,
      ...(requestId !== undefined ? { requestId } : {}),
    });
  }

  if (!response.ok || !payload.access_token) {
    throw new ConnectorError({
      code: payload.error ?? "token_refresh_failed",
      message:
        payload.error_description ??
        payload.error ??
        `Token refresh failed with HTTP ${response.status}`,
      retryClass: response.status === 401 || response.status === 400 ? "auth" : "retryable",
      httpStatus: response.status,
      ...(requestId !== undefined ? { requestId } : {}),
      provider: {
        ...(payload.error !== undefined ? { reason: payload.error } : {}),
        details: payload,
      },
    });
  }

  return {
    accessToken: payload.access_token,
    expiresIn: payload.expires_in ?? 3600,
    tokenType: payload.token_type ?? "Bearer",
    ...(payload.scope !== undefined ? { scope: payload.scope } : {}),
    obtainedAt: new Date().toISOString(),
  };
}

/**
 * Resolve a usable access token: reuse credentials.accessToken when provided,
 * otherwise refresh from the refresh token.
 */
export async function getAccessToken(
  credentials: OAuthCredentials,
  options?: { tokenUrl?: string; fetchImpl?: typeof fetch; forceRefresh?: boolean },
): Promise<string> {
  if (!options?.forceRefresh && credentials.accessToken?.trim()) {
    return credentials.accessToken;
  }
  const result = await refreshAccessToken(credentials, options);
  return result.accessToken;
}

export function expectedScope(): string {
  return DRIVE_SCOPE;
}

/**
 * Load OAuth credentials from environment variables.
 * Useful for local sandbox checks; never log the secret values.
 */
export function credentialsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OAuthCredentials {
  return {
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    refreshToken: env.GOOGLE_REFRESH_TOKEN ?? "",
    ...(env.GOOGLE_ACCESS_TOKEN
      ? { accessToken: env.GOOGLE_ACCESS_TOKEN }
      : {}),
  };
}
