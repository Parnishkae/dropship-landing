// Единый интерфейс к бесплатному ИИ.
// Приоритет: Google Gemini (если задан GEMINI_API_KEY) → Cloudflare Workers AI (binding AI).
// Оба — с бесплатным тарифом. Claude не используется.
import { HttpError } from "./db.js";

export function aiProvider(env) {
  if (env.GEMINI_API_KEY) return "gemini";
  if (env.AI) return "workers-ai";
  return null;
}

export async function aiComplete(env, { system, user, maxTokens = 1200 }) {
  const provider = aiProvider(env);
  if (!provider) {
    throw new HttpError(503, "ИИ не подключён. Включите Workers AI (binding AI) или задайте GEMINI_API_KEY.");
  }
  if (provider === "gemini") return geminiComplete(env, { system, user, maxTokens });
  return workersAiComplete(env, { system, user, maxTokens });
}

async function geminiComplete(env, { system, user, maxTokens }) {
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    }),
  });
  if (!res.ok) throw new HttpError(502, "Gemini: " + res.status);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  if (!text) throw new HttpError(502, "Gemini вернул пустой ответ");
  return text;
}

// Gemini с реальным поиском в интернете (Google Search grounding).
// Возвращает { text, sources }. Требует GEMINI_API_KEY.
export async function geminiGrounded(env, { system, user, maxTokens = 2000 }) {
  if (!env.GEMINI_API_KEY) throw new HttpError(503, "Нужен GEMINI_API_KEY для поиска в интернете.");
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.8 },
    }),
  });
  if (!res.ok) throw new HttpError(502, "Gemini: " + res.status);
  const data = await res.json();
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || "").join("");
  const chunks = cand?.groundingMetadata?.groundingChunks || [];
  const sources = chunks.map((c) => ({ title: c.web?.title || "", uri: c.web?.uri || "" })).filter((s) => s.uri);
  return { text, sources };
}

async function workersAiComplete(env, { system, user, maxTokens }) {
  const model = env.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const out = await env.AI.run(model, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    temperature: 0.7,
  });
  const text = typeof out === "string" ? out : (out.response || "");
  if (!text) throw new HttpError(502, "Workers AI вернул пустой ответ");
  return text;
}

// Достаёт JSON из ответа модели (снимает ```json обёртки и мусор вокруг).
export function extractJSON(text) {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) t = t.slice(first, last + 1);
  return JSON.parse(t);
}

// Роль/контекст ИИ — эксперт по дропшипингу.
export const DROPSHIP_SYSTEM =
`Ты — опытный эксперт по дропшипингу и e-commerce. Ты помогаешь владельцу небольшого интернет-магазина.
Ты рассуждаешь как маркетолог и байер: смотришь на ассортимент, цены, наличие, категории и поведение покупателей.
Ты знаешь принципы трендовых товаров (импульсная покупка, вау-эффект, решение боли, сезонность, лёгкая доставка, высокая маржа).
Отвечай по-русски, конкретно и практично, без воды. Когда просят JSON — возвращай ТОЛЬКО валидный JSON без markdown.`;
