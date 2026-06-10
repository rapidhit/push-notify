import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "@workspace/db";
import {
  pnSitesTable,
  pnSubscribersTable,
  pnSubscriberTagsTable,
  pnCampaignStatsTable,
  pnClickEventsTable,
  pnCampaignsTable,
} from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { pnUsersTable } from "@workspace/db";

const router = Router();

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".png";
      cb(null, `icon_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Images only"));
  },
});

function getPlatformUrl(): string {
  if (process.env.PLATFORM_URL) return process.env.PLATFORM_URL.replace(/\/$/, "");
  if (process.env.REPLIT_DOMAINS) {
    const domain = process.env.REPLIT_DOMAINS.split(",")[0].trim();
    return `https://${domain}`;
  }
  return "";
}
const PLATFORM_URL = getPlatformUrl();

// ─── sdk.js ────────────────────────────────────────────────────────────────
router.get("/sdk.js", (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-cache");
  res.send(`
(function() {
  'use strict';
  // document.currentScript is null for async scripts — find by src pattern instead
  var src = '';
  if (document.currentScript && document.currentScript.src) {
    src = document.currentScript.src;
  } else {
    var all = document.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) {
      if (all[i].src && all[i].src.indexOf('/pn/sdk.js') !== -1) {
        src = all[i].src; break;
      }
    }
  }
  var qs = new URLSearchParams((src.split('?')[1]) || '');
  var siteId = qs.get('siteId');
  // swUrl: path to a sw.js hosted on THIS site (e.g. "/sw.js")
  // When set, no popup/redirect needed — SW registers directly on the page origin.
  var swUrl = qs.get('swUrl');
  if (!siteId) return;

  var API = '${PLATFORM_URL}/pn';
  var STORAGE_KEY = 'pn_sub_' + siteId;

  // --- Handle return from subscribe page (redirect mode) ---
  var params = new URLSearchParams(window.location.search);
  if (params.get('pn_subscribed') === '1') {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch(e) {}
    var clean = window.location.href.replace(/[?&]pn_subscribed=1/, '').replace(/[?&]$/, '');
    window.history.replaceState({}, '', clean);
    return;
  }

  // --- Already subscribed this browser? Skip prompt ---
  try { if (localStorage.getItem(STORAGE_KEY)) return; } catch(e) {}

  // --- Fetch site config ---
  fetch(API + '/sdk/config?siteId=' + encodeURIComponent(siteId))
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(config) {
      if (!config || !config.vapidPublicKey) return;
      var promptStyle = (config.promptConfig && config.promptConfig.promptStyle) || 'native';
      var delay = (config.promptConfig && config.promptConfig.delaySeconds) || 1;
      if (promptStyle === 'widget') {
        setTimeout(function() { showPrompt(config); }, delay * 1000);
      } else {
        // Native mode: skip the widget, show browser dialog directly
        setTimeout(function() { startNativeMode(config); }, delay * 1000);
      }
    })
    .catch(function() {});

  // --- Native mode: no widget, browser dialog directly ---
  function startNativeMode(config) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    if (Notification.permission === 'denied') return;

    var localSw = swUrl || 'sw.js';

    // Register SW silently in background (no permission needed for this)
    navigator.serviceWorker.register(localSw)
      .then(function() { return navigator.serviceWorker.ready; })
      .then(function(reg) {
        if (Notification.permission === 'granted') {
          // Already granted — subscribe right away
          doSubscribeWithReg(reg, config);
          return;
        }
        // Ask for permission. Chrome 72+ requires a user gesture,
        // so we try immediately and listen for the first interaction as fallback.
        Notification.requestPermission().then(function(perm) {
          if (perm === 'granted') {
            doSubscribeWithReg(reg, config);
          } else if (perm === 'default') {
            // Browser silently blocked auto-prompt — wait for first user interaction
            var handler = function() {
              document.removeEventListener('click', handler);
              document.removeEventListener('touchend', handler);
              document.removeEventListener('keydown', handler);
              Notification.requestPermission().then(function(p) {
                if (p === 'granted') doSubscribeWithReg(reg, config);
              });
            };
            document.addEventListener('click', handler, { once: true });
            document.addEventListener('touchend', handler, { once: true });
            document.addEventListener('keydown', handler, { once: true });
          }
        });
      })
      .catch(function() {
        // No local sw.js found — fall back to popup/redirect
        openRemote(config);
      });
  }

  function doSubscribeWithReg(reg, config) {
    reg.pushManager.getSubscription().then(function(existing) {
      if (existing) { saveSubscription(existing); return; }
      reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: u8(config.vapidPublicKey)
      }).then(function(sub) {
        saveSubscription(sub);
      }).catch(function() {});
    });
  }

  // --- Build the prompt widget ---
  function showPrompt(config) {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'denied') return;
    if (document.getElementById('__pn_prompt__')) return;

    var allowText = (config.promptConfig && config.promptConfig.allowText) || 'Allow Notifications';
    var denyText  = (config.promptConfig && config.promptConfig.denyText)  || 'No Thanks';
    var logoUrl   = config.promptConfig && config.promptConfig.logoUrl;

    var overlay = document.createElement('div');
    overlay.id = '__pn_prompt__';
    overlay.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:320px;';

    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:14px;padding:20px 22px;box-shadow:0 8px 32px rgba(0,0,0,.2);display:flex;flex-direction:column;gap:12px;';

    if (logoUrl) {
      var img = document.createElement('img');
      img.src = logoUrl; img.style.cssText = 'height:36px;width:auto;object-fit:contain;';
      box.appendChild(img);
    }

    var title = document.createElement('p');
    title.textContent = 'Get notified about updates';
    title.style.cssText = 'margin:0;font-size:14px;font-weight:700;color:#111;';
    box.appendChild(title);

    var sub = document.createElement('p');
    sub.textContent = 'Subscribe to receive push notifications directly in your browser.';
    sub.style.cssText = 'margin:0;font-size:12px;color:#555;line-height:1.5;';
    box.appendChild(sub);

    var btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px;';

    var allowBtn = document.createElement('button');
    allowBtn.id = '__pn_allow__';
    allowBtn.textContent = allowText;
    allowBtn.style.cssText = 'flex:1;padding:10px 0;background:#4F46E5;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;';

    var denyBtn = document.createElement('button');
    denyBtn.textContent = denyText;
    denyBtn.style.cssText = 'flex:1;padding:10px 0;background:#f1f5f9;color:#475569;border:none;border-radius:8px;cursor:pointer;font-size:13px;';

    btns.appendChild(allowBtn);
    btns.appendChild(denyBtn);
    box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    denyBtn.onclick = function() { overlay.remove(); };
    allowBtn.onclick = function() {
      overlay.remove();
      startSubscription(config);
    };
  }

  // --- Decide how to subscribe ---
  // Strategy: try registering a local sw.js on the current domain first.
  // If it succeeds (GitHub Pages, custom sites) → subscribe directly, one-click.
  // If it fails (Blogspot, Wix, etc. — no hosting control) → use popup/redirect.
  function startSubscription(config) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;

    var localSw = swUrl || 'sw.js';

    // Register local SW first (no permission needed at this step)
    navigator.serviceWorker.register(localSw)
      .then(function() { return navigator.serviceWorker.ready; })
      .then(function(reg) {
        // SW is on this domain — ask permission right here
        return Notification.requestPermission().then(function(perm) {
          if (perm !== 'granted') return;
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: u8(config.vapidPublicKey)
          }).then(function(sub) {
            return saveSubscription(sub);
          });
        });
      })
      .catch(function() {
        // No local sw.js (Blogspot etc.) — use popup/redirect on our domain
        openRemote(config);
      });
  }

  // --- Save subscription to our server ---
  function saveSubscription(sub) {
    var subJson = sub.toJSON();
    var ua = navigator.userAgent;
    return fetch(API + '/sdk/subscribe', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        siteId: siteId,
        subscription: subJson,
        geo: {},
        device: {
          browser: /Chrome/.test(ua) && !/Edg/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Edg/.test(ua) ? 'Edge' : /Safari/.test(ua) ? 'Safari' : 'Other',
          os: /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : 'Other',
          deviceType: /Mobi|Android/i.test(ua) ? 'mobile' : 'desktop',
          language: navigator.language || ''
        }
      })
    }).then(function() {
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch(e) {}
    }).catch(function(err) { console.warn('[PushNotify] save failed:', err); });
  }

  // --- Popup / redirect fallback (for sites with no local sw.js) ---
  function openRemote(config) {
    var subscribeUrl = API + '/push-subscribe?siteId=' + encodeURIComponent(config.siteId);
    var returnUrl    = encodeURIComponent(window.location.href
      .replace(/[?&]pn_subscribed=1/, '').replace(/[?&]$/, ''));

    var pw = 480, ph = 400;
    var pl = Math.max(0, (window.screen.width  - pw) / 2);
    var pt = Math.max(0, (window.screen.height - ph) / 2);

    var popup = null;
    try {
      popup = window.open(
        subscribeUrl + '&mode=popup',
        'pn_subscribe',
        'width=' + pw + ',height=' + ph + ',left=' + pl + ',top=' + pt +
        ',toolbar=0,menubar=0,location=0,status=0,scrollbars=0'
      );
    } catch(e) {}

    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      window.location.href = subscribeUrl + '&return=' + returnUrl;
      return;
    }

    var msgHandler = function(e) {
      if (!e.data || e.data.type !== 'PN_SUBSCRIBED') return;
      window.removeEventListener('message', msgHandler);
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch(ex) {}
    };
    window.addEventListener('message', msgHandler);

    var checkClosed = setInterval(function() {
      if (popup.closed) {
        clearInterval(checkClosed);
        window.removeEventListener('message', msgHandler);
        try { if (localStorage.getItem(STORAGE_KEY)) return; } catch(ex) {}
        showRetry(subscribeUrl, returnUrl);
      }
    }, 800);
  }

  function u8(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var raw = atob((b64 + pad).replace(/-/g,'+').replace(/_/g,'/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function showRetry(subscribeUrl, returnUrl) {
    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#1e1b4b;color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;font-family:-apple-system,sans-serif;font-size:13px;';
    bar.innerHTML = '<span>Want push notifications? Click the button to enable them.</span>';

    var btn = document.createElement('button');
    btn.textContent = 'Enable Now';
    btn.style.cssText = 'background:#818cf8;color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;margin-left:12px;';
    btn.onclick = function() {
      bar.remove();
      window.location.href = subscribeUrl + '&return=' + returnUrl;
    };

    var close = document.createElement('button');
    close.textContent = 'x';
    close.style.cssText = 'background:transparent;color:#a5b4fc;border:none;cursor:pointer;font-size:16px;margin-left:8px;padding:0 4px;';
    close.onclick = function() { bar.remove(); };

    bar.appendChild(btn);
    bar.appendChild(close);
    document.body.appendChild(bar);
  }
})();
`);
});

