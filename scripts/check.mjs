// Sea of Sorrow watcher.
// Runs in GitHub Actions on a schedule. Pulls every official Team Cherry / Steam source,
// decides NO / MAYBE / YES, writes data/*.json, and sends alerts (ntfy push + GitHub issue → email).
//
// Run locally without sending anything:  DRY_RUN=1 node scripts/check.mjs

import { readFile, writeFile } from 'node:fs/promises';

const DATA = new URL('../data/', import.meta.url);
const APP_ID = 1030300; // Hollow Knight: Silksong
const YT_CHANNEL = 'UCZS2K8ZsUmujTuj3cNMyBSA'; // Team Cherry
const MAYBE_DAYS = 14; // a MAYBE fades back to NO after this many quiet days
const DRY = !!process.env.DRY_RUN;

const SOURCES = {
  blog: 'https://www.teamcherry.com.au/blog?format=rss',
  steam: `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${APP_ID}&count=15&maxlength=600&feeds=steam_community_announcements`,
  youtube: `https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL}`,
  build: `https://api.steamcmd.net/v1/info/${APP_ID}`,
};

// ---------- helpers ----------
const readJSON = async (name, fallback) => {
  try { return JSON.parse(await readFile(new URL(name, DATA), 'utf8')); } catch { return fallback; }
};
const writeJSON = (name, obj) => writeFile(new URL(name, DATA), JSON.stringify(obj, null, 2) + '\n');

async function get(url, type = 'text') {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'skong-dlc-wait/1.0 (+github pages fan tracker)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return type === 'json' ? res.json() : res.text();
}

const decode = (s = '') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#39;|&#x27;|&rsquo;|&lsquo;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

const plain = (s = '', max = 240) => {
  const t = decode(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[\/?[a-z0-9*]+(=[^\]]*)?\]/gi, ' ') // steam bbcode
    .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};
const tag = (xml, name) => (xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1] || '';

// ---------- signal detection ----------
const SOS = /sea\s+of\s+sorrow/i;
const RELEASED = /\b(out now|available now|now available|now live|is live|is out|is here|is available|out today|arrives today|has (?:launched|arrived|released|landed)|launch(?:es|ed)? today|releas(?:es|ed) today|play (?:it )?now)\b/i;

// YES only when an official post's TITLE says Sea of Sorrow AND says it's out.
// Everything else that's new is a MAYBE.
function classify(item, watchStart) {
  if (new Date(item.date) < new Date(watchStart)) return 'history';
  if (item.source !== 'build' && SOS.test(item.title) && RELEASED.test(item.title)) return 'yes';
  return 'maybe';
}

// ---------- sources ----------
async function fetchBlog() {
  const xml = await get(SOURCES.blog);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => ({
    id: 'blog:' + decode(tag(it, 'link')),
    source: 'blog',
    title: decode(tag(it, 'title')).trim(),
    url: decode(tag(it, 'link')).trim(),
    date: new Date(tag(it, 'pubDate')).toISOString(),
    summary: plain(tag(it, 'description')),
  }));
}

async function fetchSteam() {
  const json = await get(SOURCES.steam, 'json');
  return json.appnews.newsitems.map((n) => ({
    id: 'steam:' + n.gid,
    source: 'steam',
    title: n.title.trim(),
    url: n.url.replace('steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements',
      `store.steampowered.com/news/app/${APP_ID}/view`),
    date: new Date(n.date * 1000).toISOString(),
    summary: plain(n.contents),
  }));
}

async function fetchYouTube() {
  const xml = await get(SOURCES.youtube);
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const vid = tag(e, 'yt:videoId');
    return {
      id: 'youtube:' + vid,
      source: 'youtube',
      title: decode(tag(e, 'title')).trim(),
      url: `https://www.youtube.com/watch?v=${vid}`,
      date: new Date(tag(e, 'published')).toISOString(),
      summary: plain(tag(e, 'media:description')),
    };
  });
}

// Steam build / branch / DLC changes. Compared against what we saw last run.
async function fetchBuild(state, now) {
  const json = await get(SOURCES.build, 'json');
  const app = json.data[String(APP_ID)];
  const branches = app.depots?.branches || {};
  const snap = {
    builds: Object.fromEntries(Object.entries(branches).map(([k, v]) => [k, v.buildid])),
    dlc: String(app.extended?.listofdlc || ''),
  };
  const items = [];
  const prev = state.build;
  if (prev) {
    for (const [branch, id] of Object.entries(snap.builds)) {
      const was = prev.builds[branch];
      if (was === id) continue;
      const updated = branches[branch]?.timeupdated;
      items.push({
        id: `build:${branch}:${id}`,
        source: 'build',
        title: was
          ? `Steam build updated on the "${branch}" branch`
          : `New Steam branch appeared: "${branch}"`,
        url: `https://steamdb.info/app/${APP_ID}/patchnotes/`,
        date: updated ? new Date(updated * 1000).toISOString() : now,
        summary: was ? `Build ${was} → ${id}. Could be a hotfix… or could be the sea.` : `Build ${id}. New branches sometimes mean betas or big content drops.`,
      });
    }
    if (snap.dlc !== prev.dlc) {
      items.push({
        id: `build:dlc:${snap.dlc || 'none'}`,
        source: 'build',
        title: 'Silksong\'s DLC list changed on Steam',
        url: `https://steamdb.info/app/${APP_ID}/dlc/`,
        date: now,
        summary: `DLC app IDs: ${snap.dlc || '(none)'} (was ${prev.dlc || '(none)'}).`,
      });
    }
  }
  return { items, snap };
}

