"""
Interactive selector review tool.
  python review_selectors.py  →  http://localhost:7331
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import requests as http
from bs4 import BeautifulSoup
from flask import Flask, Response, jsonify, render_template_string, request

GEN_FILE       = Path("domain_selectors.jsonl")
VAL_FILE       = Path("domain_selectors_validated.jsonl")
LABELS_FILE    = Path("selector_labels.jsonl")
PORT           = 7331

LABELS = [
    ("correct",       "✅ Correct",                    "#1a3a1a", "#3a3", "#7f7"),
    ("not_found",     "🔍 Selector not found",         "#1a1a3a", "#44a", "#88f"),
    ("too_broad",     "🔊 Too broad",                  "#2a1a00", "#a60", "#fb0"),
    ("too_narrow",    "🔬 Too narrow",                 "#002020", "#196", "#4df"),
    ("not_article",   "📄 Not an article",             "#2a2000", "#880", "#ff8"),
    ("wrong_domain",  "🚫 Wrong domain",               "#2a1a1a", "#844", "#faa"),
]
LABEL_COLORS = {k: bg for k, _, bg, _, _ in LABELS}


def auto_label_from_validator():
    """
    Scan domain_selectors_validated.jsonl and write 'not_found' labels for
    domains where every validation attempt returned 'selector matched nothing'.
    Skips domains already in selector_labels.jsonl.
    """
    if not VAL_FILE.exists():
        return 0

    existing = set()
    if LABELS_FILE.exists():
        for line in LABELS_FILE.open():
            try:
                existing.add(json.loads(line)["domain"])
            except Exception:
                pass

    written = 0
    with LABELS_FILE.open("a") as f:
        for line in VAL_FILE.open():
            try:
                r = json.loads(line)
            except Exception:
                continue
            domain = r.get("domain")
            if not domain or domain in existing:
                continue
            validations = r.get("validation", [])
            if not validations:
                continue
            # only auto-label if every result is a hard "selector matched nothing"
            # (not an LLM judgement — those are ambiguous)
            all_not_found = all(
                v.get("verdict") == "not_found" or
                (v.get("ok") is False and v.get("issue") == "selector matched nothing")
                for v in validations
            )
            if all_not_found:
                record = {
                    "domain":    domain,
                    "label":     "not_found",
                    "url":       None,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "source":    "auto:validator",
                }
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
                existing.add(domain)
                written += 1
    return written


# ── data ──────────────────────────────────────────────────────────────────────

def load_data():
    gen, val = {}, {}
    for line in (GEN_FILE.open() if GEN_FILE.exists() else []):
        try:
            r = json.loads(line); gen[r["domain"]] = r
        except Exception: pass
    for line in (VAL_FILE.open() if VAL_FILE.exists() else []):
        try:
            r = json.loads(line); val[r["domain"]] = r
        except Exception: pass

    domains = []
    for domain, g in gen.items():
        v = val.get(domain, {})
        validations = v.get("validation", [])
        ok_count   = sum(1 for x in validations if x.get("verdict") == "ok" or x.get("ok") is True)
        fail_count = sum(1 for x in validations if x.get("verdict") in ("too_narrow","too_broad","wrong","not_found") or x.get("ok") is False)
        domains.append({
            "domain":      domain,
            "selector":    g.get("selector"),
            "votes":       g.get("votes", 0),
            "all_votes":   g.get("all_votes", {}),
            "sample_urls": g.get("sample_urls", []),
            "valid":       v.get("valid"),
            "ok_count":    ok_count,
            "fail_count":  fail_count,
            "validation":  validations,
        })
    domains.sort(key=lambda d: (-d["votes"], -d["ok_count"], d["domain"]))
    return domains


def load_labels():
    labels = {}
    if LABELS_FILE.exists():
        for line in LABELS_FILE.open():
            try:
                r = json.loads(line); labels[r["domain"]] = r["label"]
            except Exception: pass
    return labels


HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}
_cache: dict[str, bytes] = {}


def fetch_html(domain, url):
    if url in _cache:
        return _cache[url]
    if not url.startswith("http"):
        url = "https://" + url
    try:
        resp = http.get(url, timeout=10, headers=HEADERS, allow_redirects=True)
        html = resp.content
        _cache[url] = html
        return html
    except Exception as e:
        print(f"  [fetch] {url}: {e}")
        return None


def selector_matches(html_bytes, selector):
    """Return True if selector finds at least one element."""
    try:
        soup = BeautifulSoup(html_bytes, "html.parser")
        return bool(soup.select_one(selector))
    except Exception:
        return False


def inject_highlighter(html, selector, base_url):
    try:
        text = html.decode("utf-8", errors="replace")
    except Exception:
        return html

    # strip meta-refresh redirects
    text = re.sub(r'<meta[^>]+http-equiv=["\']?refresh["\']?[^>]*>', '', text, flags=re.I)

    base_tag = f'<base href="{base_url}" target="_blank">'
    if "<head" in text.lower():
        text = re.sub(r"(<head[^>]*>)", r"\1" + base_tag, text, count=1, flags=re.I)
    else:
        text = base_tag + text

    sel_esc = selector.replace("\\", "\\\\").replace("`", "\\`").replace("'", "\\'")
    script = f"""
