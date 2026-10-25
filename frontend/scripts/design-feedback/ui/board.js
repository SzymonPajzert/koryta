// The design board's page. No build step and no framework: the server hands
// this file out as it is. State lives in `S`; `render()` draws the view the
// hash names. On the light table only the marks and the margin are redrawn as
// comments come and go, so the screenshots never reload under the pencil.
"use strict";

const KINDS = [
  { id: "fix", label: "Fix", help: "change this" },
  { id: "keep", label: "Keep", help: "the next round must not lose it" },
  { id: "question", label: "Ask", help: "a question for the agent" },
  { id: "rule", label: "Rule", help: "do it like this everywhere" },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label]));

const S = {
  rounds: null,
  detail: null,
  roundId: null,
  stamp: 0,
  zoom: "fit", // "fit" | 1 | 2
  side: true, // variants side by side, else one at a time
  active: 0, // the variant shown one at a time
  showResolved: false,
  draft: null, // { image, region, anchor, el, wider: [], kind, text, top }
  editing: null, // a comment id with an open reply or edit box
  lit: null,
  dom: new Map(), // image id -> census, "none" or "loading"
  sendNote: "",
  help: false,
  pending: false,
};

// ---------- small things ----------

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** replaceChildren, minus the nulls a conditional leaves (it would print them). */
const fill = (el, ...kids) =>
  el.replaceChildren(
    ...kids
      .flat(Infinity)
      .filter((k) => k !== null && k !== undefined && k !== false),
  );
const enc = encodeURIComponent;

function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 50) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString([], {
    day: "numeric",
    month: "short",
  });
}
const clock = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The claude.ai session behind an actor named after its workspace. */
function session(actor) {
  const m = /bridge-cse_([A-Za-z0-9]+)/.exec(actor || "");
  return m
    ? {
        url: `https://claude.ai/code/session_${m[1]}`,
        name: `session ${m[1].slice(0, 8)}…`,
      }
    : null;
}

function toast(text, bad) {
  document.querySelector(".toast")?.remove();
  const t = h(
    "div",
    { class: bad ? "toast bad" : "toast", role: "status" },
    text,
  );
  document.body.append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 2400);
}

async function api(path, body) {
  const res = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const fileUrl = (roundId, rel) =>
  `/api/rounds/${enc(roundId)}/files/${rel.split("/").map(enc).join("/")}`;

async function post(roundId, event) {
  try {
    const out = await api(`/api/rounds/${enc(roundId)}/events`, event);
    await refresh(true);
    return out;
  } catch (e) {
    toast(e.message, true);
    throw e;
  }
}

// ---------- data ----------

function route() {
  const m = /^#\/r\/([^/]+)(?:\/k\/(.+))?$/.exec(location.hash);
  if (!m) return { view: "list" };
  return {
    view: m[2] ? "table" : "sheet",
    round: decodeURIComponent(m[1]),
    key: m[2] ? decodeURIComponent(m[2]) : null,
  };
}

async function loadRounds() {
  S.rounds = (await api("/api/rounds")).rounds;
}

async function loadDetail(id) {
  if (S.roundId !== id) {
    S.dom.clear();
    S.draft = null;
    S.editing = null;
    S.active = 0;
  }
  S.detail = await api(`/api/rounds/${enc(id)}`);
  S.roundId = id;
}

const round = () => S.detail.round;

/** Keys in the order the agent published them. */
function keys() {
  const seen = [];
  for (const i of round().images) if (!seen.includes(i.key)) seen.push(i.key);
  return seen;
}

const imagesOf = (key) => {
  const order = round().variants;
  return round()
    .images.filter((i) => i.key === key)
    .sort((a, b) => order.indexOf(a.variant) - order.indexOf(b.variant));
};

/** Comments of this round, and the ones carried from rounds before it, on
 * one screenshot. */
function commentsOn(image) {
  const own = S.detail.state.comments.filter((c) => c.image === image.id);
  const carried = S.detail.carried.filter((c) => c.mapsTo === image.id);
  return [...own, ...carried].filter(
    (c) => S.showResolved || c.status !== "resolved",
  );
}

const isCarried = (c) => c.round !== S.roundId;

function lastSubmit() {
  const s = S.detail.state.submits;
  return s.length ? s[s.length - 1] : null;
}

/** What Szymon did since he last sent the round: what a send would carry. */
function sinceSent() {
  const sent = lastSubmit();
  const after = (at) => !sent || at > sent.at;
  const mine = (by) => !by.startsWith("agent");
  const all = [...S.detail.state.comments, ...S.detail.carried];
  let marks = 0;
  let replies = 0;
  let resolved = 0;
  for (const c of all) {
    if (!isCarried(c) && mine(c.by) && after(c.at)) marks++;
    replies += c.replies.filter((r) => mine(r.by) && after(r.at)).length;
    if (c.status === "resolved" && after(c.updatedAt)) resolved++;
  }
  const picks = Object.values(S.detail.state.picks).filter((p) =>
    after(p.at),
  ).length;
  const answers = Object.values(S.detail.state.answers).filter((a) =>
    after(a.at),
  ).length;
  return {
    marks,
    replies,
    resolved,
    picks,
    answers,
    any: marks + replies + resolved + picks + answers > 0,
  };
}

// ---------- the census: what was under each pixel ----------

function decodeCensus(c, image) {
  const els = c.els.map(
    ([x, y, w, hh, parent, tag, id, cls, text, label, testid], index) => ({
      index,
      x,
      y,
      w,
      h: hh,
      parent,
      tag,
      id,
      cls,
      text,
      label,
      testid,
    }),
  );
  return { origin: c.origin, dpr: c.dpr || image.dpr, els };
}

function loadCensus(image) {
  if (!image.dom || S.dom.has(image.id)) return;
  S.dom.set(image.id, "loading");
  api(fileUrl(S.roundId, image.dom))
    .then((c) => S.dom.set(image.id, decodeCensus(c, image)))
    .catch(() => S.dom.set(image.id, "none"))
    .then(() => {
      if (
        !S.draft &&
        !S.editing &&
        table?.plates.some((p) => p.image.id === image.id)
      )
        repaintTable();
    });
}

const censusOf = (image) => {
  const c = S.dom.get(image.id);
  return c && typeof c === "object" ? c : null;
};

/** The innermost element under a point of the image, ignoring slivers. */
function elementAt(census, image, pt) {
  const x = pt.x / census.dpr + census.origin.x;
  const y = pt.y / census.dpr + census.origin.y;
  let best = null;
  for (const e of census.els) {
    if (e.w < 4 || e.h < 4) continue;
    if (x < e.x || y < e.y || x > e.x + e.w || y > e.y + e.h) continue;
    if (!best || e.w * e.h <= best.w * best.h) best = e;
  }
  return best;
}

function boxOf(census, image, e) {
  const d = census.dpr;
  const x = clamp((e.x - census.origin.x) * d, 0, image.width);
  const y = clamp((e.y - census.origin.y) * d, 0, image.height);
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(clamp(e.w * d, 0, image.width - x)),
    h: Math.round(clamp(e.h * d, 0, image.height - y)),
  };
}

