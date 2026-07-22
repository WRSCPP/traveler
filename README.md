# Traveler — Web Edition

Production planning for modular/tiny-home builds. This repository is the **web version** of Traveler. Your original local copy is untouched and keeps working exactly as it does today.

One codebase runs in three modes, chosen by a single line in `config.js`:

| Mode | What it is | Who it's for |
|---|---|---|
| `static` | **Read-only site.** Loads a published snapshot from `data/traveler-data.json`. No database, no sign-in, free to host. | The ~25 people who just need to see the schedule |
| `cloud` | **Full shared app.** Supabase database, live updates, editors sign in. | The 2–5 people who edit, plus everyone viewing |
| `local` | Original behaviour — browser storage, no server. | Your desktop copy |

---

## Stage 1 — Publish the read-only site (start here)

Gets the schedule onto any device, on a real URL, in about 20 minutes. Free.

### 1. Create the repository
1. Sign in to GitHub → **New repository**
2. Name it `traveler` and choose **Private** (see the note on privacy below)
3. Upload every file and folder from this directory, keeping the structure intact

### 2. Turn on GitHub Pages
1. Repository → **Settings** → **Pages**
2. Under *Build and deployment* → Source: **Deploy from a branch**
3. Branch: **main**, folder: **/ (root)** → **Save**
4. Wait a minute, then reload. GitHub shows your URL: `https://<your-username>.github.io/traveler/`

Share that link with your team. It works on laptops, desktops, and tablets.

> **Privacy note:** GitHub Pages sites are **publicly reachable** even from a private repository. Anyone with the link can view the schedule. If that isn't acceptable, skip to Stage 2, where sign-in protects the data — or host the read-only site on Netlify, which supports password protection.

### 3. Updating the published data

The read-only site shows a **snapshot**. To refresh it:

1. Open your **local** Traveler → **Settings** → **Export backup (.json)**
2. Rename the downloaded file to exactly `traveler-data.json`
3. In GitHub, open the `data` folder → click `traveler-data.json` → pencil icon → delete the contents and paste the new file's contents (or use **Upload files** and replace it)
4. Commit. The site updates in about a minute.

Do this whenever you want the team to see current numbers — daily, weekly, whatever suits.

---

## Stage 2 — The full shared app

Everyone sees the same live data, edits appear on every screen within moments, and 2–5 editors sign in while everyone else views.

### 1. Create the database
1. Go to [supabase.com](https://supabase.com) → sign up (free tier is fine) → **New project**
2. Pick a strong database password and save it somewhere safe
3. Wait for the project to finish provisioning (~2 minutes)

### 2. Create the tables
1. Supabase → **SQL Editor** → **New query**
2. Paste the entire contents of `supabase/schema.sql`
3. **Run**

This creates the tables, turns on security (anyone may read, only listed editors may write), enables live updates, and creates the file storage bucket.

### 3. Add your editors
For each of the 2–5 people who will edit:

1. **Authentication** → **Users** → **Add user** → enter their email and a password → create
2. Copy the new user's **UUID**
3. **SQL Editor** → run, once per editor:
   ```sql
   insert into editors (user_id, email) values ('paste-uuid-here', 'their@email.com');
   ```

Anyone not in that table can view but not change anything — enforced by the database, not just the interface.

### 4. Point Traveler at the database
1. Supabase → **Settings** → **API**
2. Copy the **Project URL** and the **anon public** key
3. Edit `config.js` in your repository:
   ```js
   MODE: 'cloud',
   SUPABASE: {
     URL: 'https://xxxxx.supabase.co',
     ANON_KEY: 'eyJhbG...',
   },
   ```
4. Commit. The site switches to the shared database.

> The anon key is **designed to be public** — it's safe in this file. What protects your data is the security rules from `schema.sql`. Never paste the `service_role` key here.

### 5. Load your real data
1. Export a fresh backup from your local copy (Settings → Export backup)
2. Open the published site and **sign in** as an editor
3. **Settings** → **Import backup** → choose that file

Import replaces everything in the database, so do this once at the start.

### 6. Check it works
Open the site on two devices, sign in on one, change a build name, and watch it appear on the other.

---

## Keeping your data safe

- **Your local copy is untouched.** Keep using it until the shared version is proven.
- **Export regularly.** The Export button still works and remains your own copy of everything. Supabase backs up the database, but an export you control is worth keeping.
- **Before importing anything, export first.** Import is destructive.

---

## What each file does

| File | Purpose |
|---|---|
| `config.js` | **The only file you edit to switch modes.** |
| `main.js` | Startup: picks the backend, applies read-only, then loads the app |
| `store.js` | The repository the app talks to (unchanged from local) |
| `store-static.js` | Read-only backend that serves the published JSON |
| `store-cloud.js` | Supabase backend: database, live updates, file uploads |
| `readonly.js` | Locks the interface for viewers |
| `auth-ui.js` | Sign in / sign out for editors |
| `app.js` | The application itself |
| `engine.js` | Scheduling and forecasting maths |
| `analytics.js` | Throughput, on-time delivery, reporting |
| `seed.js` | Starter data for an empty install |
| `supabase/schema.sql` | Database tables and security rules |
| `data/traveler-data.json` | The published snapshot (read-only mode) |
| `*.test.js` | Test suite — run with `node engine.test.js` etc. |

---

## Known limits, honestly

- **Build Hours and Gantt on phones.** Both are wide, dense tables. Tablets in landscape are fine; phones are cramped. Everything else adapts.
- **Simultaneous edits to the same field.** With 2–5 editors this is rare, and settings changes are merged key-by-key. But two people typing into the same cell at the same moment will still end with last-save-wins.
- **Attachments.** In cloud mode files upload to Supabase Storage and are served from a public (unguessable) URL. Don't store anything you'd consider confidential without tightening the storage rules.
- **The read-only site is a snapshot**, not live. It only updates when you publish a new export.
