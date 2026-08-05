"""ArticleFactsVerified — LLM-as-judge verification of extracted facts.

Takes the ArticleExtractedFacts output and, for every fact, asks the configured
LLM to judge it against the labeling rulebook (embedded as _RULES below). Each
fact keeps all its original fields and gains a binary decision plus context:

    "verified":            true | false        # true iff verdict == "correct"
    "verification_verdict": correct|incorrect|insufficient|unknown
    "verification_reason":  short judge rationale

The file is rewritten with every fact annotated (nothing dropped) — downstream
(ArticleAnalyzed) keeps only the verified ones. Judging is per-fact, cached by
(article_content_hash, verify_model, VERIFY_VERSION), so re-runs are cheap.
"""

import asyncio
import json
import re
from pathlib import Path
from typing import Any

import pandas as pd
from tqdm import tqdm

from entities.article import ArticleFactsVerified as ArticleFactsVerifiedRecord
from scrapers.article.pipelines.facts_pipeline import ArticleExtractedFacts
from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.article.pipelines.pipeline_utils import llm_model
from scrapers.stores import LLM, VERSIONED_DIR, Context, LLMRequest

VERIFY_VERSION = 8
MAX_TOKENS = 4000
TEMPERATURE = 0.0

_INPUT_FILE = Path(VERSIONED_DIR) / "article_facts" / "article_facts.jsonl"
_FINAL_OUTPUT_FILE = (
    Path(VERSIONED_DIR) / "article_facts_verified" / "article_facts_verified.jsonl"
)
_TEMP_OUTPUT_FILE = _FINAL_OUTPUT_FILE.with_suffix(".jsonl.tmp")

_THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", flags=re.DOTALL)
_JSON_LABEL_RE = re.compile(r"\{[^{}]*\"label\"[^{}]*\}", flags=re.DOTALL)
_JSON_ANY_RE = re.compile(r"\{.*\}", flags=re.DOTALL)

