// Supabase Edge Function: "team-admin"
//
// Lets a WorkHub admin add a teammate with a password, or set a new password
// for someone, without any email being sent. Only signed-in admins can use it.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   AA_SECRET_KEY    required - your Supabase SECRET key (sb_secret_..., from
//                    Project Settings -> API Keys). Keep it only here, never in the app.
//   AA_PUBLIC_KEY    required - your Supabase publishable key (already added for "claude")
//   ALLOWED_ORIGIN   optional - e.g. https://workhub.advancedaluminum.com (default: any)
// SUPABASE_URL is provided by Supabase automatically.

import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLES = ["admin", "editor", "viewer"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const publicKey = Deno.env.get("AA_PUBLIC_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  const secretKey = Deno.env.get("AA_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!publicKey || !secretKey) return reply(500, { error: "This function needs the AA_PUBLIC_KEY and AA_SECRET_KEY secrets." });

  // Is the caller a signed-in admin?
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return reply(401, { error: "Sign in first." });
  const asCaller = createClient(url, publicKey, { global: { headers: { Authorization: auth } } });
  const { data: caller, error: callerErr } = await asCaller.auth.getUser();
  if (callerErr || !caller?.user) return reply(401, { error: "Your sign-in expired. Sign in again." });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc("is_admin");
  if (adminErr || isAdmin !== true) return reply(403, { error: "Only admins can set passwords." });

  let body: { action?: string; email?: string; password?: string; name?: string; role?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "The request wasn't valid JSON." }); }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!EMAIL_RE.test(email)) return reply(400, { error: "Enter a valid email address." });
  if (password.length < 8) return reply(400, { error: "Use a password of at least 8 characters." });

  const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Add them to the team list (or update their name/access) when asked.
  if (body.action === "add") {
    const role = ROLES.includes(String(body.role)) ? String(body.role) : "editor";
    const { error } = await admin.from("members").upsert({ email, name: body.name ? String(body.name).trim() : null, role });
    if (error) return reply(500, { error: "Couldn't add them to the team list: " + error.message });
  } else if (body.action === "set_password") {
    const { data: m } = await admin.from("members").select("email").eq("email", email).maybeSingle();
    if (!m) return reply(404, { error: "That email isn't on the team list." });
  } else {
    return reply(400, { error: "Unknown action." });
  }

  // Create their sign-in, or change the password if they already have one.
  // has_password stays false so the app invites them to choose their own.
  const meta = { has_password: false, password_set_by_admin: true };
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
  if (!created.error) return reply(200, { ok: true, created: true });

  if (!/already|registered|exists/i.test(created.error.message)) {
    return reply(500, { error: "Couldn't create the sign-in: " + created.error.message });
  }
  // Find the existing sign-in and update it.
  let userId: string | null = null;
  for (let page = 1; page <= 20 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return reply(500, { error: "Couldn't look up the sign-in: " + error.message });
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) userId = hit.id;
    if (data.users.length < 200) break;
  }
  if (!userId) return reply(500, { error: "Couldn't find that person's sign-in." });
  const updated = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true, user_metadata: meta });
  if (updated.error) return reply(500, { error: "Couldn't set the password: " + updated.error.message });
  return reply(200, { ok: true, created: false });
});
