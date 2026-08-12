import { getAccessToken } from "./auth/oauth.js";
import { ConnectorError } from "./errors/normalize.js";
import type { DriveAboutResponse, OAuthCredentials } from "./types.js";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

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

export interface DriveFileResource {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  md5Checksum?: string;
  webViewLink?: string;
  trashed?: boolean;
  parents?: string[];
  createdTime?: string;
  modifiedTime?: string;
  capabilities?: {
    canDownload?: boolean;
  };
  exportLinks?: Record<string, string>;
}

export interface DriveUploadParams {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  parents?: string[];
  fields?: string;
}

export interface DrivePermissionCreateParams {
  fileId: string;
  type: string;
  role: string;
  emailAddress?: string;
  domain?: string;
  sendNotificationEmail?: boolean;
  fields?: string;
}

export interface DrivePermissionResource {
  id?: string;
  type?: string;
  role?: string;
  emailAddress?: string;
  domain?: string;
  allowFileDiscovery?: boolean;
}

export interface DriveBinaryResult {
  bytes: Uint8Array;
  mimeType?: string;
  requestId?: string;
  rateLimit?: DriveRateLimitMetadata;
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

  async getFile(
    fileId: string,
    fields: string,
  ): Promise<{ data: DriveFileResource; requestId?: string; rateLimit?: DriveRateLimitMetadata }> {
    return this.requestJson<DriveFileResource>(`/files/${encodeURIComponent(fileId)}`, {
      method: "GET",
      query: {
        fields,
        supportsAllDrives: "true",
      },
    });
  }

  async downloadFile(fileId: string): Promise<DriveBinaryResult> {
    return this.requestBytes(`/files/${encodeURIComponent(fileId)}`, {
      method: "GET",
      query: {
        alt: "media",
        supportsAllDrives: "true",
      },
    });
  }

  async exportFile(fileId: string, mimeType: string): Promise<DriveBinaryResult> {
    return this.requestBytes(`/files/${encodeURIComponent(fileId)}/export`, {
      method: "GET",
      query: {
        mimeType,
      },
    });
  }

