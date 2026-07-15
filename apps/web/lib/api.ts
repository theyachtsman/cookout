/**
 * API endpoint resolution:
 * 1. NEXT_PUBLIC_API_URL when set (production: your API behind Cloudflare).
 * 2. Otherwise the host the page was opened on, port 4000 — so LAN devices
 *    hitting http://<lan-ip>:3000 automatically talk to <lan-ip>:4000.
 */
const ENV_URL = process.env.NEXT_PUBLIC_API_URL;

export function apiUrl(): string {
  if (ENV_URL) return ENV_URL;
  if (typeof window !== "undefined") return `${window.location.protocol}//${window.location.hostname}:4000`;
  return "http://localhost:4000";
}

export function wsUrl(): string {
  return apiUrl().replace(/^http/, "ws") + "/ws";
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("cookout_token");
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; admin?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.admin) headers["x-admin-key"] = opts.admin;
  const res = await fetch(`${apiUrl()}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}
