import json
import re
import unicodedata
from pathlib import Path
from typing import Any

import pandas as pd
from tqdm import tqdm

from entities.article import ArticleAnalyzedRecord
from scrapers.article.parse import date_iso_from_ld_json, title_from_ld_json
from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.article.pipelines.koryciarski_scores_pipeline import (
    ArticleKoryciarskiScores,
)
from scrapers.article.pipelines.parsed_pipeline import ArticleParsed
from scrapers.article.pipelines.pipeline_utils import (
    article_analyzed_keep_evidence,
    article_analyzed_only_matched_koryta,
    article_tag,
)
from scrapers.article.pipelines.verified_facts_pipeline import ArticleFactsVerified
from scrapers.stores import VERSIONED_DIR, Context

_PARSED_FILE = Path(VERSIONED_DIR) / "article_parsed" / "article_parsed.jsonl"
_SCORES_FILE = (
    Path(VERSIONED_DIR)
    / "article_koryciarski_scores"
    / "article_koryciarski_scores.jsonl"
)
_FACTS_FILE = (
    Path(VERSIONED_DIR) / "article_facts_verified" / "article_facts_verified.jsonl"
)

# Party aliases: spellings journalists use interchangeably for the same party.
# Dedup keys are built from the canonical form, so "PiS" and "Prawo i
# Sprawiedliwość" count as one party without touching the stored value.
_PARTY_ALIASES: dict[str, str] = {
    "pis": "Prawo i Sprawiedliwość",
    "prawo i sprawiedliwość": "Prawo i Sprawiedliwość",
    "prawo i sprawiedliwości": "Prawo i Sprawiedliwość",
    "psl": "Polskie Stronnictwo Ludowe",
    "polskie stronnictwo ludowe": "Polskie Stronnictwo Ludowe",
    "psl-koalicja polska": "Polskie Stronnictwo Ludowe",
    "po": "Platforma Obywatelska",
    "platforma obywatelska": "Platforma Obywatelska",
    "platforma obywatelska rp": "Platforma Obywatelska",
    "ko": "Koalicja Obywatelska",
    "koalicja obywatelska": "Koalicja Obywatelska",
    "sld": "Sojusz Lewicy Demokratycznej",
    "sojusz lewicy demokratycznej": "Sojusz Lewicy Demokratycznej",
    "razem": "Razem",
    "partia razem": "Razem",
    "nowoczesna": "Nowoczesna",
    ".nowoczesna": "Nowoczesna",
}


def _norm(value: str | None) -> str:
    """Lowercased, whitespace-collapsed form used for dedup keys."""
    return " ".join((value or "").strip().lower().split())


def _normalize_person_name(value: str | None) -> str:
    """Match the website's normalizePersonName (names.ts): fold diacritics and
    ``ł``, lowercase, collapse non-alphanumerics. Used for the person-page
    match so the pipeline agrees with what the ingest endpoint will link."""
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.replace("ł", "l").replace("Ł", "l").lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def _canonical_party(party: str | None) -> str:
    """Map a party spelling to its canonical name, else the normalized value."""
    return _PARTY_ALIASES.get(_norm(party), _norm(party))


