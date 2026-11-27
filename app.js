const REPO = 'faarisaahmed/skong-dlc-wait';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/data/`;
const TEASER = new Date('2025-12-16T00:00:00Z');
// Announced Nov 27, 2026 ("It's Cherry Time!"). No launch time given, so count to local midnight.
const RELEASE = new Date('2026-12-11T00:00:00');
const RELEASE_DAY_END = new Date('2026-12-12T00:00:00');
const POLL_MS = 60_000;
const SRC_LABEL = { blog: 'Team Cherry blog', steam: 'Steam news', youtube: 'YouTube', build: 'Steam build' };

const $ = (s) => document.querySelector(s);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- data ----------
// Read from raw GitHub first (always fresh), fall back to the copy deployed with the site.
async function load(name) {
  for (const url of [`${RAW}${name}?t=${Date.now()}`, `data/${name}?t=${Date.now()}`]) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) return await r.json();
    } catch {}
  }
  return null;
}

const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
const esc = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let items = [];
let filter = 'all';
let config = {};

async function refresh() {
  const [status, updates, override, cfg] = await Promise.all([
    load('status.json'), load('updates.json'), load('override.json'), load('config.json'),
  ]);
  if (cfg) { config = cfg; renderAlerts(); }
  if (updates) { items = updates.items || []; renderFeed(); }
  if (status) renderStatus(status, override);
}

// ---------- status ----------
function renderStatus(s, override) {
  let status = s.status, reason = s.reason, trigger = s.trigger;
  if (override?.status) { status = override.status; reason = override.note || 'Set by hand.'; trigger = null; }
  // It has an official date. Until the watcher sees an "out now" post, show SOON (or TODAY on the day).
  else if (status !== 'YES' && Date.now() < RELEASE_DAY_END) {
    status = Date.now() < RELEASE ? 'SOON' : 'TODAY';
    reason = null;
    trigger = { source: 'youtube', title: 'Hollow Knight: Silksong - Sea of Sorrow - Launch Trailer', url: 'https://www.youtube.com/watch?v=7hj4g173FhM', date: '2026-11-27T15:13:54.000Z' };
  }

  document.body.dataset.status = status;
  $('#answer').textContent = status;
  $('#reason').textContent = {
    NO: 'Not yet. The sea is calm.',
    MAYBE: 'Something stirs beneath the waves…',
    YES: 'The tide is in. Go play.',
    SOON: 'December 11, 2026. It\'s official. LET\'S GO!',
    TODAY: 'It\'s December 11. Any minute now… keep this tab open.',
  }[status] + (reason && status !== 'NO' ? ` ${reason}` : '');
  const dated = status === 'SOON' || status === 'TODAY';
  $('#celebrate').hidden = !dated;
  $('#countdown').hidden = $('#countdown-note').hidden = $('#party').hidden = status !== 'SOON';
  if (dated && !store.get('partied')) { store.set('partied', '1'); confetti(); }
  document.title = status === 'NO' ? 'Is Sea of Sorrow Out?' : `${status} · Is Sea of Sorrow Out?`;

  const t = $('#trigger');
  if (trigger && status !== 'NO') {
    t.hidden = false;
    t.href = trigger.url;
    $('#trigger-src').textContent = SRC_LABEL[trigger.source] || trigger.source;
    $('#trigger-title').textContent = trigger.title;
    $('#trigger-date').textContent = fmtDate(trigger.date);
  } else t.hidden = true;

  // Notify if the answer changed since this browser last saw it.
  const last = store.get('lastStatus');
  if (last && last !== status) notify(`Is Sea of Sorrow out? ${status}`, trigger?.title || reason, trigger?.url);
  store.set('lastStatus', status);

  const health = Object.entries(s.sources || {}).map(([k, v]) => `${SRC_LABEL[k] || k}: ${v === 'ok' ? 'ok' : v}`);
  $('#health').textContent = health.length ? `Sources: ${health.join(' · ')}` : '';
}

async function lastChecked() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/check.yml/runs?per_page=1&status=completed`);
    const run = (await r.json()).workflow_runs?.[0];
    if (run) $('#stat-checked').textContent = ago(run.updated_at);
  } catch {}
}

function stats() {
  const day = 864e5;
  $('#stat-days').textContent = Math.floor((Date.now() - TEASER) / day);
}

