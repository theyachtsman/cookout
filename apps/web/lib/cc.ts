"use client";

/**
 * Command Center API client.
 *
 * Deliberately separate from lib/api.ts: a staff session and a player session
 * are different identities, and sending one where the other is expected is the
 * kind of mistake that quietly grants or denies access. This client only ever
 * carries the staff token, stored under its own key.
 */
import { apiUrl } from "./api";
import type { Permission, StaffAccount } from "@cookout/shared";

const TOKEN_KEY = "cookout_cc_token";
/** Break-glass: the shared server admin key, when an operator is using it. */
const KEY_KEY = "cookout_cc_adminkey";

export function ccToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function setCcToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
export function ccAdminKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY_KEY);
}
export function setCcAdminKey(key: string | null): void {
  if (typeof window === "undefined") return;
  if (key) localStorage.setItem(KEY_KEY, key);
  else localStorage.removeItem(KEY_KEY);
}

export class CcAuthError extends Error {}

/**
 * The same authenticated request, but handed back raw.
 *
 * Downloads need the response itself rather than parsed JSON, and a plain
 * <a href> cannot carry the staff token the Command Center runs on — so the
 * file is fetched here and handed to the browser as a blob.
 */
export async function ccRaw(path: string): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = ccToken();
  const key = ccAdminKey();
  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers["x-admin-key"] = key;
  const res = await fetch(`${apiUrl()}${path}`, { headers });
  if (!res.ok) throw new Error(`export failed (${res.status})`);
  return res;
}

export async function cc<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = ccToken();
  const key = ccAdminKey();
  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers["x-admin-key"] = key;
  const res = await fetch(`${apiUrl()}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401) {
    // The session died — drop the token so the shell falls back to sign-in
    // instead of looping on requests that can never succeed.
    if (token) setCcToken(null);
    throw new CcAuthError(data.error ?? "sign in again");
  }
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export interface CcSession {
  account: StaffAccount;
  permissions: Permission[];
  expiresAt?: number;
  viaKey?: boolean;
  mustChangePassword?: boolean;
}

/** Permission check for hiding UI. The server enforces the real thing. */
export function can(session: CcSession | null, permission?: Permission): boolean {
  if (!session) return false;
  if (!permission) return true;
  return session.permissions.includes(permission);
}