const telling = (cls) =>
  cls
    .split(" ")
    .filter((c) => c && !c.includes("--") && !c.startsWith("v-theme"))
    .slice(0, 3);

const selectorOf = (e) =>
  e.tag +
  (e.id ? `#${e.id}` : "") +
  telling(e.cls)
    .map((c) => `.${c}`)
    .join("");

function anchorOf(census, e) {
  const chain = [];
  for (
    let at = e;
    at && chain.length < 4;
    at = at.parent >= 0 ? census.els[at.parent] : null
  ) {
    chain.unshift(selectorOf(at));
  }
  return {
    path: chain.join(" > "),
    text: (e.text || e.label || "").slice(0, 80),
  };
}

// ---------- the rounds ----------

function statusOf(r) {
  if (r.children.length) return "done";
  if (r.lastSubmit && r.lastSubmit.verdict === "approve") return "done";
  if (!r.lastSubmit || r.lastSubmit.at < r.updatedAt) return "yours";
  return "agent";
}

function tallies(forAgent, forOwner) {
  return [
    forOwner
      ? h(
          "span",
          {
            class: "tally",
            title: "waiting on you: the agent replied or says it is done",
          },
          h("i", { style: { background: "var(--check)" } }),
          `${forOwner} to check`,
        )
      : null,
    forAgent
      ? h(
          "span",
          { class: "tally", title: "waiting on the agent" },
          h("i", { style: { background: "var(--pencil-fix)" } }),
          `${forAgent} open`,
        )
      : null,
  ];
}

function paintList() {
  const app = document.getElementById("app");
  document.getElementById("send").replaceChildren();
  const rounds = S.rounds || [];
  const groups = [
    ["Waiting for you", rounds.filter((r) => statusOf(r) === "yours")],
    ["With the agent", rounds.filter((r) => statusOf(r) === "agent")],
    [
      "Done, or followed by a newer round",
      rounds.filter((r) => statusOf(r) === "done"),
    ],
  ];
  const row = (r) => {
    const live = r.waiters.length > 0;
    const sent = r.lastSubmit;
    return h(
      "a",
      { class: "row", href: `#/r/${enc(r.id)}` },
      r.thumb
        ? h("img", {
            class: "thumb",
            src: fileUrl(r.id, r.thumb),
            alt: "",
            loading: "lazy",
          })
        : h("div", { class: "thumb" }),
      h(
        "div",
        { style: { minWidth: 0 } },
        h("div", { class: "name" }, r.title),
        h(
          "div",
          { class: "sub" },
          h("span", { class: "mono" }, r.id),
          h("span", null, `${r.images} screenshots`),
          h("span", { title: r.createdAt }, ago(r.createdAt)),
          r.children.length
            ? h("span", null, `followed by ${r.children.join(", ")}`)
            : null,
        ),
      ),
      h(
        "div",
        { class: "state" },
        tallies(r.forAgent, r.forOwner),
        sent
          ? h(
              "span",
              null,
              sent.verdict === "approve"
                ? `OK'd ${ago(sent.at)}`
                : `sent back ${ago(sent.at)}`,
            )
          : null,
        live
          ? h(
              "span",
              { class: "presence live" },
              h("span", { class: "dot" }),
              "agent waiting",
            )
          : null,
      ),
    );
  };
  app.replaceChildren(
    h(
      "div",
      { class: "top" },
      h(
        "div",
        { class: "crumb" },
        h("span", { class: "title" }, "Design board"),
      ),
    ),
    h(
      "div",
      { class: "ledger" },
      h("h1", null, "Design rounds"),
      h(
        "p",
        { class: "lede" },
        "Screenshots the agents put up for you. Open a round, draw a box or click an element on a screenshot, say what is wrong, then send it back.",
      ),
      rounds.length === 0
        ? h(
            "div",
            { class: "empty" },
            "No rounds yet. An agent publishes one with ",
            h(
              "code",
              null,
              "npm run -s design-feedback -- publish <dir> --round <id>",
            ),
            ".",
          )
        : groups
            .filter(([, list]) => list.length)
            .map(([title, list]) => [
              h("h2", null, title),
              h("div", { class: "rows" }, list.map(row)),
            ]),
    ),
  );
}

// ---------- the top bar of a round ----------

function topBar(extra) {
  const r = round();
  const chain = [...S.detail.ancestors].reverse();
  const live = S.detail.waiters;
  const who = session(live[0]?.actor || r.author.actor);
  return h(
    "div",
    { class: "top" },
    h(
      "div",
      { class: "crumb" },
      h("a", { href: "#/" }, "Rounds"),
      h("span", { class: "muted" }, "/"),
      h(
        "a",
        {
          href: `#/r/${enc(r.id)}`,
          class: "title",
          style: { color: "var(--graphite)" },
        },
        r.title,
      ),
    ),
    h(
      "nav",
      { class: "chain", "aria-label": "Rounds of this chain" },
      chain.map((a) =>
        h("a", { href: `#/r/${enc(a.id)}`, title: a.title }, a.id),
      ),
      h("span", { class: "here" }, r.id),
      S.detail.children.map((c) =>
        h(
          "a",
          { href: `#/r/${enc(c)}`, title: "the round after this one" },
          `${c} →`,
        ),
      ),
    ),
    extra || null,
    h("div", { class: "spacer" }),
    h(
      "span",
      { class: live.length ? "presence live" : "presence" },
      h("span", { class: "dot" }),
      live.length ? "Agent waiting" : "No agent waiting",
      who
        ? [
            " · ",
            h(
              "a",
              { href: who.url, target: "_blank", rel: "noreferrer" },
              who.name,
            ),
          ]
        : null,
    ),
  );
}

// ---------- the sheet ----------

function counts(image) {
  const out = { fix: 0, keep: 0, question: 0, rule: 0, carried: 0, check: 0 };
  for (const c of commentsOn(image)) {
    if (c.status === "resolved") continue;
    if (isCarried(c)) out.carried++;
    else if (c.status === "addressed") out.check++;
    else out[c.kind]++;
  }
  return out;
}

