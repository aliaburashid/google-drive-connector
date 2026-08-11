import { getAccessToken } from "./auth/oauth.js";
import { ConnectorError } from "./errors/normalize.js";
import type { DriveAboutResponse, OAuthCredentials } from "./types.js";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

export interface DriveClientOptions {
  credentials: OAuthCredentials;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export interface DriveRequestInit {
  method?: string;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  body?: string;
}

export interface DriveHttpError {
  httpStatus: number;
  message: string;
  body?: unknown;
  requestId?: string;
}

/**
 * Minimal Drive API HTTP client.
 * Milestone 2 only needs about.get for testConnection.
 */
export class DriveClient {
  private readonly credentials: OAuthCredentials;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: DriveClientOptions) {
    this.credentials = options.credentials;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? DRIVE_API_BASE;
  }

  async about(fields: string): Promise<{ data: DriveAboutResponse; requestId?: string }> {
    return this.requestJson<DriveAboutResponse>("/about", {
      method: "GET",
      query: { fields },
    });
  }

  private async requestJson<T>(
    path: string,
    init: DriveRequestInit,
  ): Promise<{ data: T; requestId?: string }> {
    const accessToken = await getAccessToken(this.credentials, {
      fetchImpl: this.fetchImpl,
    });

    const url = new URL(`${this.baseUrl}${path}`);
    if (init.query) {
      for (const [key, value] of Object.entries(init.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          ...init.headers,
        },
        ...(init.body !== undefined ? { body: init.body } : {}),
      });
    } catch (err) {
      throw new ConnectorError({
        code: "network_error",
        message: err instanceof Error ? err.message : "Drive API request failed",
        retryClass: "retryable",
      });
    }

    const requestId =
      response.headers.get("x-request-id") ??
      response.headers.get("x-guploader-uploadid") ??
      undefined;

    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }

      const error: DriveHttpError = {
        httpStatus: response.status,
        message: `Drive API ${path} failed with HTTP ${response.status}`,
        body,
        ...(requestId !== undefined ? { requestId } : {}),
      };
      throw error;
    }

    const data = (await response.json()) as T;
    return {
      data,
      ...(requestId !== undefined ? { requestId } : {}),
    };
  }
}
