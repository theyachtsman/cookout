export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const WS_URL = (API_URL.replace(/^http/, "ws") + "/ws") as string;

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
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}
