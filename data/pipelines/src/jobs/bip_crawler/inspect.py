"""`koryta_scrape_bip page` and `files`: why a walk credited somebody with a
file, or did not, without patching the walk.

    koryta_scrape_bip page https://bip.x.pl/oswiadczenia --unit 020800
    koryta_scrape_bip page URL --unit 020800 --person kowalski --led --grep osw
    koryta_scrape_bip walk 020800 --out /tmp/w --json /tmp/w/report.json
    koryta_scrape_bip files /tmp/w/report.json

``page`` asks for one page as the unit's walk would (identity, robots.txt and
its exceptions, the rate, Madkom's API; a render with --render) and reads it
with the walk's own `PeopleSearch._read_page`: its title, each link with the
row, heading and menu path it stands in, what the walk does with it (follows
it, at a score; a file; leaves it), whom each file link credits
(`candidates`), and what the download would take for each of the unit's
seekers (`choose`). The page counts as one a link from the start led to.

``files`` opens what a walk kept (--out, read through its --json report): for
each credited file that came down, its kind and pages, and the declarant its
text layer names on the form's first lines, as the declarations job reads it
(`jobs.bip_declarations.reading`), with whether that is the seeker; for a scan,
a picture of its first page's top beside the file. A credited file is only
good when it is the seeker's asset declaration: on 11-13 a walk of Lwówek
credited a councillor with "rodo.pdf", a data-protection notice.
"""

from __future__ import annotations

import argparse
import json
import re
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

from conductor import setup_context
from jobs.bip_crawler import render as rendering
from jobs.bip_crawler.people import (
    PageView,
    PeopleOptions,
    PeopleSearch,
    UnitSearch,
    _frames,
    _Frontier,
    _is_file,
    first_names_of,
    seekers_of,
    server_of,
)
from jobs.bip_crawler.people_list import list_policy, read_list, read_list_file
from jobs.bip_crawler.walk import MemoryDocIndex, access, chosen, folded
from scrapers.bip.classify import host_of, is_low_value_url, normalize_url
from scrapers.bip.people import Candidate, Seeker, choose, fold, link_score
from scrapers.common.fetch import use_ca_bundle
from scrapers.common.links import LinkContext
from scrapers.stores import DeclarationFile, PersonRow
from stores.bip_bundles import LocalBundleStore
from stores.bip_people import MemoryBipPeopleStore
from stores.tls import ca_bundle

#: How deep a page read alone stands: one link from the start.
DEPTH = 1
#: Pages of a file read for its declarants: a council's file holds every
#: councillor's declaration one after another.
MAX_PAGES = 200
#: The share of a scan's first page pictured: the form's title and name lines.
TOP = 0.45


def _cut(text: str, size: int = 80) -> str:
    text = " ".join(text.split())
    return text if len(text) <= size else text[: size - 1] + "…"


def _where(link: LinkContext) -> str:
    """A link's label and what stands around it: its row, heading, menu path."""
    parts = [repr(_cut(link.anchor))]
    for name, text in (("row", link.row), ("heading", link.heading)):
        if text and _cut(text) != _cut(link.anchor):
            parts.append(f"{name} {_cut(text)!r}")
    if link.path:
        parts.append(f"path {_cut(link.path)!r}")
    return " | ".join(parts)


def _fate(
    link: LinkContext,
    frontier: _Frontier,
    queued: set[str],
    seekers: list[Seeker],
    prefer: re.Pattern[str] | None,
    view: PageView,
) -> tuple[str, float]:
    """What the walk does with a link (`_Frontier.follow`), and its score."""
    target = normalize_url(link.url)
    if _is_file(target):
        return "file", 0.0
    if is_low_value_url(target):
        return "low value", -99.0
    if not frontier.in_scope(target):
        return "off scope", -99.0
    score = link_score(link, seekers, DEPTH + 1, prefer)
    if score <= -3:
        return "left", score
    if target not in queued:
        return ("seen" if frontier.has(target) else "left"), score + view.bonus
    return "follows", score + view.bonus


