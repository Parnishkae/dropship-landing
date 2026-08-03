// Аутентификация админки: подписанная кука сессии (HMAC-SHA256, Web Crypto).
import { HttpError } from "./db.js";

const COOKIE = "admin_session";
const TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 дней

function secretKey(env) {
  return env.AUTH_SECRET || env.ADMIN_PASSWORD || "insecure-dev-secret-change-me";
}

async function hmac(env, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secretKey(env)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createSessionCookie(env) {
  const payload = String(Date.now() + TTL_MS);
  const sig = await hmac(env, payload);
  const value = `${payload}.${sig}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL_MS / 1000}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

async function isValid(env, value) {
  if (!value) return false;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return false;
  const expected = await hmac(env, payload);
  if (sig !== expected) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && exp > Date.now();
}

export async function requireAuth(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`${COOKIE}=([^;]+)`));
  const ok = match && (await isValid(env, decodeURIComponent(match[1])));
  if (!ok) throw new HttpError(401, "Требуется авторизация.");
}

export function checkPassword(env, password) {
  const expected = env.ADMIN_PASSWORD;
  if (!expected) {
    throw new HttpError(
      503,
      "ADMIN_PASSWORD не задан. Установи секрет в настройках Cloudflare Pages."
    );
  }
  return typeof password === "string" && password === expected;
}