# Legal-form/abbreviation/rename aliases for an organization name.
_ORG_ALIASES: dict[str, str] = {
    "sejm": "sejm",
    "sejm rp": "sejm",
    "sejm rzeczypospolitej polskiej": "sejm",
    "senat": "senat",
    "senat rp": "senat",
    "senat rzeczypospolitej polskiej": "senat",
    "rząd": "rzad",
    "rząd rp": "rzad",
    "rząd rzeczypospolitej polskiej": "rzad",
    "rząd donalda tuska": "rzad",
    "rząd po i psl": "rzad",
    "kancelaria prezydenta": "kancelaria prezydenta",
    "kancelaria prezydenta rp": "kancelaria prezydenta",
    "kancelaria prezydenta rzeczypospolitej polskiej": "kancelaria prezydenta",
    "kancelaria prezydenta andrzeja dudy": "kancelaria prezydenta",
    "prezydentura": "prezydentura",
    "prezydentura rzeczypospolitej polskiej": "prezydentura",
    "prezydent rzeczypospolitej polskiej": "prezydentura",
    "orlen": "orlen",
    "pkn orlen": "orlen",
    "pkp": "pkp",
    "pkp s.a.": "pkp",
    "mon": "ministerstwo obrony narodowej",
    "ministerstwo obrony": "ministerstwo obrony narodowej",
    # Ministry renames the extractor swaps freely for the same office.
    "ministerstwo klimatu": "ministerstwo klimatu i środowiska",
    "ministerstwo środowiska i klimatu": "ministerstwo klimatu i środowiska",
    "ministerstwo środowiska": "ministerstwo klimatu i środowiska",
    "ministerstwo rolnictwa": "ministerstwo rolnictwa i rozwoju wsi",
    "ministerstwo edukacji": "ministerstwo edukacji",
    "ministerstwo edukacji narodowej": "ministerstwo edukacji",
    "ministerstwo edukacji i nauki": "ministerstwo edukacji i nauki",
    "ministerstwo nauki i edukacji": "ministerstwo edukacji i nauki",
    "ministerstwo nauki i szkolnictwa wyższego": "ministerstwo edukacji i nauki",
    "ministerstwo nauki": "ministerstwo edukacji i nauki",
    "ministerstwo sportu": "ministerstwo sportu i turystyki",
    "ministerstwo kultury": "ministerstwo kultury i dziedzictwa narodowego",
    "ministerstwo pracy": "ministerstwo pracy i polityki społecznej",
    "ministerstwo rodziny i polityki społecznej": (
        "ministerstwo pracy i polityki społecznej"
    ),
    "ministerstwo rodziny, pracy i polityki społecznej": (
        "ministerstwo pracy i polityki społecznej"
    ),
    "ministerstwo spraw wewnętrznych": (
        "ministerstwo spraw wewnętrznych i administracji"
    ),
    "ministerstwo infrastruktury": "ministerstwo infrastruktury i budownictwa",
    "ministerstwo obrony narodowej": "ministerstwo obrony narodowej",
    "ministerstwo funduszy": "ministerstwo funduszy i polityki regionalnej",
    "ministerstwo rozwoju i polityki regionalnej": (
        "ministerstwo funduszy i polityki regionalnej"
    ),
    "rada ministrów": "rzad",
    "rada ministrow": "rzad",
    "klub parlamentarny pis": "klub parlamentarny pis",
    "klub pis": "klub parlamentarny pis",
    "parlamentarny klub pis": "klub parlamentarny pis",
    "kp pis": "klub parlamentarny pis",
    "klub parlamentarny prawa i sprawiedliwości": "klub parlamentarny pis",
    "klub ko": "klub ko",
    "klub koalicji obywatelskiej": "klub ko",
    "klub parlamentarny koalicji obywatelskiej": "klub ko",
    "klub parlamentarny koalicja obywatelska": "klub ko",
    "koalicja obywatelska": "koalicja obywatelska",
    # Polska 2050 spelling variants (incl. the genitive ``Polski 2050``).
    "polska2050": "polska 2050",
    "polski 2050": "polska 2050",
    "ruch polska 2050": "polska 2050",
    "stowarzyszenie polska 2050": "polska 2050",
    "polska 2050 szymona hołowni": "polska 2050",
    "polska 2050 - trzecia droga": "trzecia droga",
    "td-polska 2050": "trzecia droga",
    "polska 2050 - td": "trzecia droga",
    "polska 2050-td": "trzecia droga",
    "psl - trzecia droga": "trzecia droga",
    "trzecia droga: psl-polska 2050": "trzecia droga",
    # PSP abbreviation and its genitive form
    "państwowa straż pożarna": "państwowej straży pożarnej",
    "panstwowa straz pozarna": "państwowej straży pożarnej",
}
# Legal-form suffixes stripped from an org before alias lookup.
_LEGAL_SUFFIX_RE = re.compile(
    r"\s+(s\.?\s*a\.?|sa|sp\.?\s*z\.?\s*o\.?\s*o\.?|spółka\s+z\s+o\.?\s*o\.?)$"
)