function badges(image) {
  const n = counts(image);
  const b = (cls, v, title) =>
    v ? h("span", { class: `badge ${cls}`, title }, v) : null;
  return h(
    "div",
    { class: "counts" },
    b("fix", n.fix, "to fix"),
    b("question", n.question, "questions"),
    b("rule", n.rule, "site-wide rules"),
    b("keep", n.keep, "keep"),
    b("check", n.check, "the agent says it is done"),
    b("carried", n.carried, "open from an earlier round"),
  );
}

function frame(image, label, sub = null) {
  const picked =
    S.detail.state.picks[image.key]?.variant === image.variant && image.variant;
  const variants = imagesOf(image.key);
  return h(
    "a",
    {
      class: picked ? "frame picked" : "frame",
      href: `#/r/${enc(S.roundId)}/k/${enc(image.key)}`,
      onclick: () => {
        S.active = Math.max(0, variants.indexOf(image));
      },
    },
    h(
      "div",
      // A page fills the frame from its top; anything shorter than the
      // frame's shape (a dialog, a section) shows whole on the mat.
      { class: image.height >= image.width * 1.25 ? "print" : "print whole" },
      image.thumb
        ? h("img", {
            src: fileUrl(S.roundId, image.thumb),
            alt: image.id,
            loading: "lazy",
          })
        : null,
      badges(image),
    ),
    h(
      "div",
      { class: "edge mono" },
      h("span", { class: "label", title: image.id }, label),
      picked ? h("span", { class: "pick" }, "picked") : null,
    ),
    sub ? h("div", { class: "sub mono" }, sub) : null,
  );
}

function questionCard(q) {
  const a = S.detail.state.answers[q.id];
  let option = a ? a.option : null;
  let text = a ? a.text : "";
  const save = () =>
    post(S.roundId, { type: "answer", question: q.id, option, text });
  return h(
    "div",
    { class: "question" },
    h("div", { class: "q" }, q.text),
    q.options.length
      ? h(
          "div",
          { class: "opts", role: "radiogroup" },
          q.options.map((o) =>
            h(
              "label",
              null,
              h("input", {
                type: "radio",
                name: q.id,
                checked: option === o,
                onchange: () => {
                  option = o;
                  save();
                },
              }),
              o,
            ),
          ),
        )
      : null,
    h("textarea", {
      class: "field",
      rows: 2,
      placeholder: q.options.length
        ? "Anything to add (optional)"
        : "Your answer",
      value: text,
      onchange: (e) => {
        text = e.target.value;
        save();
      },
    }),
  );
}

/** The agent's notes, folded to eight lines when they would push the
 * screenshots out of the first view. */
function foldedNotes(text) {
  const long = text.split("\n").length > 8 || text.length > 700;
  const notes = h("div", { class: long ? "notes folded" : "notes" }, text);
  if (!long) return notes;
  const toggle = h(
    "button",
    {
      class: "btn small quiet",
      style: { marginTop: "6px", paddingLeft: 0 },
      onclick: () => {
        const folded = notes.classList.toggle("folded");
        toggle.textContent = folded ? "Show all" : "Show less";
      },
    },
    "Show all",
  );
  return [notes, toggle];
}

function paintSheet() {
  const r = round();
  const app = document.getElementById("app");
  const groups = new Map();
  for (const key of keys()) {
    const g = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(key);
  }
  const last = (key) => key.slice(key.lastIndexOf("/") + 1);
  const general = S.detail.state.comments.filter(
    (c) => c.image === null && (S.showResolved || c.status !== "resolved"),
  );
  const carriedGeneral = S.detail.carried.filter(
    (c) => c.mapsTo === null && c.status !== "resolved",
  );
  const who = session(r.author.actor);

  app.replaceChildren(
    topBar(),
    h(
      "div",
      { class: "sheet" },
      h(
        "div",
        { class: "cover" },
        h(
          "div",
          { class: "note" },
          h("h1", null, r.title),
          h(
            "div",
            { class: "byline" },
            `${r.images.length} screenshots · ${ago(r.createdAt)}`,
            who
              ? [
                  " · ",
                  h(
                    "a",
                    { href: who.url, target: "_blank", rel: "noreferrer" },
                    who.name,
                  ),
                ]
              : null,
            r.author.change
              ? [" · ", h("span", { class: "mono" }, r.author.change)]
              : null,
          ),
          r.notes
            ? foldedNotes(r.notes)
            : h("div", { class: "notes muted" }, "No notes from the agent."),
        ),
        h(
          "div",
          { class: "side" },
          r.questions.map(questionCard),
          noteList([...general, ...carriedGeneral], null),
          S.draft && S.draft.image === null
            ? composer()
            : h(
                "button",
                {
                  class: "btn quiet",
                  onclick: () => openDraft(null, null, null, null),
                },
                "+ Note on the whole round",
              ),
        ),
      ),
      [...groups].map(([g, list]) =>
        h(
          "section",
          { class: "group" },
          g ? h("h2", null, g) : null,
          h(
            "div",
            { class: "frames" },
            list.map((key) => {
              const imgs = imagesOf(key);
              if (imgs.length === 1) {
                const only = imgs[0];
                return frame(only, last(key), only.variant);
              }
              return h(
                "div",
                { class: "strip" },
                h("div", { class: "key mono" }, last(key)),
                h(
                  "div",
                  { class: "frames" },
                  imgs.map((i) => frame(i, i.variant)),
                ),
              );
            }),
          ),
        ),
      ),
    ),
  );
  paintSend();
}

// ---------- the light table ----------

let table = null; // { key, plates: [{ image, canvas }], lane, top }

function visibleImages(key) {
  const imgs = imagesOf(key);
  if (S.side || imgs.length < 2) return imgs;
  return [imgs[clamp(S.active, 0, imgs.length - 1)]];
}

function plateWidth(image, n) {
  const css = image.width / image.dpr;
  if (S.zoom !== "fit") return css * S.zoom;
  const room = window.innerWidth - 340 - 48 - 24 * (n - 1) - 16;
  return Math.max(160, Math.min(css, room / n));
}

