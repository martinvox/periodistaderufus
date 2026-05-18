async function loadTweets() {
  const response = await fetch('data/tweets.json');
  if (!response.ok) throw new Error(`No se pudo cargar data/tweets.json: HTTP ${response.status}`);
  return response.json();
}

loadTweets().then((DATA) => {
const fmt = new Intl.NumberFormat('es-AR');
const dateFmt = new Intl.DateTimeFormat('es-AR', { year: 'numeric', month: 'short', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' });

const TYPE_LABEL = {
  replied_to: 'Respondiendo a',
  quoted: 'Citando a',
  retweeted: 'Retuiteando a',
};

// --- search-friendly normalization: lowercase + strip diacritics ---
function norm(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function escHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function linkify(text, urls, mentions) {
  let out = escHtml(text);
  (urls || []).forEach(u => {
    if (!u.short_url) return;
    const short = escHtml(u.short_url);
    const expanded = u.expanded_url || u.short_url;
    const disp = u.display_url || expanded;
    const re = new RegExp(escRegex(short), 'g');
    out = out.replace(re, `<a href="${escHtml(expanded)}" target="_blank" rel="noopener">${escHtml(disp)}</a>`);
  });
  (mentions || []).forEach(m => {
    if (!m.username) return;
    const re = new RegExp('@' + escRegex(m.username) + '\\b', 'gi');
    out = out.replace(re, `<a href="https://twitter.com/${escHtml(m.username)}" target="_blank" rel="noopener">@${escHtml(m.username)}</a>`);
  });
  out = out.replace(/(^|\s)#(\w+)/g, '$1<a href="https://twitter.com/hashtag/$2" target="_blank" rel="noopener">#$2</a>');
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<]+?)(?=[\s)<]|$)/g, (m, pre, url) => {
    if (out.includes('href="' + escHtml(url))) return m;
    return pre + `<a href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(url)}</a>`;
  });
  return out;
}

function refType(t) {
  if (!t.referenced || !t.referenced.length) return 'original';
  const types = t.referenced.map(r => r.type);
  if (types.includes('retweeted')) return 'retweeted';
  if (types.includes('quoted')) return 'quoted';
  if (types.includes('replied_to')) return 'replied_to';
  return 'original';
}

// tag dropdown
const tagCounts = new Map();
for (const t of DATA) for (const ct of (t.context_tags || [])) {
  tagCounts.set(ct.name, (tagCounts.get(ct.name) || 0) + 1);
}
const tagSel = document.getElementById('tag');
for (const [name, c] of [...tagCounts.entries()].sort((a,b) => b[1]-a[1])) {
  const o = document.createElement('option');
  o.value = name; o.textContent = `${name} (${c})`;
  tagSel.appendChild(o);
}

const dates = DATA.map(t => t.created_at).filter(Boolean).sort();
document.getElementById('stats').textContent =
  `${fmt.format(DATA.length)} tuits · del ${dateFmt.format(new Date(dates[0]))} al ${dateFmt.format(new Date(dates[dates.length-1]))}`;

function avatarLetter(t) { return (t.author_name || 'R').trim().charAt(0).toUpperCase(); }

function renderTweet(t, query) {
  const pm = t.public_metrics || {};
  const text = linkify(t.text || '', t.urls, t.mentions);
  const refs = (t.referenced || []).map(r => {
    const label = TYPE_LABEL[r.type] || r.type;
    const who = r.author_username ? `@${escHtml(r.author_username)}` : '';
    const body = r.text ? escHtml(r.text) : '<em style="color:var(--muted)">(tuit no incluido en el snapshot)</em>';
    return `<div class="ref">
      <div class="reftype">${label} ${who}</div>
      <div class="refbody">${body}</div>
    </div>`;
  }).join('');

  const urlCards = (t.urls || []).filter(u => u.expanded_url && !u.media_key).slice(0, 3).map(u => {
    let domain = '';
    try { domain = new URL(u.expanded_url).hostname.replace(/^www\./, ''); } catch {}
    if (domain.includes('twitter.com') || domain.includes('x.com')) return '';
    return `<a class="urlcard" href="${escHtml(u.expanded_url)}" target="_blank" rel="noopener">
      ${u.title ? `<div class="uctitle">${escHtml(u.title)}</div>` : ''}
      ${u.description ? `<div>${escHtml(u.description)}</div>` : ''}
      <div class="ucdomain">${escHtml(domain || u.display_url || u.expanded_url)}</div>
    </a>`;
  }).join('');

  const ctags = (t.context_tags || []).slice(0, 8).map(x => `<span class="tag">${escHtml(x.name)}</span>`).join('');

  const m = (k, label) => pm[k] ? `<span title="${label}">${fmt.format(pm[k])} ${label}</span>` : '';
  const metrics = [
    m('like_count', 'me gusta'),
    m('retweet_count', 'RT'),
    m('reply_count', 'resp.'),
    m('quote_count', 'citas'),
    m('impression_count', 'vistas'),
  ].filter(Boolean).join('');

  const created = t.created_at ? new Date(t.created_at) : null;
  const dateStr = created ? `${dateFmt.format(created)} · ${timeFmt.format(created)}` : '';

  const article = document.createElement('article');
  article.className = 'tweet';
  article.innerHTML = `
    <div class="avatar">${avatarLetter(t)}</div>
    <div>
      <div class="meta">
        <span class="name">${escHtml(t.author_name || 'Rufus')}</span>
        <span class="handle">@${escHtml(t.author_username || 'PeriodistaRufus')}</span>
        <span class="dot">·</span>
        <span class="date">${dateStr}</span>
      </div>
      ${refs}
      <div class="text">${text}</div>
      ${urlCards ? `<div class="urlcards">${urlCards}</div>` : ''}
      ${ctags ? `<div class="tags">${ctags}</div>` : ''}
      <div class="metrics">${metrics}</div>
      <div class="actionrow">
        <a href="${escHtml(t.wayback_url)}" target="_blank" rel="noopener">Ver snapshot</a>
        <a href="${escHtml(t.twitter_url)}" target="_blank" rel="noopener">Twitter / X</a>
      </div>
    </div>
  `;

  if (query) {
    // highlight ALL search-matching elements: text, ref body, url card text
    article.querySelectorAll('.text, .refbody, .urlcard').forEach(node => highlightInNode(node, query));
  }
  return article;
}

// Accent-insensitive highlight. Builds a regex on the normalized text,
// finds match positions, maps back to original-text indices, and wraps with <mark>.
function highlightInNode(node, q) {
  if (!q || !node) return;
  const qn = norm(q);
  if (!qn) return;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const tn of textNodes) {
    const orig = tn.textContent;
    const lower = norm(orig);
    if (lower.indexOf(qn) === -1) continue;
    // Build replacement HTML by scanning normalized form positions
    let html = '', i = 0;
    while (i < lower.length) {
      const j = lower.indexOf(qn, i);
      if (j === -1) { html += escHtml(orig.slice(i)); break; }
      html += escHtml(orig.slice(i, j));
      html += '<mark>' + escHtml(orig.slice(j, j + qn.length)) + '</mark>';
      i = j + qn.length;
    }
    const span = document.createElement('span');
    span.innerHTML = html;
    tn.replaceWith(span);
  }
}

function getFilters() {
  return {
    q:    document.getElementById('q').value.trim(),
    type: document.getElementById('type').value,
    tag:  document.getElementById('tag').value,
    sort: document.getElementById('sort').value,
  };
}

function tweetSearchHaystack(t) {
  // build once-per-tweet lazily on first use
  if (t.__hay) return t.__hay;
  const parts = [
    t.text || '',
    t.author_name || '', t.author_username || '',
    ...(t.mentions || []).map(m => m.username || ''),
    ...(t.hashtags || []),
    ...(t.context_tags || []).map(x => x.name || ''),
    ...(t.urls || []).flatMap(u => [u.expanded_url || '', u.title || '', u.description || '', u.display_url || '']),
    ...(t.referenced || []).flatMap(r => [r.text || '', r.author_username || '', r.author_name || '']),
  ];
  t.__hay = norm(parts.join(' \n '));
  return t.__hay;
}

function applyFilters() {
  const f = getFilters();
  let list = DATA.slice();
  if (f.type) list = list.filter(t => refType(t) === f.type);
  if (f.tag)  list = list.filter(t => (t.context_tags || []).some(x => x.name === f.tag));
  if (f.q) {
    const qn = norm(f.q);
    if (qn) list = list.filter(t => tweetSearchHaystack(t).includes(qn));
  }
  switch (f.sort) {
    case 'old': list.sort((a,b) => (a.created_at||'').localeCompare(b.created_at||'')); break;
    case 'like': list.sort((a,b) => (b.public_metrics?.like_count||0) - (a.public_metrics?.like_count||0)); break;
    case 'rt':  list.sort((a,b) => (b.public_metrics?.retweet_count||0) - (a.public_metrics?.retweet_count||0)); break;
    case 'imp': list.sort((a,b) => (b.public_metrics?.impression_count||0) - (a.public_metrics?.impression_count||0)); break;
    default:    list.sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));
  }
  return list;
}