def _canonical_org(org: str | None) -> str:
    """Canonical form of an org for dedup keys.

    Folds legal-form suffixes, the ``... RP`` / ``Rzeczypospolitej Polskiej``
    suffix, party aliases, and known ministry renames — so ``Sejm``,
    ``Sejm RP`` and ``Sejm Rzeczypospolitej Polskiej`` count as one, and so do
    ``Orlen`` / ``PKN Orlen`` and ``PSL`` / ``Polskie Stronnictwo Ludowe``.
    Also folds ``PSP`` → ``państwowa straż pożarna`` (e.g. ``PSP`` /
    ``Komenda Wojewódzka PSP`` vs ``Państwowa Straż Pożarna``) and strips a
    leading region adjective like ``śląska`` for komenda cases.
    """
    n = _norm(org)
    if not n:
        return n
    # PSP abbreviation → full form (genitive, as used in "Komenda ... PSP")
    n = re.sub(r"\bpsp\b", "państwowej straży pożarnej", n)
    # Leading region adjective for komenda cases (e.g. "śląska komenda ...")
    if n.startswith("śląska ") and "komenda" in n:
        n = n.removeprefix("śląska ").strip()
    n = _LEGAL_SUFFIX_RE.sub("", n)
    if n.endswith(" rzeczypospolitej polskiej"):
        n = n[: -len(" rzeczypospolitej polskiej")]
    elif n.endswith(" rp"):
        n = n[:-3].rstrip()
    # A party used as an org (``prezes @ PSL`` vs ``@ Polskie Stronnictwo
    # Ludowe``) folds under the same aliases as party_membership.
    if n in _PARTY_ALIASES:
        return _PARTY_ALIASES[n].lower()
    return _ORG_ALIASES.get(n, n)


# Role variants (gender, ``prezes zarządu`` form) folded for dedup keys.
_ROLE_ALIASES: dict[str, str] = {
    "minister": "minister",
    "ministra": "minister",
    "ministerka": "minister",
    "szef": "szef",
    "szefowa": "szef",
    "wiceszef": "wiceszef",
    "wiceszefowa": "wiceszef",
    "poseł": "poseł",
    "posłanka": "poseł",
    "prezes": "prezes",
    "prezes zarządu": "prezes",
    "wiceprezes": "wiceprezes",
    "wiceprezes zarządu": "wiceprezes",
    "przewodniczący": "przewodniczący",
    "przewodnicząca": "przewodniczący",
    "lider": "lider",
    "liderka": "lider",
    "koordynator": "koordynator",
    "koordynatorka": "koordynator",
    "rzecznik": "rzecznik",
    "rzeczniczka": "rzecznik",
    "komendanta wojewódzkiego": "komendant wojewódzki",
    "komendanta": "komendant",
}


def _canonical_role(role: str | None) -> str:
    """Fold role gender/inflection variants used for dedup keys."""
    r = _norm(role)
    # Strip "pełniący obowiązki" / "p.o." prefix (e.g. "pełniący obowiązki komendanta wojewódzkiego")
    r = re.sub(r"^(pełniący obowiązki|p\.o\.|p o)\s+", "", r)
    return _ROLE_ALIASES.get(r, r)


# A dedup key: fact type plus entity components, where the person slot is a
# (literal name, koryta id) pair so same-named people stay separated.
_FactKey = tuple[str | tuple[str, str], ...]


def _fact_key(
    fact: dict[str, Any],
    person_name: str | None = None,
    person_id: str | None = None,
) -> _FactKey:
    """A dedup key for a fact across articles.

    Exact on the entity fields (fuzzy name matching is intentionally left
    out); party_membership additionally folds party aliases, so "PiS" and
    "Prawo i Sprawiedliwość" group together.

    The person component is ``(literal name, koryta id)`` — the name first, so
    spelling variants stay apart, then the id, which splits same-named people
    who are different koryta individuals (e.g. two different "Piotr Woźniak"
    with different ids). An empty id keeps the name grouping when the person
    was never confirmed against koryta.
    """
    fact_type = str(fact.get("fact_type") or "")
    person = (
        (person_name, person_id or "")
        if person_name is not None
        else (_norm(fact.get("person")), person_id or "")
    )
    if fact_type == "employment":
        return (
            fact_type,
            person,
            _canonical_org(fact.get("organization")),
            _canonical_role(fact.get("role")),
        )
    if fact_type == "party_membership":
        return (
            fact_type,
            person,
            _canonical_party(fact.get("party")),
        )
    if fact_type == "personal_relation":
        return (
            fact_type,
            person,
            _norm(fact.get("object")),
            _norm(fact.get("relation")),
        )
    if fact_type == "affair_involvement":
        return (
            fact_type,
            person,
            _norm(fact.get("role")),
            _norm(fact.get("affair")),
        )
    return (fact_type, json.dumps(fact, sort_keys=True, default=str))