# The labeling rulebook is embedded here so the pipeline is self-contained (no
# external file dependency). Keep it in sync with any labeling-policy changes.
_RULES = """\
# Facts Extraction — Labeling Rulebook (v8)

Rules for labeling extracted facts (employment / party_membership /
personal_relation / affair_involvement) as **correct / incorrect /
insufficient**, and — by extension — the contract the extractor's output must
satisfy.

## 0. Principle

Judge each fact **only against its `justification` span** (the quote the
extractor provided). Never use world knowledge or the rest of the article.
The question is always: *does this exact span cleanly support this exact fact?*

When several rules fire, precedence is **incorrect > insufficient > correct**
(a definite defect wins; uncertainty beats a pass).

## 1. Language

- **Descriptive** fields — `role`, and an `organization`/`party` given as a
  common-noun description — must be in **Polish**; do not translate them.
  e.g. `governor` instead of `wojewoda`, or `Chamber of Deputies` instead of
  `Izba Poselska` → **incorrect**.
- **Proper names are ALWAYS fine, in any language** — do not treat them as a
  language violation:
  - a person's real name: `David Rath`, `Eva Kaili`, `Petr Kott`,
    `Jean-Claude Juncker`, `Michel Claise` are all valid.
  - the proper name of an institution/company/agency: `Fight Impunity`, `SBU`,
    `Miedzi Copper Corporation`, `NABU` are all valid.

## 2. Subject must be a real, full name

- **Valid:**
  - `Imię Nazwisko` — full first + last name (Błażej Spychalski), or
  - `Imię N.` — first name + surname initial when the source anonymizes
    (Konrad R., Michał O.).
- **Invalid → incorrect:**
  - bare initial only: `M.`, `X.`
  - a role/title in the name slot: `prezes`, `wiceprezes`, `adwokat`
  - a relational description: `jego ojciec`, `córka Grzegorza Stankiewicza`,
    `żona Marcina Liberackiego`, `syn X`
- The subject's **name must appear in the justification span** (strict). If the
  span refers to them only by pronoun/relation and never names them
  (span: *"został powołany…"*) → **insufficient**.
- **Extractor contract:** the justification must be **big enough to name the
  subject** on its own. A justification that requires surrounding article
  context to know who it is about is too small — extend it until it contains
  the subject's name.

## 3. Attributes (role / organization / party / relation / object)

- Each populated attribute must be **stated or directly entailed** by the span.
  Treat the following as ENTAILED — **accept them**:
  - a title implies its institution: *premier* ⇒ `Rząd` / `Rada Ministrów`;
    *minister sprawiedliwości* ⇒ `Ministerstwo Sprawiedliwości`; *wiceminister
    zdrowia* ⇒ `Ministerstwo Zdrowia`.
  - standard abbreviations expand: `ULC` = Urząd Lotnictwa Cywilnego, `CBA`,
    `NABU`, `KNF`, `ZUS`, `PSP`, etc.
  - an entity named **elsewhere in the same span** counts for a person in that
    span (e.g. a listing "…(prorektorka Collegium Humanum) … (kwestorka)" — the
    kwestorka's org is Collegium Humanum).
- But do NOT accept a value **more specific** than the span supports (e.g. span
  says *"Urząd Marszałkowski"* but org claims a particular województwo not named,
  or span *"placówka"* but org names a particular country) → that is
  absent/ungrounded → **incorrect**.
- **Contradicted** by the span → **incorrect**.
- **Garbled / malformed** value (truncation, stray punctuation like
  `rzecznik".`) → **incorrect**.
- **Absent** — a specific value the span neither states nor entails
  (e.g. party `EPP` when the span is only *"Ursula von der Leyen"*)
  → **incorrect**. The extractor must not emit ungrounded fields.

### 3.1 Standard form (required, so entities can be matched later)

`organization` and `role` must be normalized, not copied as declined in the
span. Judge form as well as grounding:

- **Nominative normalization is EXPECTED — never a defect.** A value written in
  base/nominative form when the span has it declined is **correct**, as long as
  it is entailed: span *"prezesa Alior Banku"* ⇒ `organization=Alior Bank`,
  `role=prezes` → accept. Do not require the value to match the span verbatim.
- **Acronym ⇔ full official name is the SAME entity — never a mismatch.**
  `PKN Orlen` = `Orlen`, `PiS` = `Prawo i Sprawiedliwość`, `KNF` = `Komisja
  Nadzoru Finansowego` → **correct**. Do not mark these as contradicted or
  over-specific.
- **`organization` must be a NAMED institution.** A description or anonymized
  placeholder — `firma B`, `pewna spółka`, `firma zajmująca się kredytami`,
  `ta placówka` — is not an organization → **incorrect** (it should have been
  left empty).
- **`organization` must be an institution, not a bare place.** A city / gmina /
  województwo / country *alone* in the org slot (`Paczków`, `Węgry`) →
  **incorrect**. BUT a **local office entailed by a place + title in the span
  is CORRECT**: a span naming a local official *by place* — `burmistrz
  Milanówka`, `wójt gminy Paczków`, `starosta Oławy` — entails the office
  (`Urząd Miejski w Milanówku`, `Urząd Gminy Paczków`, `Starostwo Powiatowe w
  Oławie`) → accept. The place name itself is fine as the office's location;
  do not demand the span spell out "Urząd". An institution whose *name*
  legitimately contains a place or country is also fine when the span supports
  it — `Rząd Węgier`, `Ambasada Polski we Francji`, `Prokuratura Okręgowa w
  Katowicach` → **correct**.
- **`role` — prefer the bare title, but standard multi-word titles are CORRECT.**
  A genuine compound office title, whose extra word is part of the title and
  NOT the employing institution, is fine: `prokurator generalny`, `prokurator
  krajowy`, `rzecznik prasowy`, `sekretarz stanu`, `podsekretarz stanu`,
  `marszałek Sejmu`, `asystent parlamentarny`, `p.o. dyrektora` → **correct**
  (especially when that form appears verbatim in the span).
  Mark **incorrect ONLY** when the role redundantly carries the SPECIFIC
  employing institution or unit that belongs in `organization` — `szef klubu`,
  `szef Generalnej Dyrekcji`, `przewodniczący rady powiatu`, `minister
  sprawiedliwości` (the ministry is the org) → the bare form (`szef`,
  `przewodniczący`, `minister`) is what is correct. (Applies to `role` only —
  an `organization` may contain a place.)
- **`role` must be a position noun, not a verb.** `pracował`, `kierował`,
  `nadzorował` are activities, not roles → **incorrect**.

## 4. Relations (personal_relation)

- `subject` and `object` must be the **correct way round** per the span
  (*"X, znajomy Y"*).
- Both endpoints must be valid names (§2); an endpoint that is only
  `ojciec` / `żona` with no name → **incorrect**.
- Swapped / wrong direction → **incorrect**.

## 4.1 Affairs (affair_involvement)

- `person` must be a valid full name (§2), and the **name must appear in the
  justification span**; pronoun-only or implied → **insufficient**.
- `role` and `affair` are **required** — a fact missing either is
  **incorrect**. `role` is the person's descriptive role *in the affair* (a
  phrase like `kierujący zorganizowaną grupą przestępczą`, `szef fundacji`,
  `pośrednik`), not an official position — judge it as a descriptive phrase,
  not by the employment `role` rules in §3.1.
- `affair` must be the affair's **named proper name** (`Fundusz
  Sprawiedliwości`, `afera podkarpacka`), not a bare noun like `afera`.
- `role` and `affair` must be **stated or directly entailed** by the span;
  a value more specific than the span, contradicted, or garbled →
  **incorrect**. The `affair` name is a proper name, so any language is fine
  (per §1).

## 5. Label definitions

- **correct** — subject is a valid name, present in the span; every populated
  field is Polish and supported by the span.
- **insufficient** — fields are plausible but the **span does not name the
  subject** (or is too fragmentary to verify the core claim). The fact may be
  true; it just cannot be confirmed from this span.
- **incorrect** — any concrete defect: non-Polish field, invalid/description
  subject, contradicted / absent / garbled attribute, or wrong relation
  direction.

## 6. Quick reference

| Situation | Label |
|---|---|
| Subject valid name in span, all fields supported & Polish | correct |
| Subject valid name but **not present** in span (pronoun only) | insufficient |
| Span too fragmentary to verify the core claim | insufficient |
| Field in a non-Polish language | incorrect |
| Subject is a bare initial / role / description | incorrect |
| Attribute contradicted, absent (ungrounded), or garbled | incorrect |
| `organization` is a description / placeholder / anonymized (`firma B`) | incorrect |
| `organization` is a place, not an institution (`Paczków`) | incorrect |
| Local office entailed by place+title (`burmistrz Milanówka`) | correct |
| `role` embeds the employing institution/unit (`szef klubu`) | incorrect |
| Standard multi-word title (`prokurator generalny`, `rzecznik prasowy`) | correct |
| `role` is a verb, not a position noun (`pracował`) | incorrect |
| Value normalized to nominative but entailed by span (`Alior Bank`) | correct |
| Relation endpoints swapped or unnamed | incorrect |
| Affair fact missing `role` or `affair` | incorrect |
| Affair `role`/`affair` not stated/entailed by span | incorrect |
| Affair `affair` is a bare noun, not a named affair | incorrect |
"""