function paintTable(key) {
  const imgs = imagesOf(key);
  if (!imgs.length) {
    location.hash = `#/r/${enc(S.roundId)}`;
    return;
  }
  const all = keys();
  const at = all.indexOf(key);
  const shown = visibleImages(key);
  for (const i of shown) loadCensus(i);
  const picks = S.detail.state.picks;
  const go = (k) => (location.hash = `#/r/${enc(S.roundId)}/k/${enc(k)}`);

  const bar = h(
    "div",
    { class: "table-bar" },
    h(
      "a",
      {
        class: "btn small quiet",
        href: `#/r/${enc(S.roundId)}`,
        title: "Back to the sheet (Esc)",
      },
      "← Sheet",
    ),
    h("span", { class: "key", title: key }, key),
    imgs.length > 1
      ? [
          h(
            "div",
            { class: "seg", role: "group", "aria-label": "Variant" },
            imgs.map((i, n) =>
              h(
                "button",
                {
                  "aria-pressed": String(!S.side && n === S.active),
                  title: `Show ${i.variant} alone (${n + 1})`,
                  onclick: () => {
                    S.side = false;
                    S.active = n;
                    paintTable(key);
                  },
                },
                i.variant + (picks[key]?.variant === i.variant ? " ✓" : ""),
              ),
            ),
            h(
              "button",
              {
                "aria-pressed": String(S.side),
                title: "Side by side (v)",
                onclick: () => {
                  S.side = !S.side;
                  paintTable(key);
                },
              },
              "side by side",
            ),
          ),
        ]
      : null,
    h(
      "div",
      { class: "seg", role: "group", "aria-label": "Zoom" },
      [
        ["fit", "fit"],
        [1, "1:1"],
        [2, "2:1"],
      ].map(([z, label]) =>
        h(
          "button",
          {
            "aria-pressed": String(S.zoom === z),
            title: "Zoom (z)",
            onclick: () => {
              S.zoom = z;
              paintTable(key);
            },
          },
          label,
        ),
      ),
    ),
    h(
      "label",
      {
        class: "muted",
        style: {
          fontSize: "12px",
          display: "inline-flex",
          gap: "6px",
          alignItems: "center",
        },
      },
      h("input", {
        type: "checkbox",
        checked: S.showResolved,
        onchange: (e) => {
          S.showResolved = e.target.checked;
          repaintTable();
        },
      }),
      "resolved",
    ),
    h("div", { class: "spacer", style: { flex: 1 } }),
    h("span", { class: "pos" }, `${at + 1} / ${all.length}`),
    h(
      "button",
      {
        class: "btn small",
        disabled: at <= 0,
        title: "Previous (←)",
        onclick: () => go(all[at - 1]),
      },
      "‹",
    ),
    h(
      "button",
      {
        class: "btn small",
        disabled: at >= all.length - 1,
        title: "Next (→)",
        onclick: () => go(all[at + 1]),
      },
      "›",
    ),
    h(
      "button",
      {
        class: "btn small quiet",
        title: "Keys (?)",
        onclick: () => toggleHelp(),
      },
      "?",
    ),
  );

  const plates = shown.map((image) => {
    const canvas = h("div", {
      class: "canvas",
      style: {
        width: `${plateWidth(image, shown.length)}px`,
        aspectRatio: `${image.width} / ${image.height}`,
      },
    });
    canvas.append(
      h("img", {
        src: fileUrl(S.roundId, image.file),
        alt: image.id,
        draggable: "false",
      }),
    );
    attachPencil(canvas, image);
    const picked = picks[key]?.variant === image.variant;
    const head =
      imgs.length > 1
        ? h(
            "div",
            { class: "plate-head" },
            h(
              "span",
              {
                class: picked ? "variant picked" : "variant",
                title: image.variant,
              },
              image.variant,
            ),
            h(
              "button",
              {
                class: picked ? "btn small ok" : "btn small",
                title: picked ? "Take the pick back" : "Pick this variant (p)",
                onclick: () => pick(image),
              },
              picked ? "✓ Picked" : "Pick",
            ),
          )
        : h(
            "div",
            { class: "plate-head" },
            h(
              "span",
              { class: "mono muted" },
              `${image.width / image.dpr} px wide${image.dpr !== 1 ? ` · @${image.dpr}x` : ""}`,
            ),
            image.url
              ? h(
                  "a",
                  {
                    class: "mono muted",
                    href: image.url,
                    target: "_blank",
                    rel: "noreferrer",
                  },
                  "page ↗",
                )
              : null,
          );
    return {
      image,
      canvas,
      el: h(
        "div",
        {
          class: picked ? "plate is-picked" : "plate",
          // As wide as its screenshot: a long variant name must not widen it.
          style: { width: canvas.style.width },
        },
        head,
        canvas,
      ),
    };
  });

  const lane = h("div", { class: "lane" });
  const topNotes = h("div", { class: "top-notes" });
  const margin = h(
    "aside",
    { class: "margin", "aria-label": "Notes" },
    topNotes,
    lane,
  );
  const app = document.getElementById("app");
  app.replaceChildren(
    topBar(),
    bar,
    h(
      "div",
      { class: "stage" },
      h(
        "div",
        { class: "prints" },
        plates.map((p) => p.el),
      ),
      margin,
    ),
  );
  table = { key, plates, lane, topNotes };
  repaintTable();
  paintSend();
}

/** Marks and margin, from the data as it is now. */
function repaintTable() {
  if (!table) return;
  const { plates, lane, topNotes } = table;
  const numbered = [];
  for (const p of plates) {
    const list = commentsOn(p.image).sort(
      (a, b) =>
        (a.region ? a.region.y : -1) - (b.region ? b.region.y : -1) ||
        (a.region?.x || 0) - (b.region?.x || 0),
    );
    for (const c of list) numbered.push({ c, plate: p });
  }
  numbered.forEach((n, i) => (n.num = i + 1));

  for (const p of plates) {
    p.canvas.querySelectorAll(".mark:not(.band)").forEach((m) => m.remove());
    for (const n of numbered.filter((x) => x.plate === p && x.c.region))
      p.canvas.append(markFor(n.c, n.num, p.image));
    if (S.draft && S.draft.image === p.image.id && S.draft.region) {
      p.canvas.append(
        markFor(
          {
            id: "draft",
            kind: S.draft.kind,
            region: S.draft.region,
            status: "open",
          },
          "+",
          p.image,
          true,
        ),
      );
    }
  }

  // Notes on a whole screenshot sit above the lane, the rest at their marks.
  const whole = numbered.filter((n) => !n.c.region);
  fill(
    topNotes,
    ...whole.map((n) =>
      card(n.c, n.num, plates.length > 1 ? n.plate.image.variant : null),
    ),
    S.draft && S.draft.region === null && S.draft.image !== null
      ? composer()
      : null,
    S.draft
      ? null
      : h(
          "div",
          { class: "hint" },
          h("div", null, "Drag a box, or click an element", censusHint(plates)),
          h(
            "button",
            {
              class: "btn small quiet",
              onclick: () => openDraft(plates[0].image, null, null, null),
            },
            "+ Note on the whole screenshot",
          ),
        ),
  );

  const placed = numbered
    .filter((n) => n.c.region)
    .map((n) => ({
      el: card(n.c, n.num, plates.length > 1 ? n.plate.image.variant : null),
      plate: n.plate,
      region: n.c.region,
    }));
  if (S.draft && S.draft.region) {
    const plate = plates.find((p) => p.image.id === S.draft.image);
    if (plate)
      placed.push({
        el: composer(),
        plate,
        region: S.draft.region,
        draft: true,
      });
  }
  fill(
    lane,
    placed.map((p) => p.el),
  );
  layoutLane(placed);
}