def page_lines(
    search: PeopleSearch,
    url: str,
    rows: list[PersonRow],
    *,
    led: bool = False,
    grep: str | None = None,
) -> list[str]:
    """`koryta_scrape_bip page`: what a walk of ``rows``' unit makes of ``url``."""
    seekers, prefer = seekers_of(rows)
    result = search._get_page(url)
    if isinstance(result, str):
        return [f"{result}: {url}"]
    agent = search.agents(host_of(result.url))
    lines = [
        f"{result.status} {result.content_type or '-'}, {len(result.content):,} "
        f"bytes, asked as {agent!r}: {result.url}"
    ]
    if not result.ok or not search._is_page(result):
        return lines
    out = UnitSearch("page")
    frontier = _Frontier([(host_of(result.url), "")])
    # Queued before it was read, as in a walk: its links to itself are no news.
    for read in (url, result.url):
        frontier.add(normalize_url(read), 0.0, DEPTH)
    frontier.heap.clear()
    view = search._read_page(out, result, DEPTH, frontier, seekers, prefer, led)
    queued = {target for _, _, _, target in frontier.heap}
    lines.append(
        f"title {view.title!r}; a declarations page: "
        f"{'yes' if out.declaration_pages else 'no'}; its links score "
        f"{view.bonus:+.0f} for it"
    )
    lines += [f"frame: {frame}" for frame in _frames(result.content, result.url)]
    credits: dict[str, list[Candidate]] = defaultdict(list)
    for c in out.found:
        credits[c.url].append(c)
    names = {r.key: f"{r.first_name} {r.last_name} ({r.election_year})" for r in rows}
    shown = list(dict.fromkeys(view.links + view.follow))
    fates = {
        link: _fate(link, frontier, queued, seekers, prefer, view) for link in shown
    }
    shown.sort(key=lambda x: (not credits.get(x.url), -fates[x][1]))
    pattern = re.compile(grep, re.I) if grep else None
    lines.append(
        f"{len(shown)} links: {sum(f == 'follows' for f, _ in fates.values())} "
        f"followed, {sum(f == 'file' for f, _ in fates.values())} files, "
        f"{sum(1 for x in shown if credits.get(x.url))} credit somebody"
    )
    for link in shown:
        said = " ".join((link.anchor, link.row, link.heading, link.path, link.url))
        if pattern is not None and not pattern.search(said):
            continue
        fate, score = fates[link]
        number = f"{score:6.1f}" if fate in ("follows", "left", "seen") else " " * 6
        lines.append(f"{fate:9s} {number} {_where(link)} -> {link.url}")
        lines += [f"            {_credit(c, names)}" for c in credits.get(link.url, [])]
    others = [c for c in out.found if c.url not in {x.url for x in shown}]
    lines += [f"elsewhere: {_credit(c, names)}: {c.url}" for c in others]
    picks = choose(
        out.found, seekers, search.options.per_person, search.options.unnamed_cap
    )
    for seeker in seekers:
        lines.append(f"{names[seeker.key]}: {_verdict(seeker, out.found, picks)}")
    return lines


def _credit(c: Candidate, names: dict[str, str]) -> str:
    who = f"credits {names.get(c.key, c.key)}" if c.key else "unnamed"
    how = ", first name too" if c.first_name else ""
    kind = "a declaration" if c.declaration_like else "not a declaration"
    return f"{who}{how}: {kind}, score {c.score:.1f}"


def _verdict(
    seeker: Seeker, found: list[Candidate], picks: dict[str, list[Candidate]]
) -> str:
    """What the download would take for a seeker from this page, or why not."""
    own = [c for c in found if c.key == seeker.key]
    taken = picks.get(seeker.key, [])
    if taken:
        how = "" if any(c.declaration_like for c in own) else "unnamed "
        urls = ", ".join(c.url for c in taken)
        return f"would download {len(taken)} {how}file(s): {urls}"
    if own:
        return f"named by {len(own)} link(s), none a declaration"
    return "no link here names them"


def cmd_page(args: argparse.Namespace) -> int:
    # The package imports this module, so its name comes in at call time.
    from jobs.bip_crawler import USER_AGENT  # noqa: PLC0415

    bundle, _ = ca_bundle(Path(args.ca_bundle))
    use_ca_bundle(str(bundle) if bundle else None)
    if args.list:
        people = read_list_file(args.list)
    else:
        people = read_list(setup_context(policy=list_policy())[0])
    rows = chosen(people, {args.unit}, None, args.person)
    if not rows:
        print("no candidacies on the list for that unit and name")
        return 1
    agents, allowed, unreachable = access(args, USER_AGENT)
    renderer = None
    if args.render and not rendering.available():
        print("read as HTML: playwright is not installed (the render group)")
    elif args.render:
        try:
            renderer = rendering.Renderer(USER_AGENT, workers=1)
        except rendering.RendererDown as exc:
            print(f"read as HTML: no browser started ({exc})")
    try:
        with tempfile.TemporaryDirectory(prefix="bip-page-") as scratch:
            search = PeopleSearch(
                MemoryBipPeopleStore(),
                MemoryDocIndex(),
                LocalBundleStore(Path(scratch)),
                {},
                PeopleOptions(user_agent=USER_AGENT),
                robots_allowed=allowed,
                robots_unreachable=unreachable,
                render=renderer.render if renderer else None,
                first_names=first_names_of(people),
                resolve=server_of,
                agents=agents,
                trace=lambda line: print(f"asked: {line}", flush=True),
            )
            for line in page_lines(
                search, args.url, rows, led=args.led, grep=args.grep
            ):
                print(line)
    finally:
        if renderer is not None:
            renderer.close()
    return 0


# -- files ------------------------------------------------------------------------