_JUDGE_PROMPT = (
    "You label an extracted fact using this rulebook. Judge ONLY from the "
    "justification span; never use world knowledge or text outside it. Reply "
    "with a single compact JSON object and nothing else: "
    '{{"label": "correct|incorrect|insufficient", "reason": "..."}}.\n\n'
    "RULEBOOK:\n{rules}\n\n"
    "FACT (JSON):\n{fact}"
)


class ArticleFactsVerified(IncrementalJsonlPipeline[ArticleFactsVerifiedRecord]):
    filename = "article_facts_verified"
    backup_to_shared_cache = False
    interrupt_exceptions = (InterruptedError, KeyboardInterrupt)
    interrupt_note = "will save partial verifications"

    extracted_facts: ArticleExtractedFacts
    llm: LLM

    @property
    def output_class(self):
        return ArticleFactsVerifiedRecord

    def process(self, ctx: Context) -> pd.DataFrame:
        if not _INPUT_FILE.exists():
            raise FileNotFoundError(_INPUT_FILE)

        model = llm_model()
        existing = _existing_verified_cache(_FINAL_OUTPUT_FILE, _TEMP_OUTPUT_FILE)
        self.prepare_temp_output()
        rows = _load_input_rows(_INPUT_FILE)
        asyncio.run(_verify_rows(ctx, rows, existing, model=model))
        _print_llm_usage(ctx)
        return pd.DataFrame()


# --------------------------------------------------------------------------- #
# IO helpers
# --------------------------------------------------------------------------- #
def _load_input_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in tqdm(handle, desc="Reading facts", unit="row"):
            raw = line.strip()
            if not raw:
                continue
            try:
                rows.append(json.loads(raw))
            except Exception:
                continue
    return rows


def _existing_verified_cache(*paths: Path) -> dict[str, dict[str, Any]]:
    cache: dict[str, dict[str, Any]] = {}
    for path in paths:
        if not path.exists():
            continue
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                raw = line.strip()
                if not raw:
                    continue
                try:
                    row = json.loads(raw)
                except Exception:
                    continue
                url = row.get("url")
                if isinstance(url, str):
                    cache[url] = row
    return cache


def _cache_valid(
    cached: dict[str, Any] | None,
    row: dict[str, Any],
    model: str,
) -> bool:
    if cached is None or cached.get("verify_status") == "error":
        return False
    facts_in = row.get("extracted_facts") or []
    facts_cached = cached.get("extracted_facts") or []
    return (
        cached.get("article_content_hash") == row.get("article_content_hash")
        and cached.get("verify_model") == model
        and cached.get("verify_version") == VERIFY_VERSION
        and len(facts_cached) == len(facts_in)
        and all(isinstance(f, dict) and "verified" in f for f in facts_cached)
    )


# --------------------------------------------------------------------------- #
# Judging
# --------------------------------------------------------------------------- #
def _fact_view(fact: dict[str, Any]) -> dict[str, Any]:
    view = {
        key: fact.get(key)
        for key in (
            "fact_type", "person", "subject", "role", "party",
            "organization", "object", "relation", "affair",
        )
        if fact.get(key) is not None
    }
    # Judge against the verbatim span, never the model's justification field.
    view["justification"] = (fact.get("justification_in_text") or "").strip()
    return view


