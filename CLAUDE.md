# WorkHub: notes for Claude Code

Advanced Aluminum's job costing app (Brevard County, FL: pool enclosures, patio enclosures,
sunrooms, cover areas, screen rooms, rescreens, service work). Static site in `public/`, Supabase backend.

- `public/index.html` is the whole app. It was built as a Claude artifact and still calls
  `window.claude.use("db" | "user" | "assets" | "downloads" | "sample")`. `public/hub.js`
  provides those on Supabase, so keep app changes going through those same calls.
- Math: labor = team hours × team rate; overhead = team hours × overhead rate (per team of
  two technicians). Gross profit = price − (materials + labor + subs + engineering + financing
  fee). Financing fee = price × the plan's fee % when `job.payment.method === "finance"`, else 0.
  Net profit = gross − overhead. Jobs count in a period by their **completed date**.
- Security lives in `supabase/migrations/0001_init.sql` (row-level security on `members`).
  Add new migrations as new numbered files; don't edit applied ones.
- The Claude API key is only ever a Supabase secret used by `supabase/functions/claude` and
  `supabase/functions/invoice-inbox`. Never put keys in `public/`.
- Emailed vendor invoices: `google/invoice-inbox.gs` (Gmail label "WorkHub Invoices") posts
  attachments to `invoice-inbox`, which writes the `invoices` table. The app files `matched`
  ones as bills (bill id = invoice id) and lists `review` ones on the Jobs page.
- Never commit job data or backups (see `.gitignore`).
- Branding: Advanced Aluminum red `#DD2420`, Barlow Condensed headings, Source Sans 3 body,
  IBM Plex Mono numbers.
