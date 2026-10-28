# WorkHub

Advanced Aluminum's job costing app, moved off Claude.ai so the team can use it at
**workhub.advancedaluminum.com** with their own sign-in.

It does everything the Claude version did: the job profitability dashboard, estimates,
material bills (including drop-in bill PDFs read by Claude), closeout autopsies, insights,
PDF and Excel reports, and spreadsheet import.

## How it's put together

| Part | Where it lives | What it does |
|---|---|---|
| The app | `public/index.html` | Every screen and calculation. Almost unchanged from the Claude version. |
| Sign-in and storage | `public/hub.js` | Email sign-in, the Team list, and saving jobs, rates and bill files to Supabase. |
| Settings | `public/config.js` | Your Supabase address and public key. |
| Database | `supabase/migrations/0001_init.sql` | Tables, security rules and the bill-file storage. |
| Estimates | `supabase/migrations/0002_estimates.sql` | The table for saved field estimates. |
| Claude features | `supabase/functions/claude/index.ts` | Reads bills and writes insights with the company's Claude API key, kept on the server. |
| Emailed invoices | `supabase/functions/invoice-inbox/index.ts`, `google/invoice-inbox.gs` | Vendor invoices emailed to the company Gmail are read and filed on their job. |
| Hosting | `netlify.toml` | Tells Netlify to publish the `public` folder. |

**Signing in:** people sign in with their email and a password. The first time (and if they
forget their password) they ask for a 6-digit code by email, sign in with it, and choose a
password. So the app only sends an email when someone joins or resets their password.

**Who can see what:** only people on the Team list can sign in and see anything.
*Editors* can add and change jobs and bills, *viewers* can only look, and *admins* can also
manage the Team list. This is enforced by the database itself, not just the app.

---

## Setup, step by step

Plan on about an hour. You'll create three accounts: Supabase (database and sign-in),
Netlify (hosting) and an Anthropic API key (Claude). Each has a free or pay-as-you-go
start.

### 1. Create the database (Supabase)

1. Go to **supabase.com**, sign up, and click **New project**.
   Name it `aa-hub`, choose a strong database password (save it in your password manager),
   and pick a US East region.
2. When it's ready, open **SQL Editor → New query**. Paste the whole of
   `supabase/migrations/0001_init.sql` and click **Run**.
   Then do the same with `supabase/migrations/0002_estimates.sql` (saved field estimates) and
   `supabase/migrations/0004_pricebook_admins.sql` (only admins can change the price book).
3. Add yourself as the first admin. In a new query, run this with your email:
   ```sql
   insert into public.members (email, name, role)
   values ('you@advancedaluminum.com', 'Your Name', 'admin');
   ```
   Use lowercase for the email.

### 2. Set up sign-in emails

1. **Authentication → URL Configuration**
   - **Site URL:** `https://workhub.advancedaluminum.com`
   - **Redirect URLs:** add `https://workhub.advancedaluminum.com/**` and, for testing, your
     Netlify address from step 5 (for example `https://aa-hub.netlify.app/**`).
2. **Authentication → Emails → Magic Link** template: make sure the email includes the code
   as well as the link, so people on phones can type it in. Add this line to the template:
   ```
   <p>Your sign-in code: <strong>{{ .Token }}</strong></p>
   ```
3. **Authentication → Sign In / Providers → Email:** keep **Confirm email** turned on. It's
   what stops someone from creating an account with a teammate's email address.
4. **Optional:** Supabase's built-in email sender only sends a few emails an hour. Because
   people use passwords day to day, that's enough for a small team. Under
   **Authentication → Emails → SMTP Settings**, connect your company email
   (Google Workspace, Microsoft 365) or a sending service, so sign-in emails come from
   your own address and aren't limited.

### 3. Get a Claude API key

1. Go to **platform.claude.com** (the Claude Console), sign in, and add a payment method or
   credits under **Billing**. Reading a bill or writing insights costs a few cents each.
2. Open **Settings → API keys** (`platform.claude.com/settings/keys`) and click
   **Create key**. Name it `aa-workhub`, and under **Workspace** choose your workspace
   (for example **Default**) so the key needs no extra settings.
3. Copy the key (it starts with `sk-ant-`). It's shown only once; you'll paste it in the next
   step. Never put this key in `config.js` or anywhere in the `public` folder.

### 4. Add the Claude function

In Supabase, open **Edge Functions → Deploy a new function → Via editor**.

1. Name it exactly `claude`.
2. Replace the sample code with the whole of `supabase/functions/claude/index.ts`, then
   **Deploy**.
3. Open **Edge Functions → Secrets** and add:
   - `ANTHROPIC_API_KEY` = the key from step 3
   - `AA_PUBLIC_KEY` = your Supabase **publishable** key (`sb_publishable_…`, from
     **Project Settings → API Keys**)
   - `ALLOWED_ORIGIN` = `https://workhub.advancedaluminum.com`

(If you use the Supabase command line instead: `supabase functions deploy claude`.)

### 4b. Add the team-admin function (lets admins set passwords)

This lets an admin add a teammate with a password, or reset someone's password, from the
**Team** panel without any email being sent.

1. **Edge Functions → Deploy a new function → Via editor**, name it exactly `team-admin`,
   paste the whole of `supabase/functions/team-admin/index.ts`, and **Deploy**.
