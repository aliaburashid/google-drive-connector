/**
 * Picks the correct host/port settings for laptop vs Render.
 *
 * On your laptop we listen on 127.0.0.1 (only this computer).
 * On Render we listen on 0.0.0.0 (so the public internet can reach us).
 */

/** Decide which network address the HTTP server should bind to. */
export function resolveListenHost(env: NodeJS.ProcessEnv = process.env): string {
  // If you set MCP_HTTP_HOST yourself, always honor that override.
  if (env.MCP_HTTP_HOST && env.MCP_HTTP_HOST.trim() !== "") {
    // trim() removes accidental spaces from the env value.
    return env.MCP_HTTP_HOST.trim();
  }
  // Render sets RENDER=true. We also treat NODE_ENV=production as "remote".
  if (env.RENDER === "true" || env.NODE_ENV === "production") {
    // 0.0.0.0 = accept connections from outside the container (required on Render).
    return "0.0.0.0";
  }
  // Default for local work: only your machine can connect.
  return "127.0.0.1";
}

/**
 * Build a list of Hostnames the server will accept.
 * This protects against DNS-rebinding when we bind beyond localhost.
 */
export function resolveAllowedHosts(
  // Tests can pass a fake env object; normally we use process.env.
  env: NodeJS.ProcessEnv = process.env,
): string[] | undefined {
  // Optional override: comma-separated hostnames, e.g. "a.onrender.com,b.onrender.com".
  if (env.MCP_ALLOWED_HOSTS && env.MCP_ALLOWED_HOSTS.trim() !== "") {
    // Split one string into many hostnames.
    return env.MCP_ALLOWED_HOSTS.split(",")
      // Remove spaces around each piece.
      .map((value) => value.trim())
      // Drop empty pieces (e.g. trailing commas).
      .filter((value) => value.length > 0);
  }

  // Otherwise try to read the public URL you set on Render.
  const publicUrl = env.MCP_PUBLIC_URL?.trim();
  if (publicUrl) {
    try {
      // From https://my-app.onrender.com → hostname "my-app.onrender.com".
      const hostname = new URL(publicUrl).hostname;
      // Return a one-item allowlist for that hostname.
      if (hostname) return [hostname];
    } catch {
      // If MCP_PUBLIC_URL is not a valid URL, ignore it and continue startup.
    }
  }

  // undefined = no extra allowlist (local SDK defaults still apply).
  return undefined;
}

/** Decide which TCP port to listen on. */
export function resolveListenPort(
  env: NodeJS.ProcessEnv = process.env,
  // Local default when PORT is not set.
  fallback = 8787,
): number {
  // Render injects PORT automatically; locally we use the fallback.
  const raw = env.PORT ?? String(fallback);
  // Convert the string "10000" into the number 10000.
  const port = Number.parseInt(raw, 10);
  // If parsing failed, fall back so we never listen on NaN/0.
  return Number.isFinite(port) && port > 0 ? port : fallback;
}