  async uploadMultipart(
    params: DriveUploadParams,
  ): Promise<{ data: DriveFileResource; requestId?: string; rateLimit?: DriveRateLimitMetadata }> {
    const metadata: Record<string, unknown> = {
      name: params.name,
      mimeType: params.mimeType,
    };
    if (params.parents !== undefined && params.parents.length > 0) {
      metadata.parents = params.parents;
    }

    const boundary = `connector_boundary_${Date.now()}`;
    const metaPart =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n`;
    const mediaHeader =
      `--${boundary}\r\n` +
      `Content-Type: ${params.mimeType}\r\n\r\n`;
    const footer = `\r\n--${boundary}--`;

    const metaBytes = new TextEncoder().encode(metaPart);
    const headerBytes = new TextEncoder().encode(mediaHeader);
    const footerBytes = new TextEncoder().encode(footer);
    const body = new Uint8Array(
      metaBytes.length + headerBytes.length + params.bytes.length + footerBytes.length,
    );
    body.set(metaBytes, 0);
    body.set(headerBytes, metaBytes.length);
    body.set(params.bytes, metaBytes.length + headerBytes.length);
    body.set(footerBytes, metaBytes.length + headerBytes.length + params.bytes.length);

    return this.requestJsonAbsolute(`${DRIVE_UPLOAD_BASE}/files`, {
      method: "POST",
      query: {
        uploadType: "multipart",
        supportsAllDrives: "true",
        fields: params.fields ?? "id, name, mimeType",
      },
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      bodyBytes: body,
    });
  }

  async uploadResumable(
    params: DriveUploadParams,
  ): Promise<{ data: DriveFileResource; requestId?: string; rateLimit?: DriveRateLimitMetadata }> {
    const metadata: Record<string, unknown> = {
      name: params.name,
      mimeType: params.mimeType,
    };
    if (params.parents !== undefined && params.parents.length > 0) {
      metadata.parents = params.parents;
    }

    const fields = params.fields ?? "id, name, mimeType";
    const start = await this.requestAbsolute(`${DRIVE_UPLOAD_BASE}/files`, {
      method: "POST",
      query: {
        uploadType: "resumable",
        supportsAllDrives: "true",
        fields,
      },
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": params.mimeType,
        "X-Upload-Content-Length": String(params.bytes.length),
      },
      body: JSON.stringify(metadata),
      acceptStatus: [200],
    });

    const sessionUrl = start.response.headers.get("location");
    if (!sessionUrl) {
      throw new ConnectorError({
        code: "upload_session_missing",
        message: "Google Drive resumable upload did not return a Location header",
        retryClass: "retryable",
        ...(start.requestId !== undefined ? { requestId: start.requestId } : {}),
      });
    }

    // Session URL already encodes the upload; do not rewrite its query string.
    return this.requestJsonAbsolute(sessionUrl, {
      method: "PUT",
      headers: {
        "Content-Type": params.mimeType,
        "Content-Length": String(params.bytes.length),
      },
      bodyBytes: params.bytes,
      absoluteUrlAlreadyIncludesQuery: true,
    });
  }

  async createPermission(
    params: DrivePermissionCreateParams,
  ): Promise<{
    data: DrivePermissionResource;
    requestId?: string;
    rateLimit?: DriveRateLimitMetadata;
  }> {
    const body: Record<string, unknown> = {
      type: params.type,
      role: params.role,
    };
    if (params.emailAddress !== undefined) body.emailAddress = params.emailAddress;
    if (params.domain !== undefined) body.domain = params.domain;

    return this.requestJson<DrivePermissionResource>(
      `/files/${encodeURIComponent(params.fileId)}/permissions`,
      {
        method: "POST",
        query: {
          supportsAllDrives: "true",
          fields: params.fields ?? "id, type, role",
          ...(params.sendNotificationEmail !== undefined
            ? { sendNotificationEmail: String(params.sendNotificationEmail) }
            : {}),
        },
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  }

  private async requestJsonAbsolute(
    absoluteUrl: string,
    init: DriveRequestInit & {
      bodyBytes?: Uint8Array;
      absoluteUrlAlreadyIncludesQuery?: boolean;
    },
  ): Promise<{ data: DriveFileResource; requestId?: string; rateLimit?: DriveRateLimitMetadata }> {
    const { response, requestId, rateLimit } = await this.requestAbsolute(absoluteUrl, {
      ...init,
      Accept: "application/json",
    });
    const data = (await response.json()) as DriveFileResource;
    return {
      data,
      ...(requestId !== undefined ? { requestId } : {}),
      ...(rateLimit !== undefined ? { rateLimit } : {}),
    };
  }

  private async requestAbsolute(
    absoluteUrl: string,
    init: DriveRequestInit & {
      bodyBytes?: Uint8Array;
      Accept?: string;
      acceptStatus?: number[];
      absoluteUrlAlreadyIncludesQuery?: boolean;
    },
  ): Promise<{ response: Response; requestId?: string; rateLimit?: DriveRateLimitMetadata }> {
    const accessToken = await getAccessToken(this.credentials, {
      fetchImpl: this.fetchImpl,
    });

    const url = new URL(absoluteUrl);
    if (init.query && init.absoluteUrlAlreadyIncludesQuery !== true) {
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
          ...(init.Accept !== undefined ? { Accept: init.Accept } : { Accept: "application/json" }),
          ...init.headers,
        },
        ...(init.bodyBytes !== undefined
          ? { body: init.bodyBytes }
          : init.body !== undefined
            ? { body: init.body }
            : {}),
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
    const okStatuses = init.acceptStatus ?? [200];
    // Resumable session start often returns 200; completed upload returns 200.
    // Also accept 201 Created for permission/create style responses via absolute helpers.
    const allowed = new Set([...okStatuses, 201]);

    if (!allowed.has(response.status)) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }

      const error: DriveHttpError = {
        httpStatus: response.status,
        message: `Drive API upload/write failed with HTTP ${response.status}`,
        body,
        ...(requestId !== undefined ? { requestId } : {}),
      };
      throw error;
    }

    return {
      response,
      ...(requestId !== undefined ? { requestId } : {}),
      ...(rateLimit !== undefined ? { rateLimit } : {}),
    };
  }

  private async requestJson<T>(
    path: string,
    init: DriveRequestInit,
  ): Promise<{ data: T; requestId?: string; rateLimit?: DriveRateLimitMetadata }> {
    const { response, requestId, rateLimit } = await this.request(path, init, {
      Accept: "application/json",
    });
    const data = (await response.json()) as T;
    return {
      data,
      ...(requestId !== undefined ? { requestId } : {}),
      ...(rateLimit !== undefined ? { rateLimit } : {}),
    };
  }

  private async requestBytes(
    path: string,
    init: DriveRequestInit,
  ): Promise<DriveBinaryResult> {
    const { response, requestId, rateLimit } = await this.request(path, init, {
      Accept: "*/*",
    });
    const buffer = new Uint8Array(await response.arrayBuffer());
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim();
    return {
      bytes: buffer,
      ...(mimeType !== undefined && mimeType !== "" ? { mimeType } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
      ...(rateLimit !== undefined ? { rateLimit } : {}),
    };
  }

  private async request(
    path: string,
    init: DriveRequestInit,
    extraHeaders: Record<string, string>,
  ): Promise<{ response: Response; requestId?: string; rateLimit?: DriveRateLimitMetadata }> {
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
          ...extraHeaders,
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

    return {
      response,
      ...(requestId !== undefined ? { requestId } : {}),
      ...(rateLimit !== undefined ? { rateLimit } : {}),
    };
  }
}
