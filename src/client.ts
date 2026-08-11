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

export interface DriveRateLimitMetadata {
  limit?: string;
  remaining?: string;
  reset?: string;
  retryAfter?: string;
}

export interface DriveFileListParams {
  q?: string;
  pageSize?: number;
  pageToken?: string;
  orderBy?: string;
  spaces?: string;
  corpora?: string;
  includeItemsFromAllDrives?: boolean;
  supportsAllDrives?: boolean;
  fields?: string;
  driveId?: string;
}

export interface DriveFileListResponse {
  kind?: string;
  nextPageToken?: string;
  incompleteSearch?: boolean;
  files?: Array<{
    id?: string;
    name?: string;
    mimeType?: string;
    parents?: string[];
    modifiedTime?: string;
    createdTime?: string;
    size?: string;
    webViewLink?: string;
    trashed?: boolean;
    driveId?: string;
    [key: string]: unknown;
  }>;
}

function extractRateLimit(headers: Headers): DriveRateLimitMetadata | undefined {
  const limit =
    headers.get("x-ratelimit-limit") ?? headers.get("x-rate-limit-limit") ?? undefined;
  const remaining =
    headers.get("x-ratelimit-remaining") ??
    headers.get("x-rate-limit-remaining") ??
    undefined;
  const reset =
    headers.get("x-ratelimit-reset") ?? headers.get("x-rate-limit-reset") ?? undefined;
  const retryAfter = headers.get("retry-after") ?? undefined;

  const meta: DriveRateLimitMetadata = {
    ...(limit !== null && limit !== undefined ? { limit } : {}),
    ...(remaining !== null && remaining !== undefined ? { remaining } : {}),
    ...(reset !== null && reset !== undefined ? { reset } : {}),
    ...(retryAfter !== null && retryAfter !== undefined ? { retryAfter } : {}),
  };

  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Minimal Drive API HTTP client.
 * Provider HTTP only — action business logic stays in src/actions/.
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

  async listFiles(
    params: DriveFileListParams,
  ): Promise<{
    data: DriveFileListResponse;
    requestId?: string;
    rateLimit?: DriveRateLimitMetadata;
  }> {
    return this.requestJson<DriveFileListResponse>("/files", {
      method: "GET",
      query: {
        ...(params.q !== undefined ? { q: params.q } : {}),
        ...(params.pageSize !== undefined ? { pageSize: String(params.pageSize) } : {}),
        ...(params.pageToken !== undefined ? { pageToken: params.pageToken } : {}),
        ...(params.orderBy !== undefined ? { orderBy: params.orderBy } : {}),
        ...(params.spaces !== undefined ? { spaces: params.spaces } : {}),
        ...(params.corpora !== undefined ? { corpora: params.corpora } : {}),
        ...(params.includeItemsFromAllDrives !== undefined
          ? { includeItemsFromAllDrives: String(params.includeItemsFromAllDrives) }
          : {}),
        ...(params.supportsAllDrives !== undefined
          ? { supportsAllDrives: String(params.supportsAllDrives) }
          : {}),
        ...(params.fields !== undefined ? { fields: params.fields } : {}),
        ...(params.driveId !== undefined ? { driveId: params.driveId } : {}),
      },
    });
  }

  private async requestJson<T>(
    path: string,
    init: DriveRequestInit,
  ): Promise<{ data: T; requestId?: string; rateLimit?: DriveRateLimitMetadata }> {
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
    const rateLimit = extractRateLimit(response.headers);

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
      ...(rateLimit !== undefined ? { rateLimit } : {}),
    };
  }
}