# Mentions are an OPTIONAL enrichment: ArticleAnalyzed reads article_person_mentions
# by path when present. Declaring it as a pipeline source would make the runner
# auto-rebuild it whenever it looks stale (its sources are refreshed often) —
# an expensive, hours-long job that would clobber a good file mid-run.
_MENTIONS_FILE = (
    Path(VERSIONED_DIR) / "article_person_mentions" / "article_person_mentions.jsonl"
)
_KORYTA_PEOPLE_FILE = Path(VERSIONED_DIR) / "person_koryta" / "person_koryta.jsonl"

# Verifier bookkeeping fields kept in article_facts_verified but stripped from
# the analyzed output.
_VERIFICATION_FIELDS = {"verified", "verification_verdict", "verification_reason"}


class ArticleAnalyzed(IncrementalJsonlPipeline[ArticleAnalyzedRecord]):
    filename = "article_analyzed"
    backup_to_shared_cache = False  # large incremental output, keep local-only
    # No interrupt_exceptions: a Ctrl+C during the merge still flushes via the
    # base's finally, then propagates (this step is cheap to re-run).

    parsed: ArticleParsed
    koryciarski_scores: ArticleKoryciarskiScores
    verified_facts: ArticleFactsVerified

    @property
    def output_class(self):
        return ArticleAnalyzedRecord

    def process(self, ctx: Context) -> pd.DataFrame:
        tag = article_tag()

        # Load facts first (small) to get the URL set we care about
        print("Loading facts...")
        facts = _load_facts(_FACTS_FILE)
        if not facts:
            print("No facts found, nothing to emit")
            return pd.DataFrame()
        print(f"  {len(facts):,} articles with facts")

        # Load scores (small, ~16MB) filtered to facts URLs
        print("Loading scores...")
        scores = _load_jsonl_filtered(_SCORES_FILE, facts)
        print(f"  {len(scores):,} matching scores")

        # Stream parsed (large) — only keep rows whose URL is in facts
        print("Streaming parsed articles...")
        parsed = _load_jsonl_filtered(_PARSED_FILE, facts)
        print(f"  {len(parsed):,} matching parsed records")

        # People confirmed in each article (koryta ids) — a small extra file.
        print("Loading person mentions...")
        koryta_ids_by_url = _koryta_ids_by_url(_MENTIONS_FILE)
        person_ids_by_url = _person_ids_by_url(_MENTIONS_FILE)
        print(f"  {len(koryta_ids_by_url):,} articles with confirmed mentions")

        keep_evidence = article_analyzed_keep_evidence()
        only_matched = article_analyzed_only_matched_koryta()
        # Names of the koryta people each article's ids resolve to, so a fact
        # whose person matches by name can be tied to a person page (the exact
        # rule the website ingest applies).
        koryta_name_by_id = _koryta_name_by_id(_KORYTA_PEOPLE_FILE)
        print(f"  {len(koryta_name_by_id):,} koryta people loaded")

        emitted = 0
        # url -> (parsed_row, score_row, publication_date, [(fact_key, fact)])
        pending: dict[
            str,
            tuple[
                dict[str, Any],
                dict[str, Any] | None,
                str | None,
                list[tuple[_FactKey, dict[str, Any]]],
            ],
        ] = {}
        first_seen: dict[_FactKey, str] = {}
        evidence_by_key: dict[_FactKey, list[str]] = {}

        for url, fact_rows in tqdm(facts.items(), desc="Filtering", unit="article"):
            parsed_row = parsed.get(url)
            if parsed_row is None:
                continue
            score_row = scores.get(url)

            # Prefer the parse-time date; fall back to re-deriving it from the
            # stored ld+json blob (older rows / @graph pages missed it at parse).
            publication_date = parsed_row.get(
                "publication_date"
            ) or date_iso_from_ld_json(parsed_row.get("ld_json"))

            # Keep only verified facts and stamp each with the article date.
            # The verifier's bookkeeping fields stay in article_facts_verified;
            # they're redundant here (every kept fact is verified).
            verified_facts = []
            for fact in fact_rows:
                if not isinstance(fact, dict) or fact.get("verified") is False:
                    continue
                fact = _strip_and_date_fact(fact, publication_date)
                if only_matched and not _fact_matches_koryta(
                    fact, url, koryta_ids_by_url.get(url, []), koryta_name_by_id
                ):
                    continue
                verified_facts.append(fact)
            triaged = _dedup_facts_for_article(
                url,
                verified_facts,
                first_seen,
                evidence_by_key,
                person_ids=person_ids_by_url.get(url),
            )

            # Skip articles whose facts were all filtered out — an analyzed
            # record with no facts carries no signal.
            if not triaged:
                continue

            pending[url] = (parsed_row, score_row, publication_date, triaged)

        kept_facts = 0
        # Between-article duplicates: keep the fact only in its first-seen
        # article; everywhere else it collapses into the first fact's evidence.
        for url, (parsed_row, score_row, publication_date, triaged) in tqdm(
            pending.items(), desc="Emitting", unit="article"
        ):
            deduped_facts = _collapse_between_articles(
                url, triaged, first_seen, evidence_by_key, keep_evidence=keep_evidence
            )
            if not deduped_facts:
                continue

            record = ArticleAnalyzedRecord(
                url=url,
                domain=parsed_row.get("domain", ""),
                title=parsed_row.get("title")
                or title_from_ld_json(parsed_row.get("ld_json")),
                publication_date=publication_date,
                article_content=parsed_row.get("article_content", ""),
                koryciarski_llm_score=(
                    score_row.get("koryciarski_llm_score") if score_row else None
                ),
                koryciarski_llm_reason=(
                    score_row.get("koryciarski_llm_reason", "") if score_row else ""
                ),
                extracted_facts=deduped_facts,
                koryta_ids=koryta_ids_by_url.get(url, []),
                tag=tag,
            )
            ctx.io.dumper.insert_into(record, [])  # type: ignore[attr-defined]
            emitted += 1
            kept_facts += len(deduped_facts)

        print(f"Emitted {emitted:,} ArticleAnalyzed records, {kept_facts:,} facts")
        return pd.DataFrame()