<style>
@keyframes kf {{
  0%,100% {{ background-color:transparent; outline-color:rgba(200,30,30,0.5); }}
  50%      {{ background-color:rgba(220,30,30,0.15); outline-color:rgba(220,30,30,0.9); }}
}}
.ks-hi {{
  outline: 3px solid rgba(200,30,30,0.7);
  animation: kf 0.9s ease-in-out infinite;
  outline-offset: 2px;
}}
#ks-banner {{
  position:fixed;top:0;left:0;right:0;z-index:2147483647;
  background:#b00;color:#fff;font:bold 13px monospace;
  padding:7px 12px;text-align:center;pointer-events:none;
}}
</style>
<script>
(function(){{
  function run(){{
    try {{
      var el = document.querySelector('{sel_esc}');
      if(el){{
        el.classList.add('ks-hi');
        el.scrollIntoView({{behavior:'smooth',block:'center'}});
        window.parent && window.parent.postMessage({{ksMatch:true}},'*');
      }} else {{
        var b=document.createElement('div');
        b.id='ks-banner';
        b.textContent='SELECTOR MATCHED NOTHING: {sel_esc}';
        document.body.prepend(b);
        window.parent && window.parent.postMessage({{ksMatch:false}},'*');
      }}
    }} catch(e) {{ console.error(e); }}
  }}
  document.readyState==='loading'
    ? document.addEventListener('DOMContentLoaded',run)
    : run();
}})();
</script>"""

    if "</body>" in text.lower():
        text = re.sub(r"(</body>)", script + r"\1", text, count=1, flags=re.I)
    else:
        text += script
    return text.encode("utf-8")


# ── Flask ─────────────────────────────────────────────────────────────────────

app = Flask(__name__)


@app.route("/api/data")
def api_data():
    return jsonify(load_data())


@app.route("/api/labels")
def api_labels():
    return jsonify(load_labels())


@app.route("/api/check/<domain>")
def api_check(domain):
    """Check which sample URLs the selector matches. Returns per-url results."""
    gen = {}
    for line in (GEN_FILE.open() if GEN_FILE.exists() else []):
        try:
            r = json.loads(line)
            if r["domain"] == domain:
                gen = r; break
        except Exception: pass

    selector = gen.get("selector")
    urls     = gen.get("sample_urls", [])
    if not selector:
        return jsonify({"selector": None, "results": [], "all_failed": True})

    results = []
    for url in urls:
        html = fetch_html(domain, url)
        matched = selector_matches(html, selector) if html else False
        results.append({"url": url, "matched": matched, "has_html": html is not None})

    all_failed = all(not r["matched"] for r in results)
    return jsonify({"selector": selector, "results": results, "all_failed": all_failed})


@app.route("/api/label", methods=["POST"])
def api_label():
    body   = request.get_json()
    domain = body.get("domain")
    lbl    = body.get("label")
    url    = body.get("url")
    if not domain or not lbl:
        return jsonify({"error": "missing domain or label"}), 400
    record = {"domain": domain, "label": lbl, "url": url,
              "timestamp": datetime.now(timezone.utc).isoformat()}
    with LABELS_FILE.open("a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return jsonify({"ok": True})


@app.route("/page/<domain>")
def page(domain):
    url      = request.args.get("url")
    selector = request.args.get("selector", "")
    if not url: return "missing url", 400

    html = fetch_html(domain, url)
    if html is None:
        return f"<p style='font:14px monospace;padding:20px'>Not in local mirror: <b>{url}</b></p>", 404

    base_url = url if url.startswith("http") else f"https://{url}"
    if selector:
        html = inject_highlighter(html, selector, base_url)
    return Response(html, content_type="text/html; charset=utf-8")


HTML = r"""<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<title>Selector Review</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:system-ui,sans-serif; display:flex; height:100vh; overflow:hidden; background:#111; color:#eee; }

