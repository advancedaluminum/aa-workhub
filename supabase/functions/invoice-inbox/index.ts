// Supabase Edge Function: "invoice-inbox"
//
// Receives vendor invoices that arrive by email. A small Google Apps Script in
// the Advanced Aluminum Google Workspace (google/invoice-inbox.gs) sends each
// PDF or photo attached to an email labeled "WorkHub Invoices". This function:
//   1. saves the file with the other bill files (private "bills" bucket),
//   2. has Claude read the vendor, invoice #, date and total, and match the
//      customer name on the invoice to a WorkHub job,
//   3. adds a row to the "invoices" table. The app then files sure matches on
//      open jobs as material bills and lists the rest under "Needs a job".
//
// Nobody signs in to call this, so it's protected by its own shared secret.
// Deploy it with JWT verification turned OFF (see README, step 9).
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   INBOX_SECRET       required - a long random password; the same value goes in the Google script
//   AA_SECRET_KEY      required - your Supabase secret key (already added for team-admin)
//   ANTHROPIC_API_KEY  required - already added for the claude function
//   ANTHROPIC_WORKSPACE_ID, CLAUDE_MODEL  optional - same as the claude function
// SUPABASE_URL is provided by Supabase automatically.

import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-5-5";
const BUCKET = "bills";
const MAX_BYTES = 25 * 1024 * 1024;
const FILE_TYPES: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