function censusHint(plates) {
  const states = plates.map((p) =>
    p.image.dom ? S.dom.get(p.image.id) : "none",
  );
  if (states.every((s) => s === "none"))
    return " (no DOM map for this screenshot, so a click drops a point)";
  if (states.some((s) => s === "loading")) return "";
  return "; Alt-click drops a point";
}

/** Each note at the height of its mark, pushed down where they would overlap. */
function layoutLane(placed) {
  const lane = table.lane;
  const laneTop = lane.getBoundingClientRect().top;
  const items = placed.map((p) => {
    const rect = p.plate.canvas.getBoundingClientRect();
    const scale = rect.height / p.plate.image.height;
    return { ...p, want: rect.top - laneTop + p.region.y * scale - 10 };
  });
  items.sort((a, b) => a.want - b.want);
  let bottom = 0;
  for (const it of items) {
    const top = Math.max(it.want, bottom);
    it.el.style.top = `${top}px`;
    bottom = top + it.el.offsetHeight + 8;
  }
  lane.style.height = `${bottom}px`;
}

function markFor(c, num, image, draft) {
  const r = c.region;
  const point = r.w === 0 && r.h === 0;
  const cls = [
    "mark",
    `pen-${c.kind}`,
    point ? "point" : null,
    draft ? "draft" : null,
    !draft && isCarried(c) ? "carried" : null,
    c.status === "addressed" ? "addressed" : null,
    c.status === "resolved" ? "resolved" : null,
    S.lit === c.id ? "lit" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const style = {
    left: `${(r.x / image.width) * 100}%`,
    top: `${(r.y / image.height) * 100}%`,
  };
  if (!point) {
    style.width = `${(r.w / image.width) * 100}%`;
    style.height = `${(r.h / image.height) * 100}%`;
  }
  const m = h("div", { class: cls, style, "data-id": c.id });
  if (!draft) {
    m.append(
      h(
        "button",
        {
          class: "tag",
          title: c.text,
          "aria-label": `Note ${num}: ${c.text}`,
          onpointerenter: () => light(c.id),
          onpointerleave: () => light(null),
          onclick: (e) => {
            e.stopPropagation();
            const el = document.querySelector(`.card[data-id="${c.id}"]`);
            el?.scrollIntoView({ block: "center", behavior: "smooth" });
            flash(c.id);
          },
        },
        num,
      ),
    );
  }
  return m;
}

let flashing = null;
let flashTimer = 0;

/** Light a note and its mark for a moment after a click on either number: the
 * page scrolls to the other one, and the pointer leaving the first must not
 * put the light out before the eye gets there. */
function flash(id) {
  flashing = id;
  light(id);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashing = null;
    if (S.lit === id) light(null);
  }, 1600);
}

function light(id) {
  if (id === null && flashing) id = flashing;
  S.lit = id;
  document
    .querySelectorAll(".mark.lit, .card.lit")
    .forEach((e) => e.classList.remove("lit"));
  if (!id) return;
  document
    .querySelectorAll(`[data-id="${id}"]`)
    .forEach((e) => e.classList.add("lit"));
}

// ---------- the pencil ----------

function attachPencil(canvas, image) {
  const toImage = (ev) => {
    const r = canvas.getBoundingClientRect();
    const s = image.width / r.width;
    return {
      x: clamp((ev.clientX - r.left) * s, 0, image.width),
      y: clamp((ev.clientY - r.top) * s, 0, image.height),
    };
  };
  const scale = () => canvas.getBoundingClientRect().width / image.width;
  let guide = null;
  let frame = 0;
  const hideGuide = () => {
    guide?.remove();
    guide = null;
  };

  canvas.addEventListener("pointermove", (ev) => {
    if (ev.buttons || ev.altKey) return hideGuide();
    const census = censusOf(image);
    if (!census) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const el = elementAt(census, image, toImage(ev));
      if (!el) return hideGuide();
      const b = boxOf(census, image, el);
      if (!guide) {
        guide = h("div", { class: "guide" }, h("span", { class: "what" }));
        canvas.append(guide);
      }
      Object.assign(guide.style, {
        left: `${(b.x / image.width) * 100}%`,
        top: `${(b.y / image.height) * 100}%`,
        width: `${(b.w / image.width) * 100}%`,
        height: `${(b.h / image.height) * 100}%`,
      });
      guide.classList.toggle("below", b.y * scale() < 22);
      const said = el.text || el.label;
      guide.firstChild.textContent =
        selectorOf(el) + (said ? ` "${said.slice(0, 40)}"` : "");
    });
  });
  canvas.addEventListener("pointerleave", hideGuide);

  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || ev.target.closest(".tag")) return;
    ev.preventDefault();
    if (S.draft && S.draft.text.trim()) {
      document.querySelector(".composer textarea")?.focus();
      toast("Save or cancel the open note first");
      return;
    }
    const start = toImage(ev);
    let band = null;
    const box = (p) => {
      const x = Math.min(start.x, p.x);
      const y = Math.min(start.y, p.y);
      return {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(Math.abs(p.x - start.x)),
        h: Math.round(Math.abs(p.y - start.y)),
      };
    };
    const move = (e) => {
      const p = toImage(e);
      if (!band && Math.hypot(p.x - start.x, p.y - start.y) * scale() < 5)
        return;
      if (!band) {
        hideGuide();
        band = h("div", { class: "mark band draft pen-fix" });
        canvas.append(band);
      }
      const b = box(p);
      Object.assign(band.style, {
        left: `${(b.x / image.width) * 100}%`,
        top: `${(b.y / image.height) * 100}%`,
        width: `${(b.w / image.width) * 100}%`,
        height: `${(b.h / image.height) * 100}%`,
      });
    };
    const up = (e) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (band) {
        band.remove();
        const b = box(toImage(e));
        if (b.w * scale() >= 4 && b.h * scale() >= 4)
          openDraft(image, b, null, null);
        return;
      }
      const census = censusOf(image);
      if (census && !e.altKey) {
        const el = elementAt(census, image, start);
        if (el) {
          openDraft(image, boxOf(census, image, el), anchorOf(census, el), el);
          return;
        }
      }
      openDraft(
        image,
        { x: Math.round(start.x), y: Math.round(start.y), w: 0, h: 0 },
        null,
        null,
      );
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