const feed = document.getElementById('feed');
const empty = document.getElementById('empty');
const rc = document.getElementById('resultCount');

let renderCursor = 0;
const BATCH = 60;
let currentList = [];

function resetAndRender() {
  feed.innerHTML = '';
  currentList = applyFilters();
  renderCursor = 0;
  rc.textContent = `${fmt.format(currentList.length)} resultado${currentList.length===1?'':'s'}`;
  empty.style.display = currentList.length ? 'none' : 'block';
  renderMore();
}

function renderMore() {
  const f = getFilters();
  const next = currentList.slice(renderCursor, renderCursor + BATCH);
  const frag = document.createDocumentFragment();
  for (const t of next) frag.appendChild(renderTweet(t, f.q));
  feed.appendChild(frag);
  renderCursor += next.length;
}

const sentinel = document.createElement('div');
sentinel.style.height = '1px';
feed.parentNode.appendChild(sentinel);
new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && renderCursor < currentList.length) renderMore();
}).observe(sentinel);

let debounce;
function onChange() { clearTimeout(debounce); debounce = setTimeout(resetAndRender, 120); }
document.getElementById('q').addEventListener('input', onChange);
document.getElementById('type').addEventListener('change', resetAndRender);
document.getElementById('tag').addEventListener('change', resetAndRender);
document.getElementById('sort').addEventListener('change', resetAndRender);

resetAndRender();

}).catch((error) => {
  console.error(error);
  const feed = document.getElementById('feed');
  const resultCount = document.getElementById('resultCount');
  const empty = document.getElementById('empty');
  if (resultCount) resultCount.textContent = 'No se pudo cargar el archivo de datos';
  if (feed) feed.innerHTML = '';
  if (empty) {
    empty.textContent = 'No se pudo cargar data/tweets.json. Serví esta carpeta con un servidor local o subila a un hosting estático.';
    empty.style.display = 'block';
  }
});