type Job = { id: string; name: string; location: string; status: string; completedDate: string; bills: { vendor?: string; ref?: string }[] };

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function sha(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function anthropicHeaders(apiKey: string): Record<string, string> {
  const h: Record<string, string> = { "Authorization": `Bearer ${apiKey}`, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  const ws = Deno.env.get("ANTHROPIC_WORKSPACE_ID");
  if (ws) h["anthropic-workspace-id"] = ws;
  return h;
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function isoDate(s: unknown): string {
  const t = String(s ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return "";
}
// Words in a job name that identify the customer (not the project type).
function nameWords(name: string) {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(pool|patio|enclosure|enclosures|sunroom|screen|room|cover|area|new|the|and|example|rescreen|repair|job)$/.test(w));
}
function refMatchesJob(ref: string, job: Job) {
  const r = ref.toLowerCase();
  const words = nameWords(job.name);
  return words.length > 0 && words.some((w) => r.includes(w));
}
function isOpen(j: Job) { return j.status !== "closed"; }

function buildPrompt(jobs: Job[], email: { from: string; subject: string }) {
  const list = jobs.map((j) => `- id ${j.id}: ${j.name || "(no name)"}${j.location ? ", " + j.location : ""} [${isOpen(j) ? "open" : "closed " + (j.completedDate || "")}]`).join("\n");
  return "You are reading a supplier bill (invoice) emailed to Advanced Aluminum, a company in Brevard County, Florida that builds aluminum pool enclosures, patio enclosures, sunrooms and cover areas. " +
    "Advanced Aluminum is the CUSTOMER on the bill, never the vendor. Vendors usually write the homeowner's name (Advanced Aluminum's customer) on the bill as a job name, PO, customer reference or ship-to.\n\n" +
    `The email was from: ${email.from || "unknown"}\nSubject: ${email.subject || "(none)"}\n\n` +
    "Advanced Aluminum's jobs:\n" + (list || "(none)") + "\n\n" +
    "Reply with only a JSON object:\n" +
    '{"isInvoice": true if this is a single bill/invoice or credit memo for materials, false for a statement, quote, order confirmation, receipt of payment or anything else, ' +
    '"vendor": "company that issued the bill", "invoiceNumber": "invoice or bill number, or empty string", "date": "invoice date as YYYY-MM-DD, or empty string", ' +
    '"total": final amount owed for this bill including tax and freight as a number (negative for a credit memo), "subtotal": number or null, "tax": number or null, "freight": number or null, ' +
    '"jobReference": "the customer, job, PO or ship-to name written on the bill, exactly as written, or empty string", "isCredit": true or false, ' +
    '"jobId": "the id of the job this bill is for, or empty string if none fits", "confidence": "high only if the customer name on the bill clearly matches exactly one job, otherwise medium or low", ' +
    '"reason": "one short sentence on how you matched it or why you couldn\'t", "notes": "one short sentence on anything unclear, or empty string"}\n' +
    "Use the bill's own total line, not a running balance or a statement total across several invoices.";
}

async function readWithClaude(apiKey: string, b64: string, type: string, prompt: string) {
  const file = type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: type, data: b64 } };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: anthropicHeaders(apiKey),
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: [file, { type: "text", text: prompt + "\n\nReply with only the JSON object, with no other text." }] }] }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.error?.message ?? `Claude returned an error (${res.status}).`);
  const text = (out.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Claude's answer wasn't readable.");
  return JSON.parse(m[0]);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  const secret = Deno.env.get("INBOX_SECRET") ?? "";
  if (secret.length < 24) return reply(500, { error: "Add an INBOX_SECRET of at least 24 characters to this function's secrets." });
  if (!sameSecret(req.headers.get("x-inbox-secret") ?? "", secret)) return reply(401, { error: "Wrong inbox secret." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("AA_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!serviceKey) return reply(500, { error: "This function needs the AA_SECRET_KEY secret." });

  let body: { messageId?: string; from?: string; subject?: string; receivedAt?: string; fileName?: string; mimeType?: string; data?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "The request wasn't valid JSON." }); }
  const messageId = String(body.messageId ?? "").slice(0, 200);
  const fileName = String(body.fileName ?? "invoice").slice(0, 200);
  const type = String(body.mimeType ?? "").toLowerCase().replace("image/jpg", "image/jpeg");
  const b64 = String(body.data ?? "");
  if (!messageId || !b64) return reply(400, { error: "Missing the email id or the file." });
  if (!FILE_TYPES[type]) return reply(200, { ok: true, skipped: "not a PDF or photo" });
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return reply(400, { error: "The file wasn't valid base64." }); }
  if (bytes.length > MAX_BYTES) return reply(200, { ok: true, skipped: "file over 25 MB" });

  const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // The same email attachment is only ever filed once.
  const id = "em-" + (await sha(messageId + "\n" + fileName + "\n" + bytes.length)).slice(0, 24);
  const { data: existing } = await db.from("invoices").select("id").eq("id", id).maybeSingle();
  if (existing) return reply(200, { ok: true, id, duplicate: true });

  // Keep the original file with the other bill files.
  const safe = fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-60) || "invoice." + FILE_TYPES[type];
  const path = `inbox/${new Date().getFullYear()}/${id}-${safe}`;
  const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: true });
  if (up.error) return reply(500, { error: "Couldn't save the file: " + up.error.message });

  // Jobs it could belong to: open jobs, plus jobs closed in the last 120 days.
  const { data: rows, error: jobsErr } = await db.from("jobs").select("id,data");
  if (jobsErr) return reply(500, { error: "Couldn't read jobs: " + jobsErr.message });
  const cutoff = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const jobs: Job[] = (rows ?? []).map((r: { id: string; data: Record<string, unknown> }) => ({
    id: r.id, name: String(r.data?.name ?? ""), location: String(r.data?.location ?? ""), status: String(r.data?.status ?? "estimate"),
    completedDate: String(r.data?.completedDate ?? ""), bills: Array.isArray(r.data?.bills) ? r.data.bills as Job["bills"] : [],
  }));
  const candidates = jobs.filter((j) => isOpen(j) || (j.completedDate && j.completedDate >= cutoff));

  const record: Record<string, unknown> = {
    status: "review", receivedAt: body.receivedAt || new Date().toISOString(), from: String(body.from ?? "").slice(0, 200), subject: String(body.subject ?? "").slice(0, 300),
    fileName, filePath: path, fileUrl: "bill:" + path, bill: { date: "", vendor: "", ref: "", amount: null }, info: {}, jobId: "", confidence: "", reason: "",
  };

  if (!apiKey) record.reason = "Claude isn't set up, so this needs to be entered by hand.";
  else {
    try {
      const r = await readWithClaude(apiKey, b64, type, buildPrompt(candidates, { from: String(record.from), subject: String(record.subject) }));
      const amount = num(r.total);
      record.bill = { date: isoDate(r.date), vendor: String(r.vendor ?? "").slice(0, 80), ref: String(r.invoiceNumber ?? "").slice(0, 40), amount };
      record.info = {
        subtotal: num(r.subtotal), tax: num(r.tax), freight: num(r.freight), jobRef: String(r.jobReference ?? "").slice(0, 120),
        notes: String(r.notes ?? "").slice(0, 300), credit: !!r.isCredit || (amount !== null && amount < 0), isInvoice: r.isInvoice !== false,
      };
      const job = candidates.find((j) => j.id === String(r.jobId ?? ""));
      record.jobId = job ? job.id : "";
      record.confidence = job ? String(r.confidence ?? "low") : "";
      record.reason = String(r.reason ?? "").slice(0, 300);

      // Already on a job? (same vendor and invoice number)
      const ref = String((record.bill as { ref: string }).ref).replace(/\W/g, "").toLowerCase();
      const vend = String((record.bill as { vendor: string }).vendor).toLowerCase().slice(0, 4);
      const dup = ref ? jobs.find((j) => j.bills.some((b) => String(b.ref ?? "").replace(/\W/g, "").toLowerCase() === ref && (!vend || !b.vendor || String(b.vendor).toLowerCase().slice(0, 4) === vend))) : null;
      if (dup) { record.status = "review"; record.duplicateOf = dup.id; record.reason = `Invoice ${(record.bill as { ref: string }).ref} is already on ${dup.name || "a job"}.`; }
      // File it automatically only when everything lines up.
      else if (job && record.confidence === "high" && isOpen(job) && (record.info as { isInvoice: boolean }).isInvoice && amount !== null && amount !== 0 &&
        refMatchesJob(String((record.info as { jobRef: string }).jobRef), job)) {
        record.status = "matched";
      }
    } catch (e) {
      record.reason = "Claude couldn't read this one (" + (e instanceof Error ? e.message : String(e)).slice(0, 160) + "). Enter it by hand.";
    }
  }

  const ins = await db.from("invoices").insert({ id, data: record });
  if (ins.error && !/duplicate key/i.test(ins.error.message)) return reply(500, { error: "Couldn't save the invoice: " + ins.error.message });
  return reply(200, { ok: true, id, status: record.status, jobId: record.jobId });
});