function openDraft(image, region, anchor, el) {
  S.draft = {
    image: image ? image.id : null,
    region,
    anchor,
    el,
    wider: [],
    kind: S.draft ? S.draft.kind : "fix",
    text: "",
  };
  rerender();
  focusComposer();
}

/** Into the open note, the caret after what is typed. Synchronous: the note
 * is in the page by now, and a frame later the first keys typed would go to
 * the page's shortcuts instead. */
function focusComposer() {
  const ta = document.querySelector(".composer textarea");
  if (!ta) return;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function closeDraft() {
  S.draft = null;
  rerender();
  if (S.pending) refresh(true);
}

function stopEditing() {
  S.editing = null;
  rerender();
  if (S.pending) refresh(true);
}

/** Snap the open note to the element around the one it is on, or back. */
function widen(dir) {
  const d = S.draft;
  const image = round().images.find((i) => i.id === d.image);
  const census = image && censusOf(image);
  if (!census || !d.el) return;
  let next = null;
  if (dir > 0 && d.el.parent >= 0) {
    d.wider.push(d.el);
    next = census.els[d.el.parent];
  } else if (dir < 0 && d.wider.length) {
    next = d.wider.pop();
  }
  if (!next) return;
  d.el = next;
  d.region = boxOf(census, image, next);
  d.anchor = anchorOf(census, next);
  rerender();
  focusComposer();
}

async function saveDraft() {
  const d = S.draft;
  if (!d || !d.text.trim()) return;
  S.draft = null;
  try {
    await post(S.roundId, {
      type: "comment",
      image: d.image,
      region: d.region,
      anchor: d.anchor,
      kind: d.kind,
      text: d.text.trim(),
    });
  } catch {
    // The toast said why; the note opens again with its text.
    S.draft = d;
    rerender();
    focusComposer();
  }
}

function kindPicker(current, onPick, name) {
  return h(
    "div",
    { class: "kinds", role: "radiogroup", "aria-label": "Kind" },
    KINDS.map((k, i) =>
      h(
        "label",
        { class: `pen-${k.id}`, title: `${k.help} (Ctrl+${i + 1})` },
        h("input", {
          type: "radio",
          name,
          value: k.id,
          checked: current === k.id,
          onchange: () => onPick(k.id),
        }),
        k.label,
      ),
    ),
  );
}

function composer() {
  const d = S.draft;
  const ta = h("textarea", {
    placeholder:
      d.image === null
        ? "A note on the whole round"
        : d.region
          ? "What is wrong here?"
          : "A note on the whole screenshot",
    value: d.text,
    oninput: (e) => {
      d.text = e.target.value;
    },
    onkeydown: (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        saveDraft();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeDraft();
      } else if ((e.ctrlKey || e.metaKey) && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        d.kind = KINDS[Number(e.key) - 1].id;
        rerender();
        focusComposer();
      }
    },
  });
  return h(
    "div",
    { class: `card composer pen-${d.kind}` },
    kindPicker(
      d.kind,
      (k) => {
        d.kind = k;
        rerender();
        focusComposer();
      },
      "draft-kind",
    ),
    ta,
    d.anchor
      ? h(
          "div",
          { class: "anchor mono", title: d.anchor.path },
          d.anchor.path.split(" > ").pop(),
          d.anchor.text ? ` "${d.anchor.text}"` : "",
        )
      : null,
    h(
      "div",
      { class: "row-end" },
      d.el
        ? h(
            "span",
            { class: "grow" },
            h(
              "button",
              {
                class: "btn small quiet",
                title: "The element around this one",
                onclick: () => widen(1),
              },
              "wider",
            ),
            d.wider.length
              ? h(
                  "button",
                  { class: "btn small quiet", onclick: () => widen(-1) },
                  "narrower",
                )
              : null,
          )
        : h(
            "span",
            { class: "grow mono muted" },
            d.region && d.region.w === 0 ? "point" : "",
          ),
      h("button", { class: "btn small quiet", onclick: closeDraft }, "Cancel"),
      h("button", { class: "btn small primary", onclick: saveDraft }, "Save ⏎"),
    ),
  );
}

// ---------- a note ----------

const speaker = (by) => (by.startsWith("agent") ? "Agent" : "You");

function replyLine(r) {
  const agent = r.by.startsWith("agent");
  return h(
    "div",
    { class: agent ? "reply agent" : "reply" },
    h(
      "div",
      { class: "who" },
      speaker(r.by),
      r.status
        ? h(
            "span",
            { class: r.status === "declined" ? "status declined" : "status" },
            `${r.status}${r.round ? ` in ${r.round}` : ""}`,
          )
        : null,
      h("span", { class: "when", title: r.at }, ago(r.at)),
    ),
    h("div", { class: "body" }, r.text),
  );
}

function inlineBox(placeholder, onSend, label) {
  const ta = h("textarea", {
    class: "field",
    rows: 2,
    placeholder,
    onkeydown: (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (ta.value.trim()) onSend(ta.value.trim());
      } else if (e.key === "Escape") {
        stopEditing();
      }
    },
  });
  requestAnimationFrame(() => ta.focus());
  return h(
    "div",
    { style: { marginTop: "8px", display: "grid", gap: "6px" } },
    ta,
    h(
      "div",
      { class: "actions", style: { justifyContent: "flex-end", marginTop: 0 } },
      h("button", { class: "btn small quiet", onclick: stopEditing }, "Cancel"),
      h(
        "button",
        {
          class: "btn small primary",
          onclick: () => ta.value.trim() && onSend(ta.value.trim()),
        },
        label,
      ),
    ),
  );
}