// ---------- countdown ----------
function countdown() {
  const ms = Math.max(0, RELEASE - Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  $('#cd-d').textContent = Math.floor(ms / 864e5);
  $('#cd-h').textContent = pad(Math.floor(ms / 36e5) % 24);
  $('#cd-m').textContent = pad(Math.floor(ms / 6e4) % 60);
  $('#cd-s').textContent = pad(Math.floor(ms / 1e3) % 60);
  // Roll over to TODAY at midnight without waiting for the next poll.
  if (ms === 0 && document.body.dataset.status === 'SOON') refresh();
}

// ---------- confetti ----------
// One burst of sea-glass confetti, shells and bubbles. Skipped for reduced motion.
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti'; c.setAttribute('aria-hidden', 'true');
  document.body.appendChild(c);
  const ctx = c.getContext('2d'), dpr = Math.min(devicePixelRatio || 1, 2);
  const W = (c.width = innerWidth * dpr), H = (c.height = innerHeight * dpr);
  const colors = ['#e2b86e', '#8fe3ec', '#5fd4e2', '#c62a3c', '#d9f3f5', '#f4d58d'];
  const n = matchMedia('(pointer: coarse)').matches ? 110 : 200;
  const ps = Array.from({ length: n }, (_, i) => {
    const left = i % 2 === 0, ang = 0.25 + Math.random() * 0.6; // radians away from straight up
    const sp = (10 + Math.random() * 12) * dpr;
    return {
      x: left ? 0 : W, y: H * 0.9, vx: (left ? 1 : -1) * Math.sin(ang) * sp, vy: -Math.cos(ang) * sp,
      w: (6 + Math.random() * 8) * dpr, h: (4 + Math.random() * 6) * dpr, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
      color: colors[(Math.random() * colors.length) | 0], shape: Math.random() < 0.18 ? 'bubble' : Math.random() < 0.3 ? 'circle' : 'rect',
    };
  });
  const start = performance.now();
  const frame = (t) => {
    const el = t - start;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = el > 3500 ? Math.max(0, 1 - (el - 3500) / 1500) : 1;
    for (const p of ps) {
      p.vy += 0.28 * dpr; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      if (p.shape === 'bubble') { ctx.strokeStyle = 'rgba(143,227,236,0.9)'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(0, 0, p.w * 0.6, 0, 7); ctx.stroke(); }
      else if (p.shape === 'circle') { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(0, 0, p.h / 2, 0, 7); ctx.fill(); }
      else { ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2))); }
      ctx.restore();
    }
    if (el < 5000) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}
$('#party').addEventListener('click', confetti);

// ---------- feed ----------
function renderFeed() {
  const list = items.filter((i) => filter === 'all' || i.source === filter);
  const feed = $('#feed');
  if (!list.length) { feed.innerHTML = '<li class="empty">Nothing here yet.</li>'; return; }
  let html = '', dividerDone = false;
  const fresh = list.filter((i) => i.signal !== 'history');
  if (!fresh.length) html += '<li class="divider">Nothing new since the watch began</li>';
  for (const i of list) {
    if (i.signal === 'history' && !dividerDone) {
      if (fresh.length) html += '<li class="divider">Before the watch began</li>';
      dividerDone = true;
    }
    const badge = i.signal === 'yes' ? '<span class="lg yes">YES</span>' : i.signal === 'maybe' ? '<span class="lg maybe">MAYBE</span>' : '';
    html += `<li class="item ${i.signal}">
      <div class="item-meta"><span class="src ${i.source}">${SRC_LABEL[i.source] || i.source}</span>
      <span>${fmtDate(i.date)}</span>${badge}</div>
      <a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>
      ${i.summary ? `<p>${esc(i.summary)}</p>` : ''}</li>`;
  }
  feed.innerHTML = html;

  // Little dot on the Updates tab when there's something new you haven't opened.
  const newest = fresh[0]?.id;
  $('#updates-dot').hidden = !newest || store.get('seenItem') === newest || location.hash === '#updates';
  if (location.hash === '#updates' && newest) store.set('seenItem', newest);

  const seenFeed = store.get('lastItem');
  if (newest && seenFeed && seenFeed !== newest) notify('New signal from the deep', fresh[0].title, fresh[0].url);
  if (newest) store.set('lastItem', newest);
}

document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
  filter = c.dataset.filter; renderFeed();
}));

// ---------- tabs ----------
function route() {
  const tab = (location.hash || '#out').slice(1);
  const valid = document.querySelector(`[data-panel="${tab}"]`) ? tab : 'out';
  document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== valid));
  document.querySelectorAll('[data-tab]').forEach((a) => a.setAttribute('aria-selected', a.dataset.tab === valid));
  if (valid === 'updates') renderFeed();
}
addEventListener('hashchange', route);

// ---------- notifications ----------
let swReg = null;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then((r) => (swReg = r)).catch(() => {});

async function notify(title, body, url) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: url || location.href }, tag: 'sea-watch' };
  try { if (swReg) return await swReg.showNotification(title, opts); } catch {}
  try { new Notification(title, opts); } catch {}
}