/* sidebar */
#sidebar { width:300px; min-width:200px; display:flex; flex-direction:column; border-right:1px solid #2a2a2a; background:#141414; }
#search  { padding:8px; background:#1c1c1c; border-bottom:1px solid #2a2a2a; }
#search input { width:100%; padding:6px 8px; background:#252525; border:1px solid #3a3a3a; border-radius:4px; color:#eee; font-size:12px; }
#domain-list { flex:1; overflow-y:auto; }
.di { padding:5px 8px; cursor:pointer; border-bottom:1px solid #1e1e1e; font-size:11px; display:grid; grid-template-columns:32px 10px 28px 28px 1fr; align-items:center; gap:5px; }
.di-num { font-size:10px; color:#444; text-align:right; font-variant-numeric:tabular-nums; }
.di:hover { background:#1e1e1e; }
.di.active { background:#1e2030; }
.badge { font-size:10px; padding:1px 4px; border-radius:3px; font-weight:bold; text-align:center; }
.b3{background:#1a4a1a;color:#7f7} .b2{background:#3a3a10;color:#dd0}
.b1{background:#3a2020;color:#f88} .b0{background:#2a2a2a;color:#666}
.dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; border:1px solid #444; justify-self:center; }
.vbadge { font-size:10px; padding:1px 4px; border-radius:3px; font-weight:bold; text-align:center; }
.vb-ok   { background:#1a3a1a; color:#7f7; }
.vb-part { background:#3a2a00; color:#fa0; }
.vb-fail { background:#3a1a1a; color:#f66; }
.vb-none { background:#2a2a2a; color:#555; }

/* main */
#main { flex:1; display:flex; flex-direction:column; overflow:hidden; }

#header { padding:10px 14px 8px; background:#181818; border-bottom:1px solid #2a2a2a; }
#hrow1  { display:flex; align-items:baseline; gap:10px; margin-bottom:5px; }
#domain-title { font-size:15px; font-weight:bold; color:#cdf; }
#domain-link  { font-size:11px; color:#68a; text-decoration:none; }
#domain-link:hover { color:#adf; }
#sel-box { font-size:11px; font-family:monospace; background:#0d1520; color:#7af; padding:3px 8px; border-radius:3px; display:inline-block; margin-bottom:4px; }
#votes-row { font-size:11px; color:#666; }
#check-status { font-size:11px; padding:2px 8px; border-radius:3px; margin-left:8px; }

/* url list */
#url-bar { display:flex; flex-direction:column; gap:4px; padding:6px 14px; background:#141414; border-bottom:1px solid #2a2a2a; max-height:160px; overflow-y:auto; }
.ub { font-size:11px; padding:3px 6px; background:transparent; border:none; border-left:2px solid #333; color:#9ab; cursor:pointer; text-align:left; display:flex; align-items:baseline; gap:8px; border-radius:0; }
.ub:hover { background:#1e1e1e; border-left-color:#55f; }
.ub.au  { border-left-color:#66f; background:#181828; color:#ccf; }
.ub.matched  { border-left-color:#3a3 !important; }
.ub.no-match { border-left-color:#833 !important; }
.ub-path { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:280px; flex-shrink:0; }
.ub-comment { font-size:11px; color:#aaa; white-space:normal; flex:1; line-height:1.4; }
.ub-comment.ok { color:#6d6; font-weight:bold; }
.ub-comment.fail { color:#fff; }

/* label bar */
#lbar { display:flex; align-items:center; gap:7px; padding:7px 14px; background:#141414; border-bottom:1px solid #2a2a2a; flex-wrap:wrap; }
#lbar span { font-size:11px; color:#666; }
.lb { padding:5px 11px; border-radius:4px; border:1px solid; cursor:pointer; font-size:11px; font-weight:bold; }
.lb:hover { filter:brightness(1.2); }
#cur-label { font-size:11px; padding:3px 9px; border-radius:3px; font-weight:bold; }
#btn-next { margin-left:auto; padding:5px 14px; border-radius:4px; background:#1e2040; border:1px solid #446; color:#aaf; font-size:12px; cursor:pointer; font-weight:bold; }
#btn-next:hover { background:#252555; }
#btn-next:disabled { opacity:0.3; cursor:not-allowed; }

/* preview */
#preview-wrap { flex:1; overflow:hidden; position:relative; }
iframe#pv { width:100%; height:100%; border:none; background:#fff; }
#no-pv { display:flex; align-items:center; justify-content:center; height:100%; color:#444; font-size:13px; }
#spinner { display:none; position:absolute; top:8px; right:12px; font-size:12px; color:#888; background:#111; padding:3px 8px; border-radius:3px; }
</style>
</head>
<body>
<div id="sidebar">
  <div id="search"><input id="si" placeholder="Search domain…" oninput="filter(this.value)"></div>
  <div id="domain-list"></div>
</div>
<div id="main">
  <div id="header">
    <div id="hrow1">
      <span id="domain-title">← select a domain</span>
      <a id="domain-link" href="#" target="_blank"></a>
    </div>
    <div id="sel-box" style="display:none"></div>
    <div id="votes-row"></div>
  </div>
  <div id="url-bar"></div>
  <div id="lbar">
    <span>Label:</span>
    <!-- injected by JS -->
    <div id="cur-label"></div>
    <button id="btn-next" disabled onclick="goNext()">Next ▶</button>
  </div>
  <div id="preview-wrap">
    <div id="no-pv">Select a domain to begin</div>
    <iframe id="pv" style="display:none" sandbox="allow-scripts allow-same-origin"></iframe>
    <div id="spinner">loading…</div>
  </div>
</div>

<script>
const LABELS = [
  {key:'correct',      text:'✅ Correct',                   bg:'#1a3a1a', border:'#3a3', color:'#7f7'},
  {key:'not_found',    text:'🔍 Selector not found',        bg:'#1a1a3a', border:'#44a', color:'#88f'},
  {key:'wrong_selector',text:'❌ Wrong selector',           bg:'#2a1a2a', border:'#a4a', color:'#faf'},
  {key:'too_broad',    text:'🔊 Too broad',                 bg:'#2a1a00', border:'#a60', color:'#fb0'},
  {key:'too_narrow',   text:'🔬 Too narrow',                bg:'#002020', border:'#196', color:'#4df'},
  {key:'not_article',  text:'📄 Not an article',            bg:'#2a2000', border:'#880', color:'#ff8'},
  {key:'wrong_domain', text:'🚫 Wrong domain',              bg:'#2a1a1a', border:'#844', color:'#faa'},
  {key:'broken',       text:'💀 Broken website',            bg:'#1a1a1a', border:'#555', color:'#999'},
];

let domains=[], labels={}, filtered=[], cur=null, curUrlIdx=0, checkResults={};

async function init() {
  const [dr, lr] = await Promise.all([fetch('/api/data'), fetch('/api/labels')]);
  domains = await dr.json();
  labels  = await lr.json();
  filtered = domains;

  // inject label buttons
  const lbar = document.getElementById('lbar');
  const nextBtn = document.getElementById('btn-next');
  LABELS.forEach(l => {
    const b = document.createElement('button');
    b.className = 'lb';
    b.textContent = l.text;
    b.style.background = l.bg;
    b.style.borderColor = l.border;
    b.style.color = l.color;
    b.onclick = () => applyLabel(l.key);
    lbar.insertBefore(b, document.getElementById('cur-label'));
  });

  // listen for iframe match messages
  window.addEventListener('message', e => {
    if (e.data && 'ksMatch' in e.data) {
      // iframe told us match result
    }
  });

  renderList();
}

function dotStyle(lbl) {
  const l = LABELS.find(x => x.key === lbl);
  return l ? `background:${l.border}` : 'background:transparent';
}

function valBadge(d) {
  const val = d.validation || [];
  const total = val.length;
  if (!total) return `<span class="vbadge vb-none">-</span>`;
  const ok = val.filter(v => v.verdict === 'ok' || v.ok === true).length;
  const cls = ok === total ? 'vb-ok' : ok === 0 ? 'vb-fail' : 'vb-part';
  return `<span class="vbadge ${cls}">${ok}/${total}</span>`;
}

function renderList() {
  document.getElementById('domain-list').innerHTML = filtered.map((d, i) => `
    <div class="di ${cur && d.domain===cur.domain?'active':''}" onclick="selectDomain('${d.domain}')">
      <span class="di-num">${i + 1}</span>
      <span class="dot" style="${dotStyle(labels[d.domain])}"></span>
      <span class="badge b${d.votes}">${d.votes}/3</span>
      ${valBadge(d)}
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.domain}</span>
    </div>`).join('');
}

function filter(q) {
  q = q.toLowerCase();
  filtered = q ? domains.filter(d => d.domain.includes(q)) : domains;
  renderList();
}

async function selectDomain(domain) {
  cur = domains.find(d => d.domain === domain);
  curUrlIdx = 0;
  checkResults = {};

  renderList();

  // header
  document.getElementById('domain-title').textContent = cur.domain;
  const link = document.getElementById('domain-link');
  link.href = `https://${cur.domain}`;
  link.textContent = `↗ ${cur.domain}`;
  const selBox = document.getElementById('sel-box');
  selBox.style.display = 'inline-block';
  selBox.textContent = cur.selector || '(no selector)';
  const votes = Object.entries(cur.all_votes||{}).map(([s,n])=>`${s}:${n}`).join(' | ');
  document.getElementById('votes-row').textContent = `votes ${cur.votes}/3  ${votes}`;

  updateLabelDisplay();
  renderUrlBar();

  // auto-load first url
  if (cur.sample_urls.length > 0) loadUrl(0);

  // background check all urls
  if (cur.selector) {
    fetch(`/api/check/${cur.domain}`)
      .then(r => r.json())
      .then(data => {
        data.results.forEach(r => { checkResults[r.url] = r.matched; });
        renderUrlBar();
        // auto-label if all failed
        if (data.all_failed && !labels[cur.domain]) {
          applyLabel('not_found');
        }
      });
  }
}

function renderUrlBar() {
  if (!cur) return;
  const val = cur.validation || [];
  const valMap = {};
  val.forEach(v => { if (v.url) valMap[v.url] = v; });

  document.getElementById('url-bar').innerHTML = cur.sample_urls.map((u, i) => {
    const v = valMap[u];
    const matched = checkResults[u];
    const matchCls = matched===true ? 'matched' : matched===false ? 'no-match' : '';
    const activeCls = i===curUrlIdx ? 'au' : '';
    const short = (new URL(u.startsWith('http')?u:'https://'+u).pathname || '/').slice(0,40);

    let comment = '', commentCls = '';
    if (v) {
      const verdict = v.verdict;
      if (verdict === 'ok') { comment = 'LLM: ok'; commentCls = 'ok'; }
      else if (verdict) { comment = `LLM: ${verdict}${v.issue ? ' — ' + v.issue : ''}`; commentCls = 'fail'; }
      else if (v.issue) { comment = v.issue; commentCls = 'fail'; }
    }

    return `<button class="ub ${activeCls} ${matchCls}" onclick="loadUrl(${i})">
      <span class="ub-path">${short}</span>
      <span class="ub-comment ${commentCls}">${comment}</span>
    </button>`;
  }).join('');
}

function nextItems(count) {
  // return up to `count` {domain, url, selector} after current position
  const items = [];
  let dIdx = filtered.findIndex(d => d.domain === cur.domain);
  let uIdx = curUrlIdx + 1;
  while (items.length < count) {
    const d = filtered[dIdx];
    if (!d) break;
    if (uIdx < d.sample_urls.length) {
      items.push({domain: d.domain, url: d.sample_urls[uIdx], selector: d.selector || ''});
      uIdx++;
    } else {
      dIdx++; uIdx = 0;
    }
  }
  return items;
}

function prefetchNext() {
  nextItems(3).forEach(({domain, url, selector}) => {
    const enc = encodeURIComponent(url);
    const sel = encodeURIComponent(selector);
    fetch(`/page/${domain}?url=${enc}&selector=${sel}`).catch(() => {});
  });
}

function loadUrl(idx) {
  if (!cur || idx >= cur.sample_urls.length) return;
  curUrlIdx = idx;
  renderUrlBar();
  updateLabelDisplay();
  const url = cur.sample_urls[idx];
  const enc = encodeURIComponent(url);
  const sel = encodeURIComponent(cur.selector || '');
  const iframe = document.getElementById('pv');
  const noPv   = document.getElementById('no-pv');
  document.getElementById('spinner').style.display = 'block';
  iframe.onload = () => { document.getElementById('spinner').style.display = 'none'; };
  iframe.src = `/page/${cur.domain}?url=${enc}&selector=${sel}`;
  iframe.style.display = 'block';
  noPv.style.display = 'none';
  prefetchNext();
}

async function applyLabel(key) {
  if (!cur) return;
  const url = cur.sample_urls[curUrlIdx] || null;
  await fetch('/api/label', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({domain: cur.domain, label: key, url})
  });
  labels[cur.domain] = key;
  updateLabelDisplay();
  renderList();
  // enable next button
  document.getElementById('btn-next').disabled = false;
}

function updateLabelDisplay() {
  const lbl = cur ? labels[cur.domain] : null;
  const el  = document.getElementById('cur-label');
  const nextBtn = document.getElementById('btn-next');
  if (lbl) {
    const l = LABELS.find(x => x.key === lbl);
    el.textContent = l ? l.text : lbl;
    el.style.background   = l ? l.bg    : '#333';
    el.style.color        = l ? l.color : '#eee';
    el.style.borderRadius = '3px';
    el.style.padding      = '3px 9px';
  } else {
    el.textContent = '';
    el.style.background = 'transparent';
  }
  // block only when on last URL and no label
  const onLastUrl = !cur || curUrlIdx + 1 >= (cur.sample_urls.length || 1);
  nextBtn.disabled = onLastUrl && !lbl;
}

function goNext() {
  if (!cur) return;
  // next url in same domain — always allowed
  if (curUrlIdx + 1 < cur.sample_urls.length) {
    loadUrl(curUrlIdx + 1);
    return;
  }
  // moving to next domain — require label
  if (!labels[cur.domain]) return;
  const idx = filtered.findIndex(d => d.domain === cur.domain);
  if (idx + 1 < filtered.length) {
    selectDomain(filtered[idx + 1].domain);
  }
}

init();
</script>
</body>
</html>"""


@app.route("/")
def index():
    return render_template_string(HTML)


if __name__ == "__main__":
    n = auto_label_from_validator()
    if n:
        print(f"Auto-labeled {n} domains as 'not_found' from validator")
    print(f"http://localhost:{PORT}")
    app.run(port=PORT, debug=False)