def _suffix(kind: str, data: bytes) -> str:
    if kind == "image":
        if data[:3] == b"\xff\xd8\xff":
            return ".jpg"
        return ".png" if data[:4] == b"\x89PNG" else ".tif"
    known = {"pdf": ".pdf", "docx": ".docx", "odt": ".odt", "doc": ".doc"}
    return known.get(kind, ".html" if kind == "html" else ".bin")


def describe(data: bytes, stem: Path, first: str, last: str) -> list[str]:
    """One downloaded file, written to ``stem`` and a suffix: its kind and pages,
    and whose declaration its text says it is; a scan's top as a picture."""
    # The declarations job reads OCR's models and imports this package.
    from jobs.bip_declarations.cutter import Pages, kind_of  # noqa: PLC0415

    kind = kind_of(data)
    path = stem.parent / (stem.name + _suffix(kind, data))
    path.write_bytes(data)
    if kind not in ("pdf", "image", "docx", "odt", "doc"):
        return [f"{kind}, {len(data):,} bytes: {path.name}"]
    pages = Pages(data, kind)
    try:
        texts = [pages.text(i) for i in range(min(pages.count, MAX_PAGES))]
        head = f"{kind}, {pages.count} page(s): {path.name}"
        if any(text.strip() for text in texts):
            return [head, *_declarants(texts, first, last)]
        if not pages.count:
            return [head, "no page to read: open it by hand"]
        picture = stem.parent / (stem.name + ".top.png")
        image = pages.image(0)
        band = image.crop((0, 0, image.width, round(image.height * TOP)))
        band.thumbnail((1100, 1100))
        band.save(picture)
        return [head, f"no text layer (a scan): page 1's top in {picture.name}"]
    finally:
        pages.close()


def _declarants(texts: list[str], first: str, last: str) -> list[str]:
    """The declarant page 1 names, whether that is the seeker, and the page
    of a longer file that is theirs."""
    from jobs.bip_declarations.reading import (  # noqa: PLC0415
        declaration_year,
        name_in_text,
        name_matches,
    )

    named = name_in_text(texts[0])
    if not named:
        lines = [f"page 1 names no declarant: {_cut(texts[0], 160)!r}"]
    else:
        theirs = "theirs" if name_matches(named, first, last) else "NOT theirs"
        year = declaration_year(texts[0])
        lines = [
            f"page 1: declarant {named!r}, {theirs}"
            + (f", as of {year}" if year else "")
        ]
        if theirs == "theirs":
            return lines
    for number, text in enumerate(texts[1:], 2):
        other = name_in_text(text)
        if other and name_matches(other, first, last):
            return [*lines, f"page {number}: declarant {other!r}, theirs"]
    seeker = Seeker.of("", first, last)
    for number, text in enumerate(texts, 1):
        if all(seeker.named_in(fold(text))):
            return [*lines, f"names {first} {last} on page {number}, not as declarant"]
    return [*lines, f"never names {first} {last} in {len(texts)} page(s)"]


def file_lines(
    report: dict[str, Any], root: Path, to: Path, person: str | None = None
) -> list[str]:
    """`koryta_scrape_bip files`: each credited file of ``report`` that came
    down, from the walk's bundles under ``root``, written to ``to``."""
    from jobs.bip_declarations import read_blob  # noqa: PLC0415

    lines = [f"files, and pictures of scans, in {to}"]
    said: set[tuple[str, str]] = set()
    for c in report["candidacies"]:
        docs = [d for d in c["docs"] if d["status"] == "ok" and d.get("sha256")]
        if not docs or (person and folded(person) not in folded(c["name"])):
            continue
        first = c.get("first_name") or c["name"].split(" ", 1)[0]
        last = c.get("last_name") or c["name"].split(" ", 1)[-1]
        outcome = c["status"] + (f":{c['reason']}" if c["reason"] else "")
        lines.append(f"{c['name']} ({c['unit']}, {c['election_year']}, {outcome})")
        for d in docs:
            named = "named" if d["named"] else "unnamed"
            lines.append(f"  {named} {d['score']:.2f} {_cut(d['anchor'], 70)!r}")
            lines.append(f"    {d['url']}")
            sha = d["sha256"]
            if (sha, folded(c["name"])) in said:
                lines.append("    as above")  # another candidacy of the person
                continue
            said.add((sha, folded(c["name"])))
            file = DeclarationFile(sha, host_of(d["url"]), d["url"], d["bundle"], "")
            data = read_blob(root, file)
            if data is None:
                lines.append(f"    not in {root / d['bundle']}")
                continue
            lines += [f"    {x}" for x in describe(data, to / sha[:12], first, last)]
    return lines


def cmd_files(args: argparse.Namespace) -> int:
    report = json.loads(args.report.read_text(encoding="utf-8"))
    root = args.out or (Path(report["out"]) if report.get("out") else None)
    if root is None:
        print("the walk kept no files: walk again with --out DIR --json REPORT")
        return 1
    to = args.to or root / "files"
    to.mkdir(parents=True, exist_ok=True)
    for line in file_lines(report, root, to, args.person):
        print(line, flush=True)
    return 0