def _strip_and_date_fact(
    fact: dict[str, Any], publication_date: str | None
) -> dict[str, Any]:
    """Drop verifier bookkeeping and stamp the article date onto a fact."""
    fact = {k: v for k, v in fact.items() if k not in _VERIFICATION_FIELDS}
    fact["date"] = publication_date
    return fact


def _dedup_facts_for_article(
    url: str,
    verified_facts: list[dict[str, Any]],
    first_seen: dict[_FactKey, str],
    evidence_by_key: dict[_FactKey, list[str]],
    person_ids: dict[str, str] | None = None,
) -> list[tuple[_FactKey, dict[str, Any]]]:
    """Within-article dedup; record global first-seen and evidence.

    ``person_ids`` maps the article's confirmed person names to their koryta
    ids, so same-named individuals who are different koryta people get
    different dedup keys.
    """
    person_ids = person_ids or {}
    triaged: list[tuple[_FactKey, dict[str, Any]]] = []
    seen_this_article: set[_FactKey] = set()
    for fact in verified_facts:
        name, pid = _fact_person(fact, person_ids)
        key = _fact_key(fact, person_name=name, person_id=pid)
        # Within-article duplicates: keep the first occurrence only.
        if key in seen_this_article:
            continue
        seen_this_article.add(key)
        first_seen.setdefault(key, url)
        evidence_by_key.setdefault(key, []).append(url)
        triaged.append((key, fact))
    return triaged


def _fact_person(
    fact: dict[str, Any], person_ids: dict[str, str]
) -> tuple[str, str | None]:
    """(literal name, koryta person id) the fact's subject resolves to.

    ``person`` carries the fact's subject for most types; a personal_relation
    names it ``subject``. The literal name is always the key's first part; the
    id ('' when the person was never confirmed in the article) splits
    same-named people.
    """
    name = str(fact.get("person") or fact.get("subject") or "")
    normed = _norm(name)
    return normed, person_ids.get(normed, "")