// ─── push-subscribe ─────────────────────────────────────────────────────────
// Handles BOTH popup mode (mode=popup) and redirect mode (return=URL).
// Registers the service worker, gets push subscription, saves it, then:
//   - popup mode  → postMessage to opener + closes
//   - redirect mode → redirects back to return URL with ?pn_subscribed=1
router.get("/push-subscribe", (req: Request, res: Response): void => {
  const siteId   = typeof req.query.siteId === "string" ? req.query.siteId : "";
  const mode     = typeof req.query.mode   === "string" ? req.query.mode   : "redirect";
  const returnTo = typeof req.query.return === "string" ? req.query.return  : "";

  res.setHeader("Content-Type", "text/html");
  res.setHeader("Cache-Control", "no-cache");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Enable Notifications</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f0f1ff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;}
.card{background:#fff;border-radius:20px;padding:36px 32px;text-align:center;max-width:400px;width:100%;box-shadow:0 8px 40px rgba(79,70,229,.12);}
.bell{width:64px;height:64px;background:#ede9fe;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;}
.bell svg{width:32px;height:32px;fill:#4F46E5;}
h1{font-size:20px;font-weight:700;color:#111;margin-bottom:10px;}
p{font-size:14px;color:#666;line-height:1.6;margin-bottom:24px;}
.btn{display:block;width:100%;padding:14px;background:#4F46E5;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;transition:background .2s;}
.btn:hover{background:#4338ca;}
.btn:disabled{background:#a5b4fc;cursor:not-allowed;}
.skip{display:block;margin-top:12px;font-size:13px;color:#94a3b8;background:none;border:none;cursor:pointer;width:100%;}
.status{margin-top:16px;font-size:13px;color:#4F46E5;min-height:18px;}
.status.error{color:#dc2626;}
.status.success{color:#16a34a;}
</style>
</head>
<body>
<div class="card">
  <div class="bell">
    <svg viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
  </div>
  <h1 id="hd">Enable Notifications</h1>
  <p id="msg">Click the button below and then click <strong>Allow</strong> when your browser asks.</p>
  <button class="btn" id="mainBtn">Enable Notifications</button>
  <button class="skip" id="skipBtn">No thanks</button>
  <div class="status" id="status"></div>
</div>
<script>
var SITE_ID  = '${siteId}';
var MODE     = '${mode}';
var RETURN   = '${returnTo}';
var API      = '${PLATFORM_URL}/pn';
var done     = false;

function setStatus(msg, cls) {
  var el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (cls ? ' ' + cls : '');
}

function setHeading(h, p) {
  document.getElementById('hd').textContent = h;
  document.getElementById('msg').textContent = p;
}

function u8(b64) {
  var pad = '='.repeat((4 - b64.length % 4) % 4);
  var raw = atob((b64 + pad).replace(/-/g,'+').replace(/_/g,'/'));
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function finish(sub) {
  if (done) return;
  done = true;
  var ua = navigator.userAgent;
  var isMobile = /Mobi|Android/i.test(ua);
  var browser = 'Other';
  if (/Chrome/.test(ua) && !/Edg/.test(ua)) browser = 'Chrome';
  else if (/Firefox/.test(ua)) browser = 'Firefox';
  else if (/Safari/.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  else if (/Edg/.test(ua)) browser = 'Edge';
  var os = 'Other';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Mac/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  var subJson = typeof sub.toJSON === 'function' ? sub.toJSON() : sub;

  fetch('https://ip-api.com/json/?fields=country,city,regionName')
    .then(function(r){return r.json();}).catch(function(){return {};})
    .then(function(loc) {
      return fetch(API + '/sdk/subscribe', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          siteId: SITE_ID,
          subscription: subJson,
          geo: { country: (loc && loc.country)||'', city: (loc && loc.city)||'', region: (loc && loc.regionName)||'' },
          device: { browser: browser, os: os, deviceType: isMobile ? 'mobile' : 'desktop', language: navigator.language||'', screenWidth: screen.width, screenHeight: screen.height }
        })
      });
    })
    .then(function() {
      setHeading('You are subscribed!', 'You will now receive push notifications.');
      setStatus('Subscribed successfully.', 'success');
      document.getElementById('mainBtn').style.display = 'none';
      document.getElementById('skipBtn').style.display = 'none';

      if (MODE === 'popup') {
        if (window.opener) {
          window.opener.postMessage({ type: 'PN_SUBSCRIBED' }, '*');
        }
        setTimeout(function() { window.close(); }, 1500);
      } else if (RETURN) {
        var sep = RETURN.indexOf('?') >= 0 ? '&' : '?';
        setTimeout(function() { window.location.href = RETURN + sep + 'pn_subscribed=1'; }, 1200);
      }
    })
    .catch(function() {
      setStatus('Could not save subscription. Please try again.', 'error');
      done = false;
      document.getElementById('mainBtn').disabled = false;
    });
}

document.getElementById('skipBtn').onclick = function() {
  if (MODE === 'popup') window.close();
  else if (RETURN) window.location.href = RETURN;
};

document.getElementById('mainBtn').onclick = function() {
  var btn = document.getElementById('mainBtn');
  btn.disabled = true;
  setStatus('Requesting permission...');

  Notification.requestPermission().then(function(perm) {
    if (perm !== 'granted') {
      setStatus('Permission denied. You can enable it in browser settings.', 'error');
      btn.disabled = false;
      return;
    }
    setStatus('Setting up...');

    fetch(API + '/sdk/config?siteId=' + encodeURIComponent(SITE_ID))
      .then(function(r) { return r.json(); })
      .then(function(config) {
        if (!config || !config.vapidPublicKey) throw new Error('No config');
        return navigator.serviceWorker.register(API + '/sw.js', { scope: '/' })
          .then(function() { return navigator.serviceWorker.ready; })
          .then(function(reg) {
            return reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: u8(config.vapidPublicKey)
            });
          });
      })
      .then(finish)
      .catch(function(err) {
        console.error('Push subscribe error:', err);
        setStatus('Something went wrong: ' + (err && err.message ? err.message : 'Please try again.'), 'error');
        btn.disabled = false;
      });
  });
};

// Auto-click if permission already granted
if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
  document.getElementById('mainBtn').click();
}
</script>
</body>
</html>`);
});

// ─── sw.js ─────────────────────────────────────────────────────────────────
router.get("/sw.js", (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Service-Worker-Allowed", "/");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-cache");
  res.send(`
var API = '${PLATFORM_URL}/pn';
self.addEventListener('push', function(event) {
  if (!event.data) return;
  var data = {};
  try { data = event.data.json(); } catch(e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'Notification', {
      body: data.body || '',
      icon: data.icon || undefined,
      image: data.image || undefined,
      data: { url: data.url || '/', campaignId: data.campaignId },
      actions: [{ action: 'open', title: 'Open' }]
    })
  );
});
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  var cid = event.notification.data && event.notification.data.campaignId;
  event.waitUntil(
    clients.openWindow(url).then(function() {
      if (cid) fetch(API + '/sdk/click?cid=' + cid, { method: 'POST' }).catch(function(){});
    })
  );
});
`);
});

// ─── Icon upload ─────────────────────────────────────────────────────────────
router.post("/sdk/upload-icon", upload.single("icon"), (req: Request, res: Response): void => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  const url = `${PLATFORM_URL}/pn/uploads/${req.file.filename}`;
  res.json({ url });
});

// ─── SDK config ─────────────────────────────────────────────────────────────
router.get("/sdk/config", async (req: Request, res: Response): Promise<void> => {
  const siteId = typeof req.query.siteId === "string" ? req.query.siteId : null;
  if (!siteId) { res.status(400).json({ error: "siteId required" }); return; }
  const [site] = await db.select().from(pnSitesTable).where(eq(pnSitesTable.siteId, siteId));
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({ siteId: site.siteId, vapidPublicKey: site.vapidPublicKey, promptConfig: site.promptConfig ?? {} });
});

// ─── SDK subscribe ───────────────────────────────────────────────────────────
router.post("/sdk/subscribe", async (req: Request, res: Response): Promise<void> => {
  const { siteId, subscription, geo, device } = req.body as {
    siteId?: string;
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    geo?: { country?: string; city?: string; region?: string };
    device?: { browser?: string; os?: string; deviceType?: string; language?: string; screenWidth?: number; screenHeight?: number };
  };
  if (!siteId || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    res.status(400).json({ error: "Invalid subscription data" }); return;
  }
  const [site] = await db.select().from(pnSitesTable).where(eq(pnSitesTable.siteId, siteId));
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }

  const existing = await db.select().from(pnSubscribersTable)
    .where(and(eq(pnSubscribersTable.siteId, siteId), eq(pnSubscribersTable.endpoint, subscription.endpoint)));

  if (existing.length > 0) {
    await db.update(pnSubscribersTable)
      .set({ active: true, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth })
      .where(eq(pnSubscribersTable.id, existing[0].id));
    res.json({ success: true }); return;
  }

  const [siteOwner] = await db.select().from(pnUsersTable).where(eq(pnUsersTable.id, site.userId));
  if (!siteOwner?.isPremium) {
    const [subCount] = await db.select({ count: count() }).from(pnSubscribersTable)
      .where(eq(pnSubscribersTable.siteId, siteId));
    if ((subCount?.count ?? 0) >= 500) {
      res.status(403).json({ error: "Free tier subscriber limit reached" });
      return;
    }
  }

  await db.insert(pnSubscribersTable).values({
    siteId, endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh, auth: subscription.keys.auth,
    country: geo?.country ?? null, city: geo?.city ?? null, region: geo?.region ?? null,
    browser: device?.browser ?? null, os: device?.os ?? null,
    deviceType: device?.deviceType ?? null, language: device?.language ?? null,
    screenWidth: device?.screenWidth ?? null, screenHeight: device?.screenHeight ?? null,
  });
  res.json({ success: true });
});

// ─── SDK click ──────────────────────────────────────────────────────────────
router.post("/sdk/click", async (req: Request, res: Response): Promise<void> => {
  const cid = typeof req.query.cid === "string" ? parseInt(req.query.cid, 10) : null;
  const sid = typeof req.query.sid === "string" ? parseInt(req.query.sid, 10) : 0;
  if (!cid) { res.json({ ok: true }); return; }
  const [campaign] = await db.select().from(pnCampaignsTable).where(eq(pnCampaignsTable.id, cid));
  if (campaign) {
    const [stats] = await db.select().from(pnCampaignStatsTable).where(eq(pnCampaignStatsTable.campaignId, cid));
    if (stats) {
      await db.update(pnCampaignStatsTable)
        .set({ clicked: stats.clicked + 1, updatedAt: new Date() })
        .where(eq(pnCampaignStatsTable.campaignId, cid));
    }
    await db.insert(pnClickEventsTable).values({ campaignId: cid, subscriberId: sid });
    if (campaign.label) {
      const subs = await db.select().from(pnSubscribersTable).where(eq(pnSubscribersTable.siteId, campaign.siteId));
      if (subs.length > 0) {
        const sub = subs[0];
        const existingTag = await db.select().from(pnSubscriberTagsTable)
          .where(and(eq(pnSubscriberTagsTable.subscriberId, sub.id), eq(pnSubscriberTagsTable.tag, campaign.label)));
        if (existingTag.length === 0) {
          await db.insert(pnSubscriberTagsTable).values({ subscriberId: sub.id, siteId: campaign.siteId, tag: campaign.label });
        }
      }
    }
  }
  res.json({ ok: true });
});

export default router;
