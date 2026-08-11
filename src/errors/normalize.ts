import type { NormalizedConnectorError, RetryClass } from "../types.js";

export class ConnectorError extends Error {
  readonly normalized: NormalizedConnectorError;

  constructor(normalized: NormalizedConnectorError) {
    super(normalized.message);
    this.name = "ConnectorError";
    this.normalized = normalized;
  }
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{
      domain?: string;
      reason?: string;
      message?: string;
    }>;
  };
}

function classifyRetry(
  httpStatus: number | undefined,
  reason: string | undefined,
): RetryClass {
  if (httpStatus === 401 || reason === "authError") {
    return "auth";
  }
  if (
    httpStatus === 429 ||
    reason === "rateLimitExceeded" ||
    reason === "userRateLimitExceeded" ||
    reason === "quotaExceeded"
  ) {
    return "rate_limited";
  }
  if (
    httpStatus === 408 ||
    httpStatus === 500 ||
    httpStatus === 502 ||
    httpStatus === 503 ||
    httpStatus === 504
  ) {
    return "retryable";
  }
  if (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500) {
    return "fatal";
  }
  return "none";
}

function withOptionalRequestId(
  base: Omit<NormalizedConnectorError, "requestId" | "provider" | "httpStatus"> &
    Partial<Pick<NormalizedConnectorError, "httpStatus">>,
  requestId?: string,
  provider?: NormalizedConnectorError["provider"],
): NormalizedConnectorError {
  return {
    ...base,
    ...(requestId !== undefined ? { requestId } : {}),
    ...(provider !== undefined ? { provider } : {}),
  };
}

/**
 * Normalize Google API / network failures into a stable connector error shape.
 */
export function normalizeError(
  err: unknown,
  fallbackRequestId?: string,
): NormalizedConnectorError {
  if (err instanceof ConnectorError) {
    return err.normalized;
  }

  if (err instanceof TypeError && /fetch|network|ECONN|ENOTFOUND/i.test(err.message)) {
    return withOptionalRequestId(
      {
        code: "network_error",
        message: err.message,
        retryClass: "retryable",
      },
      fallbackRequestId,
    );
  }

  if (typeof err === "object" && err !== null && "httpStatus" in err) {
    const httpErr = err as {
      httpStatus: number;
      body?: GoogleErrorBody;
      requestId?: string;
      message?: string;
    };
    const google = httpErr.body?.error;
    const reason = google?.errors?.[0]?.reason ?? google?.status;
    const message =
      google?.message ?? httpErr.message ?? `HTTP ${httpErr.httpStatus}`;

    const provider: NormalizedConnectorError["provider"] = {
      ...(reason !== undefined ? { reason } : {}),
      ...(google?.status !== undefined ? { status: google.status } : {}),
      ...(google?.errors !== undefined ? { details: google.errors } : {}),
    };

    return withOptionalRequestId(
      {
        code: reason ?? `http_${httpErr.httpStatus}`,
        message,
        retryClass: classifyRetry(httpErr.httpStatus, reason),
        httpStatus: httpErr.httpStatus,
      },
      httpErr.requestId ?? fallbackRequestId,
      Object.keys(provider).length > 0 ? provider : undefined,
    );
  }

  if (err instanceof Error) {
    return withOptionalRequestId(
      {
        code: "internal_error",
        message: err.message,
        retryClass: "fatal",
      },
      fallbackRequestId,
    );
  }

  return withOptionalRequestId(
    {
      code: "unknown_error",
      message: "An unknown error occurred",
      retryClass: "fatal",
    },
    fallbackRequestId,
  );
}

export function assertCredentialsPresent(credentials: {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
}): void {
  const missing: string[] = [];
  if (!credentials.clientId?.trim()) missing.push("clientId");
  if (!credentials.clientSecret?.trim()) missing.push("clientSecret");
  if (!credentials.refreshToken?.trim()) missing.push("refreshToken");

  if (missing.length > 0) {
    throw new ConnectorError({
      code: "invalid_credentials",
      message: `Missing required OAuth credential field(s): ${missing.join(", ")}`,
      retryClass: "fatal",
    });
  }
}
