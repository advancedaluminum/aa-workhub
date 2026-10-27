// Supabase Edge Function: "claude"
//
// Reads bills and writes job insights for the AA Hub app by calling the
// Claude API. The company's Claude API key stays here on the server; the
// browser never sees it. Only signed-in people on the team list can use it.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   ANTHROPIC_API_KEY    required - from console.anthropic.com
//   CLAUDE_MODEL         optional - model for insights and scanned bills (default below)
//   CLAUDE_MODEL_QUICK   optional - faster, cheaper model for reading text bills
//   ALLOWED_ORIGIN       optional - e.g. https://hub.advancedaluminum.com (default: any)
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase automatically.

import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL_DEFAULT = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-5-5";
const MODEL_QUICK = Deno.env.get("CLAUDE_MODEL_QUICK") ?? "claude-haiku-5-5";
const ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const MAX_PROMPT_CHARS = 250_000;
const MAX_IMAGES = 5;

const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return reply(500, { error: "The Claude API key hasn't been set up yet.", code: "not_granted" });

  // Who is asking? Must be signed in and on the team list.
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return reply(401, { error: "Sign in first." });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return reply(401, { error: "Your sign-in expired. Sign in again." });
  const { data: member, error: memberErr } = await supabase.rpc("is_member");
  if (memberErr || member !== true) return reply(403, { error: "You're not on the team list.", code: "not_granted" });

  // What do they want Claude to do?
  let body: { prompt?: string; images?: { media_type: string; data: string }[]; tier?: string; json?: boolean };
  try { body = await req.json(); } catch { return reply(400, { error: "The request wasn't valid JSON.", code: "invalid_request" }); }
  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return reply(400, { error: "Nothing to ask.", code: "invalid_request" });
  if (prompt.length > MAX_PROMPT_CHARS) return reply(400, { error: "That's too much text to send at once.", code: "prompt_too_large" });
  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  const okTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  for (const img of images) {
    if (!okTypes.includes(img?.media_type) || typeof img?.data !== "string") return reply(400, { error: "Unsupported image.", code: "image_rejected" });
  }

  const model = body.tier === "quick" && images.length === 0 ? MODEL_QUICK : MODEL_DEFAULT;
  const content: unknown[] = images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } }));
  content.push({ type: "text", text: body.json ? prompt + "\n\nReply with only the JSON value, with no other text before or after it." : prompt });

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: "user", content }] }),
    });
  } catch (e) {
    return reply(502, { error: "Couldn't reach Claude: " + (e instanceof Error ? e.message : String(e)), code: "upstream_error" });
  }

  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = out?.error?.message ?? `Claude returned an error (${res.status}).`;
    if (res.status === 429 || res.status === 529) return reply(429, { error: msg, code: "rate_limited" });
    if (res.status === 401 || res.status === 403) return reply(500, { error: "The Claude API key was rejected. Check the ANTHROPIC_API_KEY secret.", code: "not_granted" });
    return reply(502, { error: msg, code: "upstream_error" });
  }
  const text = (out.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  if (!text.trim()) return reply(502, { error: "Claude didn't write anything.", code: "empty_completion" });
  return reply(200, { text, model, truncated: out.stop_reason === "max_tokens" });
});