function card(c, num, variant) {
  const home = c.round;
  const carried = isCarried(c);
  const editing = S.editing && S.editing.id === c.id ? S.editing.mode : null;
  const done = async (fn) => {
    S.editing = null;
    await fn();
  };
  const cls = [
    "card",
    `pen-${c.kind}`,
    carried ? "carried" : null,
    c.status === "addressed" ? "addressed" : null,
    c.status === "resolved" ? "resolved" : null,
    S.lit === c.id ? "lit" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const mine = !c.by.startsWith("agent");
  const tool = (glyph, label, onclick) =>
    h(
      "button",
      { class: "tool", title: label, "aria-label": label, onclick },
      glyph,
    );
  const tools = [];
  if (c.status === "resolved") {
    tools.push(
      tool("↺", "Reopen", () =>
        post(home, { type: "reopen", to: c.id, text: "" }),
      ),
    );
  } else if (c.status !== "addressed") {
    tools.push(
      tool(
        "↩",
        "Reply",
        () => ((S.editing = { id: c.id, mode: "reply" }), rerender()),
      ),
    );
    tools.push(
      tool("✓", "Resolve", () => post(home, { type: "resolve", to: c.id })),
    );
  }
  if (mine && !carried && c.status !== "resolved") {
    tools.push(
      tool(
        "✎",
        "Edit",
        () => ((S.editing = { id: c.id, mode: "edit" }), rerender()),
      ),
    );
    tools.push(
      tool("✕", "Delete", () => {
        if (confirm("Delete this note?"))
          post(home, { type: "delete", id: c.id });
      }),
    );
  }
  let body;
  if (editing === "edit") {
    let kind = c.kind;
    const ta = h("textarea", { class: "field", rows: 3, value: c.text });
    requestAnimationFrame(() => ta.focus());
    body = h(
      "div",
      { style: { display: "grid", gap: "6px" } },
      kindPicker(kind, (k) => (kind = k), `edit-${c.id}`),
      ta,
      h(
        "div",
        {
          class: "actions",
          style: { justifyContent: "flex-end", marginTop: 0 },
        },
        h(
          "button",
          { class: "btn small quiet", onclick: stopEditing },
          "Cancel",
        ),
        h(
          "button",
          {
            class: "btn small primary",
            onclick: () =>
              ta.value.trim() &&
              done(() =>
                post(home, {
                  type: "edit",
                  id: c.id,
                  text: ta.value.trim(),
                  kind,
                }),
              ),
          },
          "Save",
        ),
      ),
    );
  } else {
    body = h("div", { class: "text" }, c.text);
  }

  const lastAgent = [...c.replies]
    .reverse()
    .find((r) => r.by.startsWith("agent"));
  return h(
    "div",
    {
      class: cls,
      "data-id": c.id,
      onpointerenter: () => light(c.id),
      onpointerleave: () => light(null),
    },
    h(
      "div",
      { class: "head" },
      h(
        "button",
        {
          class: "num",
          title: c.region ? "Show its mark" : null,
          "aria-label": `Note ${num}`,
          onclick: () => {
            const mark = document.querySelector(`.mark[data-id="${c.id}"]`);
            mark?.scrollIntoView({ block: "center", behavior: "smooth" });
            flash(c.id);
          },
        },
        num,
      ),
      h("span", { class: "kind" }, KIND_LABEL[c.kind]),
      variant ? h("span", { class: "mono muted" }, variant) : null,
      carried
        ? h(
            "span",
            { class: "from", title: "made in an earlier round" },
            `from ${home}`,
          )
        : null,
      h("span", { class: "meta", title: c.at }, ago(c.at)),
      editing ? null : h("span", { class: "tools" }, tools),
    ),
    body,
    c.anchor && editing !== "edit"
      ? h(
          "div",
          { class: "anchor mono", title: c.anchor.path },
          c.anchor.path.split(" > ").pop(),
          c.anchor.text ? ` "${c.anchor.text}"` : "",
        )
      : null,
    c.replies.length
      ? h("div", { class: "thread" }, c.replies.map(replyLine))
      : null,
    c.status === "addressed" && editing !== "reopen"
      ? h(
          "div",
          { class: "ask-check" },
          `The agent says this is done${lastAgent && lastAgent.round ? ` in ${lastAgent.round}` : ""}. Is it?`,
          h(
            "div",
            { class: "actions" },
            h(
              "button",
              {
                class: "btn small ok",
                onclick: () => post(home, { type: "resolve", to: c.id }),
              },
              "✓ Yes, resolve",
            ),
            h(
              "button",
              {
                class: "btn small",
                onclick: () => (
                  (S.editing = { id: c.id, mode: "reopen" }),
                  rerender()
                ),
              },
              "Not yet",
            ),
          ),
        )
      : null,
    editing === "reply"
      ? inlineBox(
          "Reply",
          (t) => done(() => post(home, { type: "reply", to: c.id, text: t })),
          "Reply ⏎",
        )
      : null,
    editing === "reopen"
      ? inlineBox(
          "What is still wrong?",
          (t) => done(() => post(home, { type: "reopen", to: c.id, text: t })),
          "Reopen ⏎",
        )
      : null,
  );
}

function noteList(list) {
  if (!list.length) return null;
  return h(
    "div",
    { style: { display: "grid", gap: "8px" } },
    list.map((c, i) => card(c, i + 1, null)),
  );
}

async function pick(image) {
  const picked = S.detail.state.picks[image.key]?.variant === image.variant;
  await post(S.roundId, {
    type: "pick",
    key: image.key,
    variant: picked ? null : image.variant,
  });
}

// ---------- send ----------

function paintSend() {
  const box = document.getElementById("send");
  if (!S.detail || route().view === "list") {
    box.replaceChildren();
    return;
  }
  const r = round();
  const sent = lastSubmit();
  const n = sinceSent();
  const live = S.detail.waiters.length > 0;
  const ack = S.detail.state.lastAck;
  const parts = [
    n.marks
      ? [h("b", null, n.marks), n.marks === 1 ? " note" : " notes"]
      : null,
    n.replies
      ? [h("b", null, n.replies), n.replies === 1 ? " reply" : " replies"]
      : null,
    n.resolved ? [h("b", null, n.resolved), " resolved"] : null,
    n.picks
      ? [h("b", null, n.picks), n.picks === 1 ? " pick" : " picks"]
      : null,
    n.answers
      ? [h("b", null, n.answers), n.answers === 1 ? " answer" : " answers"]
      : null,
  ].filter(Boolean);
  const what = parts.length
    ? [
        parts.map((p, i) => [i ? ", " : "", p]),
        sent ? " since you sent it" : "",
      ]
    : sent
      ? `${sent.verdict === "approve" ? "OK'd" : "Sent back"} at ${clock(sent.at)}`
      : "Nothing marked yet";
  const read =
    sent && !n.any
      ? ack && ack >= sent.at
        ? h("span", { class: "after" }, `· the agent read it at ${clock(ack)}`)
        : live
          ? h("span", { class: "after" }, "· the agent is reading it")
          : h(
              "span",
              { class: "after" },
              "· nobody has read it yet: ",
              h("code", null, `npm run -s design-feedback -- read ${r.id}`),
            )
      : null;
  const note = h("textarea", {
    class: "field",
    rows: 1,
    placeholder: "A note for the agent with it (optional)",
    value: S.sendNote,
    oninput: (e) => (S.sendNote = e.target.value),
  });
  const submit = async (verdict) => {
    if (S.draft && S.draft.text.trim()) {
      toast("Save or cancel the open note first");
      return;
    }
    await post(S.roundId, { type: "submit", verdict, text: S.sendNote.trim() });
    S.sendNote = "";
    toast(
      verdict === "approve"
        ? "OK'd. The agent finishes what is still marked, then goes on to the tests."
        : live
          ? "Sent back. The waiting agent has it."
          : "Sent back. No agent is waiting: paste the read command into its session.",
    );
    paintSend();
  };
  box.replaceChildren(
    h(
      "div",
      { class: "send" },
      h("span", { class: "what" }, what),
      read,
      S.detail.children.length
        ? h(
            "a",
            { class: "after", href: `#/r/${enc(S.detail.children[0])}` },
            `followed by ${S.detail.children[0]} →`,
          )
        : null,
      h("div", { style: { flex: 1 } }),
      note,
      h(
        "button",
        {
          class: "btn ok",
          title:
            "Approve: the agent fixes what is still marked without another round, then goes on to tests and commits",
          onclick: () => submit("approve"),
        },
        "OK as corrected",
      ),
      h(
        "button",
        {
          class: "btn primary",
          title:
            "Another round: the agent works through your notes and publishes the next one",
          onclick: () => submit("iterate"),
        },
        "Send back",
      ),
    ),
  );
}

// ---------- keys ----------

function toggleHelp() {
  S.help = !S.help;
  document.querySelector(".keys")?.remove();
  if (!S.help) return;
  const k = (keys, what) => [
    h(
      "span",
      null,
      keys.map((x) => h("kbd", null, x)),
    ),
    h("span", null, what),
  ];
  document.body.append(
    h(
      "div",
      { class: "keys", onclick: toggleHelp },
      k(["drag"], "a box"),
      k(["click"], "the element under the pointer"),
      k(["alt", "click"], "a point"),
      k(["⏎"], "save the note · ⇧⏎ new line"),
      k(["ctrl", "1-4"], "fix · keep · ask · rule"),
      k(["←", "→"], "previous · next screenshot"),
      k(["1-9"], "one variant · v side by side"),
      k(["p"], "pick the variant shown"),
      k(["z"], "zoom: fit · 1:1 · 2:1"),
      k(["n"], "note on the whole screenshot"),
      k(["esc"], "close · back to the sheet"),
    ),
  );
}

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea")) return;
  const r = route();
  if (S.draft || S.editing) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (S.draft) closeDraft();
      else stopEditing();
    }
    return;
  }
  if (e.key === "?") return toggleHelp();
  if (r.view !== "table" || e.metaKey || e.ctrlKey) {
    if (e.key === "Escape" && r.view === "sheet") location.hash = "#/";
    return;
  }
  const all = keys();
  const at = all.indexOf(r.key);
  const imgs = imagesOf(r.key);
  const go = (k) => k && (location.hash = `#/r/${enc(S.roundId)}/k/${enc(k)}`);
  if (e.key === "Escape") {
    if (S.help) toggleHelp();
    else location.hash = `#/r/${enc(S.roundId)}`;
  } else if (e.key === "ArrowRight") go(all[at + 1]);
  else if (e.key === "ArrowLeft") go(all[at - 1]);
  else if (e.key === "v" && imgs.length > 1) {
    S.side = !S.side;
    paintTable(r.key);
  } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= imgs.length) {
    S.side = false;
    S.active = Number(e.key) - 1;
    paintTable(r.key);
  } else if (e.key === "z") {
    S.zoom = S.zoom === "fit" ? 1 : S.zoom === 1 ? 2 : "fit";
    paintTable(r.key);
  } else if (e.key === "p" && imgs.length > 1 && !S.side) {
    pick(imgs[S.active]);
  } else if (e.key === "n") {
    openDraft(visibleImages(r.key)[0], null, null, null);
  } else return;
  e.preventDefault();
});