def _person_ids_by_url(path: Path) -> dict[str, dict[str, str]]:
    """url -> {confirmed person name -> koryta person id}.

    Reads ArticlePersonMentions (one row per (article, person) pair) and keeps
    only pairs the LLM judge confirmed (``verdict == 'yes'``), so only genuine
    mentions split same-named facts.
    """
    result: dict[str, dict[str, str]] = {}
    if not path.exists():
        return result
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row: dict[str, Any] = json.loads(line)
            except Exception:
                continue
            if row.get("verdict") != "yes":
                continue
            url = row.get("url")
            person = row.get("person")
            person_id = row.get("person_id")
            if (
                not isinstance(url, str)
                or not url
                or not isinstance(person, str)
                or not person.strip()
                or not isinstance(person_id, str)
                or not person_id
            ):
                continue
            result.setdefault(url, {}).setdefault(_norm(person), person_id)
    return result


def _koryta_name_by_id(path: Path) -> dict[str, str]:
    """koryta person id -> full name from the person_koryta dataset."""
    result: dict[str, str] = {}
    if not path.exists():
        return result
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row: dict[str, Any] = json.loads(line)
            except Exception:
                continue
            person_id = row.get("id")
            name = row.get("full_name")
            if (
                isinstance(person_id, str)
                and person_id
                and isinstance(name, str)
                and name.strip()
            ):
                result[person_id] = name
    return result


def _collapse_between_articles(
    url: str,
    triaged: list[tuple[_FactKey, dict[str, Any]]],
    first_seen: dict[_FactKey, str],
    evidence_by_key: dict[_FactKey, list[str]],
    keep_evidence: bool = False,
) -> list[dict[str, Any]]:
    """Keep only facts first seen in this article; optionally attach evidence."""
    deduped: list[dict[str, Any]] = []
    for key, fact in triaged:
        if first_seen[key] != url:
            continue
        fact = dict(fact)
        if keep_evidence:
            fact["evidence"] = list(evidence_by_key[key])
        deduped.append(fact)
    return deduped


def _fact_matches_koryta(
    fact: dict[str, Any],
    url: str,
    koryta_ids: list[str],
    koryta_name_by_id: dict[str, str],
) -> bool:
    """Whether a fact's person (subject for relations) matches one of the
    article's confirmed koryta people by normalized name — the same match the
    website ingest uses to link a fact to a person page.
    """
    subject = fact.get("person") or fact.get("subject")
    if not subject or not koryta_ids:
        return False
    normed = _normalize_person_name(subject)
    return any(
        _normalize_person_name(koryta_name_by_id.get(pid)) == normed
        for pid in koryta_ids
    )


def _load_facts(path: Path) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    if not path.exists():
        return result
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row: dict[str, Any] = json.loads(line)
                url = row.get("url")
                facts = row.get("extracted_facts")
                if isinstance(url, str) and url and isinstance(facts, list) and facts:
                    result[url] = facts
            except Exception:
                continue
    return result


def _load_jsonl_filtered(
    path: Path, url_set: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    """Stream a jsonl file, keeping only rows whose url is in url_set."""
    result: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return result
    total = path.stat().st_size
    with (
        path.open(encoding="utf-8") as f,
        tqdm(total=total, unit="B", unit_scale=True, desc=f"  {path.name}") as bar,
    ):
        for line in f:
            bar.update(len(line.encode("utf-8")))
            line = line.strip()
            if not line:
                continue
            try:
                row: dict[str, Any] = json.loads(line)
                url = row.get("url")
                if isinstance(url, str) and url in url_set:
                    result[url] = row
            except Exception:
                continue
    return result


def _koryta_ids_by_url(path: Path) -> dict[str, list[str]]:
    """koryta ids of the people confirmed in each article.

    Reads ArticlePersonMentions (one row per (article, person) pair) and keeps
    only pairs the LLM judge confirmed (``verdict == 'yes'``), deduplicated in
    file order per article.
    """
    result: dict[str, list[str]] = {}
    if not path.exists():
        return result
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row: dict[str, Any] = json.loads(line)
            except Exception:
                continue
            if row.get("verdict") != "yes":
                continue
            url = row.get("url")
            person_id = row.get("person_id")
            if (
                not isinstance(url, str)
                or not url
                or not isinstance(person_id, str)
                or not person_id
            ):
                continue
            ids = result.setdefault(url, [])
            if person_id not in ids:
                ids.append(person_id)
    return result