// ---------- alerts ----------
async function ntfy(topic, { title, message, url, priority = 4, tags = [] }) {
  if (!topic) return;
  if (DRY) return console.log('[dry] ntfy:', title);
  await fetch("https://ntfy.sh/", {
    method: 'POST',
    body: JSON.stringify({ topic, title, message, click: url, priority, tags }),
    headers: { 'Content-Type': 'application/json' },
  }).catch((e) => console.warn('ntfy failed', e.message));
}

async function issue({ title, body, labels }) {
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return;
  if (DRY) return console.log('[dry] issue:', title);
  const owner = repo.split('/')[0];
  await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify({ title, body: `${body}\n\n@${owner}`, labels }),
  }).then((r) => { if (!r.ok) console.warn('issue failed', r.status); })
    .catch((e) => console.warn('issue failed', e.message));
}

// ---------- main ----------
const now = new Date().toISOString();
const config = await readJSON('config.json', {});
const state = await readJSON('state.json', {});
const override = await readJSON('override.json', { status: null });
const prevStatus = await readJSON('status.json', { status: 'NO' });
const prevUpdates = await readJSON('updates.json', { items: [] });

state.watchStart ||= now;

const sourceHealth = {};
const fresh = [];
for (const [name, fn] of Object.entries({ blog: fetchBlog, steam: fetchSteam, youtube: fetchYouTube })) {
  try { fresh.push(...await fn()); sourceHealth[name] = 'ok'; }
  catch (e) { sourceHealth[name] = 'error: ' + e.message; console.warn(name, e.message); }
}
try {
  const { items, snap } = await fetchBuild(state, now);
  fresh.push(...items);
  state.build = snap;
  sourceHealth.build = 'ok';
} catch (e) { sourceHealth.build = 'error: ' + e.message; console.warn('build', e.message); }

// Merge with what we already knew (keeps items if a source is temporarily down).
const known = new Map(prevUpdates.items.map((i) => [i.id, i]));
const newOnes = [];
for (const it of fresh) {
  if (known.has(it.id)) continue;
  it.signal = classify(it, state.watchStart);
  it.seen = now;
  known.set(it.id, it);
  if (it.signal !== 'history') newOnes.push(it);
}
const items = [...known.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80);

// Decide status.
const yesItem = items.find((i) => i.signal === 'yes');
const cutoff = Date.now() - MAYBE_DAYS * 864e5;
const maybeItem = items.find((i) => i.signal === 'maybe' && new Date(i.seen || i.date) > cutoff);
let status = 'NO', reason = 'No new official word from Team Cherry or Steam.', trigger = null;
if (yesItem) [status, reason, trigger] = ['YES', 'An official post says Sea of Sorrow is out.', yesItem];
else if (maybeItem) [status, reason, trigger] = ['MAYBE', 'Something new appeared from an official source.', maybeItem];
if (override?.status) [status, reason] = [override.status, override.note || 'Set by hand.'];

const statusOut = {
  status, reason, trigger,
  since: status === prevStatus.status ? prevStatus.since || now : now,
  watchStart: state.watchStart,
  sources: sourceHealth,
};

// Alerts.
const topic = config.ntfyTopic;
const icon = { blog: '📜', steam: '🎮', youtube: '🎬', build: '🛠️' };
for (const it of newOnes.slice(0, 5)) {
  await ntfy(topic, {
    title: `${icon[it.source] || '🌊'} ${it.signal === 'yes' ? 'SEA OF SORROW IS OUT' : 'New Team Cherry signal'}`,
    message: it.title, url: it.url, priority: it.signal === 'yes' ? 5 : 4, tags: ['ocean'],
  });
  await issue({
    title: `${it.signal === 'yes' ? '🟢 YES' : '🟡 MAYBE'}: ${it.title}`,
    body: `**Source:** ${it.source}\n**Posted:** ${it.date}\n\n${it.summary || ''}\n\n${it.url}\n\n— [skong-dlc-wait](${config.siteUrl || ''})`,
    labels: [it.signal],
  });
}
if (status !== prevStatus.status) {
  await ntfy(topic, {
    title: `Is Sea of Sorrow out? ${status}`,
    message: trigger?.title || reason,
    url: config.siteUrl, priority: status === 'YES' ? 5 : 3,
    tags: [status === 'YES' ? 'tada' : status === 'MAYBE' ? 'eyes' : 'zzz'],
  });
}

if (process.env.TEST_ALERT) {
  await ntfy(topic, { title: '🧪 Test: Is Sea of Sorrow out?', message: `Test alert. The real answer right now is ${status}.`, url: config.siteUrl, priority: 4, tags: ['test_tube'] });
  await issue({ title: `🧪 Test alert (answer is ${status})`, body: 'If you got this as an email, email alerts work. You can close this issue.', labels: [] });
}

// Write. Daily heartbeat keeps the scheduled workflow from being auto-disabled (GitHub disables after 60 idle days).
const today = now.slice(0, 10);
if (state.heartbeat !== today) state.heartbeat = today;
await writeJSON('status.json', statusOut);
await writeJSON('updates.json', { items });
await writeJSON('state.json', state);
console.log(`status=${status} new=${newOnes.length} sources=${JSON.stringify(sourceHealth)}`);
