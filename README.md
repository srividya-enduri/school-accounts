# School Accounts

A free web app for tracking a school's income and expenses, with the controls an auditor would ask for:

- **Numbered receipts and vouchers.** Numbers run in sequence each financial year with no gaps: `R/2026-27/0001` for money in, `V/…` for money out, `T/…` for transfers.
- **Two-person rule.** An accountant enters each entry and an admin approves it. Nobody can approve their own entry.
- **No deleting.** Wrong entries are *rejected* or *voided* with a reason, and stay in the records.
- **Bill photos** are attached to payments.
- **Audit log** records who added or changed what, and when.
- **Funds** (General, Building, Grants…), **categories**, **budgets**, and a **monthly bank/cash check**.
- **Reports:** Income & Expenditure statement, budget vs actual, fund-wise and month-wise summaries, plus CSV export for the CA.
- **Roles:** Admin sees and approves everything, Accountant enters, Viewer (e.g. a trustee) can only look.

**Where things live**

| What | Where | Visible to |
|---|---|---|
| App code | GitHub repo `school-accounts` (public), shown with GitHub Pages | Anyone, but there's no data in it |
| Live data and logins | Supabase (free) | Only staff the admin has activated |
| Daily data backup | GitHub repo `school-accounts-data` (**private**) | Only you, and anyone you add to that repo |

---

## Setup (about 30 minutes, one time)

### Step 1: Create the database (Supabase)

1. Go to **supabase.com** and sign in. Click **New project**.
   - Name: `school-accounts`. Choose a strong database password and keep it somewhere safe. Region: **Mumbai** (or the one closest to you).
2. When the project is ready, open **SQL Editor → New query**.
3. Open `supabase/schema.sql` from this folder, copy **all** of it, paste it in, and click **Run**. It should say *Success*.
4. Go to **Authentication → Sign In / Providers** (or **Providers → Email**) and turn **OFF "Allow new users to sign up"**.
   This means only people you invite can get a login.

### Step 2: Create your own admin login

1. **Authentication → Users → Add user → Create new user.** Enter your email and a password, and tick **Auto confirm user**.
2. Back in **SQL Editor**, run this (with your email):
   ```sql
   update public.profiles set role = 'admin', active = true
   where email = 'your-email@example.com';
   ```

### Step 3: Put the code on GitHub

1. On GitHub (signed in as **srividya-enduri**), click **+ → New repository**.
   - Name: `school-accounts`. Visibility: **Public** (free GitHub Pages needs this; there is no data in the code). Click **Create**.
2. Edit `docs/config.js` before uploading:
   - `SUPABASE_URL`: Supabase → **Project Settings → API** (or **Data API**) → *Project URL*
   - `SUPABASE_ANON_KEY`: Supabase → **Project Settings → API Keys** → the **anon public** key (under "Legacy API keys") or the **publishable** key
   - `SCHOOL_NAME`: your school's name
   - ⚠️ **Never** paste the `service_role` / `secret` key here.
3. In the new repo, click **uploading an existing file**. Drag in the `docs` folder, the `supabase` folder and `README.md`, then click **Commit changes**.
4. **Settings → Pages.** Under *Build and deployment*: Source **Deploy from a branch**, Branch **main**, folder **/docs**. Click **Save**.
5. After 1–2 minutes your app is live at:
   **https://srividya-enduri.github.io/school-accounts/**

### Step 4: Tell Supabase where the app lives

Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://srividya-enduri.github.io/school-accounts/`
- **Redirect URLs:** add `https://srividya-enduri.github.io/school-accounts/`

Invite and password-reset emails link here.

Open the app and sign in with the login from Step 2. 🎉

### Step 5: Daily backup into a private GitHub repo

1. On GitHub: **+ → New repository.** Name `school-accounts-data`, visibility **Private**. Click **Create**.
2. Upload `README.md` and the `scripts` folder from the `school-accounts-data` folder.
3. Add the workflow. GitHub's uploader can skip folders whose names start with a dot, so create this file by hand:
   **Add file → Create new file**, type the name `.github/workflows/backup.yml`, paste in the contents of that file, and click **Commit**.
4. **Settings → Secrets and variables → Actions → New repository secret.** Add two secrets:
   - `SUPABASE_URL`: the same Project URL as before
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Project Settings → API Keys → the **service_role** key (legacy) or a **secret** key.
     This key can read everything, so it goes **only** here, never in the app.
5. **Actions** tab → **Daily backup from Supabase → Run workflow.** After about a minute, a `data/` folder appears.
   From then on it runs every night, and the **Commits** page shows what changed each day.

> Bonus: free Supabase projects pause after a week with no activity. The nightly backup counts as activity, so it also keeps the database awake.

---

## Adding staff

1. Supabase → **Authentication → Users → Invite user.** Enter their email.
2. They click the link in the email and set a password.
3. In the app: **Settings → Staff.** Choose their role, tick **Active** and click **Save**.

To remove someone, untick **Active**. Their past entries stay in the records under their name.

## Day-to-day use

| Who | What |
|---|---|
| Accountant | **Entries → + Money in** for each fee or donation (print the receipt for the payer). **− Money out** for each payment, with a photo of the bill. |
| Admin | **Approvals.** Open each entry, check the bill, then approve or reject. |
| Accountant/Admin, monthly | **Bank check.** Compare the app's balance with the bank statement and the petty cash count, and save the check. |
| Admin/Viewer | **Dashboard** and **Reports**: where the money went, and budget vs actual. **Audit log**: who did what. |
| Year end | **Reports → Print / save as PDF** and **Download all entries (CSV)**. Give these, plus the backup repo's CSVs, to your CA. |

## Updating the app

Edit files in the `school-accounts` repo on GitHub (click a file → ✏️ → Commit). GitHub Pages republishes in about a minute.
If you change the database, run the new SQL in Supabase's SQL Editor and also commit it to `supabase/` so there's a record of it.

## Important limits

- This app keeps clean, audit-ready books. It does **not** replace the yearly audit by a Chartered Accountant, if your trust or society is required to have one.
- The two-person rule needs **at least two people**: one who enters and one admin who approves. If an admin also enters entries, a second admin must approve those.
- Free Supabase plan: 500 MB database and 1 GB file storage. That's years of school records, but compress very large bill photos.