def _judge_request(fact: dict[str, Any], model: str) -> LLMRequest:
    prompt = _JUDGE_PROMPT.format(
        rules=_RULES,
        fact=json.dumps(_fact_view(fact), ensure_ascii=False),
    )
    return LLMRequest(
        prompt=prompt,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        model=model,
        enable_thinking=True,
    )


def _parse_verdict(text: str) -> tuple[str, str]:
    text = _THINK_BLOCK_RE.sub("", text or "")
    match = _JSON_LABEL_RE.search(text) or _JSON_ANY_RE.search(text)
    if not match:
        return "unknown", "judge returned no JSON"
    try:
        obj = json.loads(match.group(0))
    except Exception:
        return "unknown", "judge JSON parse error"
    label = obj.get("label")
    if label not in {"correct", "incorrect", "insufficient"}:
        return "unknown", str(obj.get("reason") or "")[:300]
    return label, str(obj.get("reason") or "")[:300]


def _annotate(fact: dict[str, Any], verdict: str, reason: str) -> dict[str, Any]:
    annotated = dict(fact)
    annotated["verification_verdict"] = verdict
    annotated["verification_reason"] = reason
    annotated["verified"] = verdict == "correct"
    return annotated


def _emit_row(
    ctx: Context,
    row: dict[str, Any],
    facts: list[dict[str, Any]],
    model: str,
    status: str = "ok",
    error: str | None = None,
) -> None:
    ctx.io.dumper.insert_into(  # type: ignore[attr-defined]
        ArticleFactsVerifiedRecord(
            url=str(row.get("url") or ""),
            article_content_hash=str(row.get("article_content_hash") or ""),
            extracted_facts=facts,
            fact_extraction_status=str(row.get("fact_extraction_status") or "ok"),
            verify_status=status,
            verify_error=error,
            verify_model=model,
            verify_version=VERIFY_VERSION,
        ),
        [],
    )


async def _verify_rows(
    ctx: Context,
    rows: list[dict[str, Any]],
    existing: dict[str, dict[str, Any]],
    *,
    model: str,
) -> None:
    await LLM.from_context(ctx).check_health()

    # Reuse cache and collect fact-level tasks for the rest.
    to_judge: list[dict[str, Any]] = []
    reused = 0
    for row in rows:
        cached = existing.get(str(row.get("url")))
        if _cache_valid(cached, row, model):
            assert cached is not None
            _emit_row(ctx, row, cached.get("extracted_facts") or [], model)
            reused += 1
            continue
        facts = [f for f in (row.get("extracted_facts") or []) if isinstance(f, dict)]
        if not facts:
            _emit_row(ctx, row, [], model)  # nothing to verify
            continue
        to_judge.append(
            {
                "row": row,
                "facts": facts,
                "results": [None] * len(facts),
                "pending": len(facts),
            }
        )
    if reused:
        print(f"Reused cached verifications: {reused}")

    total_facts = sum(state["pending"] for state in to_judge)
    if total_facts == 0:
        return

    # request_id -> (state, fact_index)
    inflight: dict[int, tuple[dict[str, Any], int]] = {}
    tasks = [
        (state, idx)
        for state in to_judge
        for idx in range(len(state["facts"]))
    ]

    with tqdm(total=total_facts, desc="Verifying facts", unit="fact") as bar:
        async with LLM.from_context(ctx).response_pool() as pool:
            for state, idx in tasks:
                while pool.is_full():
                    await _drain_one(ctx, pool, inflight, model, bar)
                request_id = await pool.put_request(
                    _judge_request(state["facts"][idx], model)
                )
                inflight[request_id] = (state, idx)

            while inflight:
                await _drain_one(ctx, pool, inflight, model, bar)


async def _drain_one(ctx, pool, inflight, model, bar) -> None:
    request_id, response = await pool.get_response()
    state, idx = inflight.pop(request_id)
    if isinstance(response, Exception):
        verdict, reason = "unknown", str(response)[:200]
    else:
        verdict, reason = _parse_verdict(response.content or "")
    state["results"][idx] = _annotate(state["facts"][idx], verdict, reason)
    state["pending"] -= 1
    bar.update(1)
    if state["pending"] == 0:
        _emit_row(ctx, state["row"], state["results"], model)


def _print_llm_usage(ctx: Context) -> None:
    llm = LLM.from_context(ctx)
    print(
        "Verify LLM usage: "
        f"{int(getattr(llm, 'request_count', 0) or 0)} requests, "
        f"{int(getattr(llm, 'total_tokens', 0) or 0)} total tokens"
    )
