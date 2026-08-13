/**
 * Resolve listen host / allowedHosts for local vs Render production.
 *
 * Local default: 127.0.0.1 (DNS rebinding protection on).
 * Production/Render: 0.0.0.0 + allowedHosts from MCP_PUBLIC_URL or MCP_ALLOWED_HOSTS.
 */

export function resolveListenHost(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MCP_HTTP_HOST && env.MCP_HTTP_HOST.trim() !== "") {
    return env.MCP_HTTP_HOST.trim();
  }
  // Render sets RENDER=true; also treat NODE_ENV=production as remote.
  if (env.RENDER === "true" || env.NODE_ENV === "production") {
    return "0.0.0.0";
  }
  return "127.0.0.1";
}

export function resolveAllowedHosts(
  env: NodeJS.ProcessEnv = process.env,
): string[] | undefined {
  if (env.MCP_ALLOWED_HOSTS && env.MCP_ALLOWED_HOSTS.trim() !== "") {
    return env.MCP_ALLOWED_HOSTS.split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  const publicUrl = env.MCP_PUBLIC_URL?.trim();
  if (publicUrl) {
    try {
      const hostname = new URL(publicUrl).hostname;
      if (hostname) return [hostname];
    } catch {
      // Ignore invalid MCP_PUBLIC_URL; caller may still bind without host allowlist.
    }
  }

  return undefined;
}

export function resolveListenPort(
  env: NodeJS.ProcessEnv = process.env,
  fallback = 8787,
): number {
  const raw = env.PORT ?? String(fallback);
  const port = Number.parseInt(raw, 10);
  return Number.isFinite(port) && port > 0 ? port : fallback;
}