2. In **Project Settings → API Keys**, find your **secret** key (starts with `sb_secret_`;
   create one if there isn't one). Copy it.
3. In **Edge Functions → Secrets**, add `AA_SECRET_KEY` = that secret key.
   (`AA_PUBLIC_KEY` and `ALLOWED_ORIGIN` from step 4 are shared by both functions.)

The secret key can do anything in your database, so it lives only in Supabase's secrets:
never in `config.js`, the `public` folder, GitHub, an email, or a chat.

### 5. Connect the app to the database and publish it

1. In Supabase, copy the **Project URL** (**Project Settings → Data API**) and the
   **publishable** key (**Project Settings → API Keys**, starts with `sb_publishable_`).
2. On GitHub, open `public/config.js`, click the pencil to edit, paste the two values in
   place of the placeholders, and **Commit changes**. (Both are safe to publish; the
   database's security rules protect the data.)
3. Go to **netlify.com**, sign up with GitHub, and choose
   **Add new site → Import an existing project → GitHub → aa-workhub**.
   Netlify reads `netlify.toml`, so there's nothing to fill in. Click **Deploy**.
4. Open the address Netlify gives you, sign in with your email, and check the app loads.

From now on, every change committed to GitHub goes live automatically within a minute.

### 6. Put it on workhub.advancedaluminum.com

1. In Netlify: **Domain management → Add a domain** → `workhub.advancedaluminum.com`.
2. Wherever advancedaluminum.com's DNS is managed (your domain registrar, Cloudflare, or
   your web host), add one record:
   - **Type:** CNAME  **Name:** `workhub`  **Value:** your Netlify address, e.g. `aa-hub.netlify.app`
3. Netlify turns on HTTPS automatically once the record is found (usually within an hour).
   Your main website isn't affected.

### 7. Move your data from the Claude app

1. Unzip **AA-Hub-data-transfer.zip** (sent separately; it's not in GitHub because it holds
   your financial data).
2. Sign in to the hub, click **Team** at the top, and under
   **Move data from the Claude app** choose the backup `.json` file **and** every PDF in the
   `bill-files` folder at once.
3. When it says **Done**, check the dashboard matches the Claude version. It's safe to run
   again; jobs are updated, not duplicated.

Do this right before switching over, and stop entering data in the Claude version once
you've moved. If new jobs went into the Claude app after the transfer file was made,
ask Claude for a fresh one.

### 8. Invite the team

In the hub, click **Team**, add each person's name and email, choose **editor** or
**viewer**, and send them to **workhub.advancedaluminum.com**.

- **With a password:** type one in the **Password** box when you add them. They can sign in
  straight away with their email and that password; the app then invites them to choose their
  own. Tell them the password in person or by phone, not by email or text.
- **Without a password:** leave it blank. The first time, they click
  **Email me a sign-in code**, enter the code, and choose a password.
- **Forgot their password:** click **Set password** next to their name in **Team**. After that they sign in
with email and password. No Claude account is needed.

Anyone can change their password from **Password** at the top of the app.

### 9. Emailed vendor invoices (optional)

Vendor invoices emailed to the company Gmail go straight into WorkHub. Claude reads each one
and matches the customer name on it to a job. A sure match on an open job is added to that
job's **Material bills** by itself. Anything WorkHub isn't sure about waits at the top of the
**Jobs** page under **Emailed invoices**, where you pick the job and click **Add to job**.

**a. Database.** In **SQL Editor**, run `supabase/migrations/0003_invoice_inbox.sql`.

**b. A password for the inbox.** In your password manager, make a random password of at least
32 letters and numbers. You'll paste it in two places below, and nowhere else.

**c. The function.** **Edge Functions → Deploy a new function → Via editor**, name it exactly
`invoice-inbox`, paste the whole of `supabase/functions/invoice-inbox/index.ts`, and **Deploy**.
Then open the function's **Details** and turn **Verify JWT with legacy secret** (or
**Enforce JWT verification**) **off**, and save. (The Google script doesn't sign in; the
inbox password protects it instead.)
In **Edge Functions → Secrets**, add `INBOX_SECRET` = the password from step b.
(`AA_SECRET_KEY` and `ANTHROPIC_API_KEY` are already there.)

**d. Gmail filter.** Signed in to the Google account that receives vendor invoices, open Gmail →
the search box's options (the sliders icon):
- **From:** the vendors' billing addresses, separated by `OR`
  (for example `billing@vendor1.com OR ar@vendor2.com`)
- **Has attachment:** checked
- **Create filter → Apply the label → New label:** `WorkHub Invoices`. Also check
  **Also apply filter to matching conversations** if you want recent invoices sent too.

To add a vendor later, edit this filter's **From** line. You can also put the label on any
email by hand and it will be sent.

**e. Google script.** Same Google account, go to **script.google.com → New project**.
1. Name it `WorkHub invoice inbox`. Replace everything in `Code.gs` with
   `google/invoice-inbox.gs` and click **Save**.
2. **Project Settings** (gear) → **Script Properties** → add
   - `INBOX_URL` = `https://<your-project>.supabase.co/functions/v1/invoice-inbox`
   - `INBOX_SECRET` = the password from step b
3. Back in the editor, pick **setup** in the function menu and click **Run**. Approve the Gmail
   permissions Google asks for.

It now checks every 10 minutes. Emails that reach WorkHub get a second label,
`WorkHub Invoices/Sent`. Under **Executions** in the script you can see each run and any
errors.

---

## Day to day

- **Backups:** Supabase's paid plan includes daily backups. On the free plan, download a
  backup regularly from **Database → Backups**, or export the `jobs` table from the
  Table Editor.
- **Free plan pauses:** a free Supabase project pauses after a week with no activity.
  If the team uses it daily that won't happen; the paid plan never pauses.
- **Changing the app:** open this repository in Claude Code and describe the change.
  Commit to `main` and Netlify publishes it.
- **Removing someone:** **Team → Remove**. They lose access straight away.
