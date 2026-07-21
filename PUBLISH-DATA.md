# Refreshing the published schedule (read-only site)

Two minutes, whenever you want the team to see current numbers.

1. **Open your local Traveler** (the desktop copy you use day to day).
2. **Settings → Export backup (.json)**. A file downloads, named something like
   `traveler-backup-2026-07-21.json`.
3. **Rename it to exactly:** `traveler-data.json`
4. **In GitHub:** open your repository → the `data` folder → click
   `traveler-data.json` → **Upload files** → drop in the new file → **Commit changes**.
5. Wait about a minute. Refresh the site — the team now sees the new numbers.

That's it. Nothing else needs to change.

---

### If the site says "couldn't start"

It couldn't find or read `data/traveler-data.json`. Check:

- The file is in the `data` folder, not the repository root
- The name is exactly `traveler-data.json` (no date, no `(1)` suffix)
- It's the file the Export button produced, not something edited by hand

### If the numbers look stale

GitHub Pages caches briefly. Wait a minute and hard-refresh (Ctrl+Shift+R, or
Cmd+Shift+R on a Mac).