// ---------- drawing it all ----------

function rerender() {
  const r = route();
  if (r.view === "table" && table && table.key === r.key) {
    repaintTable();
    paintSend();
  } else if (r.view === "sheet") paintSheet();
  else if (r.view === "table") paintTable(r.key);
}

async function render() {
  const r = route();
  try {
    if (r.view === "list") {
      table = null;
      await loadRounds();
      paintList();
      return;
    }
    if (S.roundId !== r.round || !S.detail) await loadDetail(r.round);
    if (r.view === "sheet") {
      table = null;
      paintSheet();
    } else paintTable(r.key);
  } catch (e) {
    document
      .getElementById("app")
      .replaceChildren(
        h(
          "div",
          { class: "ledger" },
          h("h1", null, "Could not open this"),
          h("p", { class: "lede" }, e.message),
          h("a", { href: "#/" }, "All rounds"),
        ),
      );
  }
}

/** New data from the store. An open note or reply box is never redrawn
 * under the hand that is typing in it; the refresh waits for it to close. */
async function refresh(force) {
  const r = route();
  if (!force && (S.draft || S.editing)) {
    S.pending = true;
    return;
  }
  S.pending = false;
  if (r.view === "list") {
    await loadRounds();
    paintList();
    return;
  }
  await loadDetail(r.round);
  rerender();
}

setInterval(async () => {
  try {
    const { stamp } = await api("/api/stamp");
    if (stamp !== S.stamp) {
      const first = S.stamp === 0;
      S.stamp = stamp;
      if (!first) await refresh(false);
    }
  } catch {
    // The board is restarting, or the tunnel dropped; the next tick retries.
  }
}, 3000);

window.addEventListener("hashchange", () => {
  S.draft = null;
  S.editing = null;
  render();
});
window.addEventListener("resize", () => {
  const r = route();
  if (r.view === "table" && S.zoom === "fit") paintTable(r.key);
});

render();