function notifState() {
  const el = $('#notif-state');
  if (!('Notification' in window)) { el.textContent = 'This browser doesn\'t support notifications. On iPhone, add this site to your Home Screen first.'; return; }
  el.textContent = { granted: 'Notifications are on for this browser.', denied: 'Notifications are blocked. Turn them on in your browser\'s site settings.', default: 'Notifications are off.' }[Notification.permission];
}
$('#enable-notif').addEventListener('click', async () => {
  if ('Notification' in window) await Notification.requestPermission();
  notifState();
  notify('You\'ll hear the bell', 'This page will ping you when the answer changes.');
});
$('#test-notif').addEventListener('click', () => {
  if (Notification?.permission !== 'granted') { notifState(); return; }
  notify('Test: Is Sea of Sorrow out?', 'This is only a test. The sea is calm.');
});

function renderAlerts() {
  if (!config.ntfyTopic) return;
  $('#topic').textContent = config.ntfyTopic;
  $('#ntfy-web').href = `https://ntfy.sh/${config.ntfyTopic}`;
}
$('#copy-topic').addEventListener('click', async (e) => {
  try { await navigator.clipboard.writeText(config.ntfyTopic); e.target.textContent = 'Copied'; }
  catch { e.target.textContent = 'Select it ↑'; }
  setTimeout(() => (e.target.textContent = 'Copy'), 1800);
});

let installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#install-btn').hidden = false; });
$('#install-btn').addEventListener('click', () => installEvt?.prompt());

// ---------- floating motes ----------
// Mobile-friendly: the canvas is sized to the largest viewport once, and only rebuilt when the
// WIDTH changes (scrolling on phones changes the height as the address bar hides). Glows are
// pre-rendered sprites instead of per-frame shadowBlur, capped pixel ratio, ~30fps, paused when hidden.
function motes() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('#motes'), ctx = c.getContext('2d', { alpha: true });
  const mobile = matchMedia('(pointer: coarse)').matches;
  const dpr = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2);

  const sprite = (rgb) => {
    const s = document.createElement('canvas'); s.width = s.height = 32;
    const g = s.getContext('2d'), grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, `rgba(${rgb},1)`); grad.addColorStop(0.25, `rgba(${rgb},0.8)`); grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32); return s;
  };
  const TEAL = sprite('143,227,236'), GOLD = sprite('226,184,110');

  let w = 0, h = 0, lastW = 0, ps = [];
  const spawn = (any) => ({
    x: Math.random() * w, y: any ? Math.random() * h : h + 20,
    r: (Math.random() * 3.5 + 2.5) * dpr, v: (Math.random() * 0.5 + 0.15) * dpr,
    sway: Math.random() * Math.PI * 2, a: Math.random() * 0.5 + 0.25, gold: Math.random() < 0.35,
  });
  const resize = () => {
    if (innerWidth === lastW) return; // ignore height-only changes from mobile toolbars
    lastW = innerWidth;
    const tall = Math.max(innerHeight, screen.height || 0);
    w = c.width = Math.round(innerWidth * dpr); h = c.height = Math.round(tall * dpr);
    c.style.height = tall + 'px';
    ps = Array.from({ length: Math.min(mobile ? 40 : 80, Math.floor(innerWidth / 16)) }, () => spawn(true));
  };

  let running = true, last = 0;
  const tick = (t) => {
    if (!running) return;
    requestAnimationFrame(tick);
    if (t - last < 33) return; // ~30fps is plenty for drifting motes
    const dt = Math.min((t - last) / 33, 3); last = t;
    const status = document.body.dataset.status;
    const speed = status === 'YES' ? 3 : status === 'SOON' || status === 'TODAY' ? 1.8 : 1;
    ctx.clearRect(0, 0, w, h);
    for (const p of ps) {
      p.y -= p.v * speed * dt; p.sway += 0.02 * dt; p.x += Math.sin(p.sway) * 0.4 * dt;
      if (p.y < -20) Object.assign(p, spawn(false));
      ctx.globalAlpha = p.a;
      ctx.drawImage((status === 'MAYBE' || status === 'SOON' || status === 'TODAY') && p.gold ? GOLD : TEAL, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
  };
  addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) { last = 0; requestAnimationFrame(tick); }
  });
  resize(); requestAnimationFrame(tick);
}

// ---------- go ----------
route(); stats(); countdown(); motes(); notifState();
setInterval(countdown, 1000);
refresh(); lastChecked();
setInterval(refresh, POLL_MS);
setInterval(lastChecked, 2 * POLL_MS);
setInterval(stats, 3600_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); lastChecked(); } });
