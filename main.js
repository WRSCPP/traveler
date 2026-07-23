// ----------------------------- Bootstrap -----------------------------
// Chooses the data backend from config.js, installs it for store.js to pick up,
// then loads the app. Keeping this separate means app.js and store.js stay the
// same files across all three deployments.

import { CONFIG, IS_READONLY } from './config.js';

function fatal(message, detail) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:32px;background:#F5F1E8;color:#1F2A33;font-family:system-ui,sans-serif;z-index:9999;text-align:center';
  el.innerHTML = `<div style="max-width:520px">
    <h2 style="margin:0 0 10px;font-size:19px">Traveler couldn't start</h2>
    <p style="margin:0 0 8px;line-height:1.5">${message}</p>
    ${detail ? `<div style="margin:0;font-size:12.5px;color:#4b5563;line-height:1.6;text-align:left;background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px">${detail}</div>` : ''}
  </div>`;
  document.body.appendChild(el);
}

function addBanner(text, tone = 'info') {
  const bar = document.createElement('div');
  bar.className = `mode-banner ${tone}`;
  bar.textContent = text;
  document.body.insertBefore(bar, document.body.firstChild);
}

async function boot() {
  try {
    if (CONFIG.MODE === 'static') {
      const { createStaticBackend } = await import('./store-static.js');
      const backend = createStaticBackend(CONFIG.DATA_URL);
      globalThis.__TRAVELER_BACKEND__ = backend;
      document.body.classList.add('readonly');
      try {
        await backend.whenLoaded();
      } catch (err) {
        const tried = (err && err.tried) || [];
        fatal('The schedule data file is missing.',
          `Traveler looked for <code>data/traveler-data.json</code> next to index.html and couldn't find it.
           <br><br><b>Most likely:</b> the <code>data</code> folder didn't get uploaded with the other files.
           <br>In your repository, check that a folder named <code>data</code> exists containing
           <code>traveler-data.json</code>. Folder and file names are case-sensitive.
           ${tried.length ? `<br><br><span style="font-size:11px;opacity:.75">Tried: ${tried.map((t) => String(t).replace(/</g, '&lt;')).join(' · ')}</span>` : ''}`);
        return;
      }
      addBanner(CONFIG.READONLY_NOTE || 'Read-only view');
    } else if (CONFIG.MODE === 'cloud') {
      const cloud = await import('./store-cloud.js');
      const session = await cloud.getSession().catch(() => null);
      const backend = cloud.createCloudBackend({
        onRemoteChange: () => {
          // Let the app know something changed elsewhere; app.js listens for this.
          window.dispatchEvent(new CustomEvent('traveler:remote-change'));
        },
      });
      globalThis.__TRAVELER_BACKEND__ = backend;
      globalThis.__TRAVELER_CLOUD__ = cloud;
      // Viewers browse signed-out and get a read-only UI; editors sign in.
      if (!session) document.body.classList.add('readonly');
      try {
        await backend.whenLoaded();
      } catch (err) {
        const msg = String(err && err.message || err);
        fatal('Could not connect to the Traveler database.',
          `<b>What the browser reported:</b><br><code>${msg.replace(/</g, '&lt;')}</code>
           <br><br><b>Most common causes:</b>
           <br>• The database tables haven't been created yet — run <code>supabase/schema.sql</code> in the Supabase SQL Editor.
           <br>• The Project URL or key in <code>config.js</code> has a typo.
           <br>• The Supabase project is paused (free projects pause after ~1 week idle) — open your Supabase dashboard to wake it.`);
        return;
      }
      const { mountAuthUI } = await import('./auth-ui.js');
      mountAuthUI(session);
    }
    // 'local' needs no setup — store.js falls through to IndexedDB.

    await import('./app.js');

    // Lock the UI down once the app has rendered its first pass.
    if (document.body.classList.contains('readonly')) {
      const { enableReadOnly } = await import('./readonly.js');
      setTimeout(enableReadOnly, 300);
    }
  } catch (err) {
    fatal('Something went wrong while starting up.', String(err && err.message || err));
    console.error(err);
  }
}

if (IS_READONLY) document.documentElement.classList.add('readonly-boot');
boot();
