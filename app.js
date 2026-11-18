const REPO = 'faarisaahmed/skong-dlc-wait';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/data/`;
const TEASER = new Date('2025-12-16T00:00:00Z');
const END_2026 = new Date('2027-01-01T00:00:00');
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

  document.body.dataset.status = status;
  $('#answer').textContent = status;
  $('#reason').textContent = {
    NO: 'Not yet. The sea is calm.',
    MAYBE: 'Something stirs beneath the waves…',
    YES: 'The tide is in. Go play.',
  }[status] + (reason && status !== 'NO' ? ` ${reason}` : '');
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

  const health = Object.entries(s.sources || {}).map(([k, v]) => `${SRC_LABEL[k] || k}: ${v === 'ok' ? '✓' : '⚠ ' + v}`);
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
  const left = Math.ceil((END_2026 - Date.now()) / day);
  $('#stat-left').textContent = left > 0 ? left : '0 😬';
}

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
  notify('You\'ll hear the bell 🔔', 'This page will ping you when the answer changes.');
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
function motes() {
  const c = $('#motes'), ctx = c.getContext('2d');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let w, h, ps;
  const resize = () => {
    w = c.width = innerWidth * devicePixelRatio; h = c.height = innerHeight * devicePixelRatio;
    ps = Array.from({ length: Math.min(90, Math.floor(innerWidth / 14)) }, () => spawn(true));
  };
  const spawn = (any) => ({
    x: Math.random() * w, y: any ? Math.random() * h : h + 10,
    r: (Math.random() * 1.8 + 0.4) * devicePixelRatio, v: (Math.random() * 0.35 + 0.08) * devicePixelRatio,
    sway: Math.random() * Math.PI * 2, a: Math.random() * 0.6 + 0.2,
  });
  const tick = () => {
    ctx.clearRect(0, 0, w, h);
    const yes = document.body.dataset.status === 'YES';
    const maybe = document.body.dataset.status === 'MAYBE';
    for (const p of ps) {
      p.y -= p.v * (yes ? 3 : 1); p.sway += 0.01; p.x += Math.sin(p.sway) * 0.3;
      if (p.y < -10) Object.assign(p, spawn(false));
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = maybe && p.r > 1.6 ? `rgba(226,184,110,${p.a})` : `rgba(143,227,236,${p.a})`;
      ctx.shadowBlur = 8; ctx.shadowColor = ctx.fillStyle;
      ctx.fill();
    }
    requestAnimationFrame(tick);
  };
  addEventListener('resize', resize); resize(); tick();
}

// ---------- go ----------
route(); stats(); motes(); notifState();
refresh(); lastChecked();
setInterval(refresh, POLL_MS);
setInterval(lastChecked, 2 * POLL_MS);
setInterval(stats, 3600_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); lastChecked(); } });
