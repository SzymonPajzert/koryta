"""Does `--only-changed` still predict what an upload would do?

The filters in `analysis/payloads/site.py` are an offline transcription of
`frontend/server/api/ingest/person.post.ts` and `company.post.ts`, and the
module says outright that they are worth only as much as they stay one. The two
deploy separately and neither has any way to notice the other moving, so this
is how you check.

The method is a round trip. For every person and company the site holds, build
the payload the site's own data implies - the same name, the same fields, one
employment per stored `employed` edge, one candidacy per stored `election` edge
- and ask the filter what uploading it would write. Nothing on the site can
teach the site anything, so the answer should be "nothing" every time.

An answer that is not "nothing" is one of two things, and the script cannot tell
them apart on its own:

  the filter has drifted from the ingest, which is the failure this exists to
    catch. Read the reasons: a rule that has moved shows up as one reason across
    thousands of rows.

  the *ingest* would really write, and the filter is right to say so. This is
    what the script is for in practice. Run against the 2026-08-31 export it
    reported 562 people, every one carrying two stored edges the site reads as
    one fact: `findEdgeOrCreate` counted a claim twice and wrote a third copy
    rather than matching the second. With that fixed the same export came back
    9163/9273 clean, and the 110 left are people the site holds *two pages*
    for - 171 register links are shared by more than one node, so a payload
    built from one page matches the other and everything on it reads as new.
    Companies were 4325/4325 both times.

Run it against a fresh export:

    uv run python -m scripts.check_only_changed [YYYY-MM-DD]

It reads `KorytaNodes` and `KorytaEdges`, so it costs one download of the nodes
and edges of that export (~63 MB) and nothing else. No emulator, no site.
"""

import collections
import sys
import typing

from analysis.payloads.site import (
    SKARB_PANSTWA_NODE_ID,
    SiteSnapshot,
    _as_list,
    edge_identity,
    semantics,
)
from conductor import setup_context
from scrapers.koryta.download import KorytaEdges, KorytaNodes

#: How many names to show per reason. Enough to look one up, short enough to
#: read - a reason that is a real drift will be thousands of rows, and three of
#: them is as much as anyone needs to start.
EXAMPLES = 3


class Implied:
    """The payloads the site's own data implies, indexed the way ingest looks."""

    def __init__(self, snapshot: SiteSnapshot) -> None:
        self.snapshot = snapshot
        # The snapshot keys edges by (source, target, type) because that is the
        # query the ingest makes. Building a payload asks the other question -
        # what hangs off this node - so both directions are indexed here.
        self.out: dict[tuple, list] = collections.defaultdict(list)
        self.into: dict[tuple, list] = collections.defaultdict(list)
        for (source, target, edge_type), siblings in snapshot.edges.items():
            for stored in siblings:
                self.out[(source, edge_type)].append((target, stored))
                self.into[(target, edge_type)].append((source, stored))

        self.krs_of = {node: krs for krs, node in snapshot.companies.items()}
        self.teryt_of = {node: teryt for teryt, node in snapshot.regions.items()}
        self.url_of = {node: url for url, node in snapshot.articles.items()}

    @staticmethod
    def _year(stored: typing.Mapping) -> str | None:
        start = stored.get("start_date")
        return start[:4] if isinstance(start, str) and len(start) >= 4 else None

    def person(self, node: dict) -> dict:
        node_id = str(node["id"])

        companies = []
        for target, stored in self.out[(node_id, "employed")]:
            krs = self.krs_of.get(target)
            if krs is None:
                # An employer with no KRS - an association, a ministry - is not
                # something a payload can name, so no row implies this edge.
                continue
            row = {"krs": krs}
            for field, key in (
                ("name", "role"),
                ("start_date", "start"),
                ("end_date", "end"),
            ):
                if stored.get(field):
                    row[key] = stored[field]
            companies.append(row)

        elections = [
            {
                "election_type": stored.get("position"),
                "teryt": self.teryt_of.get(target),
                "election_year": self._year(stored),
                "party": stored.get("party"),
                "committee": stored.get("committee"),
            }
            for target, stored in self.out[(node_id, "election")]
        ]

        return {
            "name": node.get("name"),
            "content": node.get("content"),
            "companies": companies,
            "elections": elections,
            "sources": [
                self.url_of[target]
                for target, _ in self.out[(node_id, "mentions")]
                if target in self.url_of
            ],
            "parties": _as_list(node.get("parties")),
            "wikipedia": node.get("wikipedia"),
            "rejestrIo": node.get("rejestrIo"),
        }

    def company(self, node: dict) -> dict:
        node_id = str(node["id"])

        owners, owner_teryts, skarb = [], [], False
        for source, _ in self.into[(node_id, "owns")]:
            if source == SKARB_PANSTWA_NODE_ID:
                skarb = True
            elif source in self.krs_of:
                owners.append(self.krs_of[source])
            elif source in self.teryt_of:
                owner_teryts.append(self.teryt_of[source])

        seat = None
        for source, stored in self.into[(node_id, "seat")]:
            if stored.get("deleted") is not True:
                seat = self.teryt_of.get(source)
                break

        payload = {
            "krs": node.get("krsNumber"),
            "name": node.get("name"),
            "activity": _as_list(node.get("activity")),
            "categories": _as_list(node.get("categories")),
            "is_public": bool(node.get("isPublic")),
            # "" is what the payload says for a company with no supervisory
            # body, and the ingest reads it as a deletion rather than a value.
            "supervisory_body": node.get("supervisoryBody") or "",
            "owners": owners,
            "owner_teryts": owner_teryts,
            "owner_skarb_panstwa": skarb,
        }
        for stored_key, payload_key in (
            ("legalForm", "legal_form"),
            ("supervisoryOrgan", "supervisory_organ"),
        ):
            if node.get(stored_key):
                payload[payload_key] = node[stored_key]
        if seat:
            payload["teryt_code"] = seat
        return payload


def round_trip(label, subjects, build, ask) -> int:
    reasons: typing.Counter[str] = collections.Counter()
    examples: dict[str, list] = collections.defaultdict(list)
    noop = 0
    for node in subjects:
        found = ask(build(node))
        if not found:
            noop += 1
            continue
        for reason in set(found):
            reasons[reason] += 1
            if len(examples[reason]) < EXAMPLES:
                examples[reason].append(node.get("name"))

    total = len(subjects) or 1
    share = 100 * noop / total
    print(f"\n{label}: {noop}/{len(subjects)} reproduced as no-ops ({share:.1f}%)")
    for reason, count in reasons.most_common():
        print(f"  {count:6d}  {reason}")
        print(f"          e.g. {'; '.join(str(name) for name in examples[reason])}")
    return len(subjects) - noop


def duplicate_census(snapshot: SiteSnapshot) -> None:
    """Stored edges the site itself reads as one fact stated twice.

    Not a filter problem, and reported here because this is the script that has
    the data: a round trip that is not clean is usually these. Whether they can
    be collapsed is decided per type by `scripts/migrate/dedupe-edges.ts` -
    `employed` yes where the role and the start are both known, `election` never,
    because the office and the run-off round are destroyed upstream and two real
    bids in one town in one year are byte-identical.
    """
    counts: typing.Counter[tuple] = collections.Counter()
    for siblings in snapshot.edges.values():
        for stored in siblings:
            counts[edge_identity(stored)] += 1

    groups: typing.Counter[str] = collections.Counter()
    extra: typing.Counter[str] = collections.Counter()
    for identity, count in counts.items():
        if count < 2:
            continue
        edge_type = str(identity[2])
        groups[edge_type] += 1
        extra[edge_type] += count - 1

    print("\nstored edges the site reads as one fact stated twice:")
    for edge_type in sorted(groups):
        collapsible = (
            "dedupe-edges collapses these"
            if semantics(edge_type).kind == "state" or edge_type == "employed"
            else "left alone: identical fields do not prove one fact"
        )
        print(
            f"  {edge_type}: {groups[edge_type]} groups, "
            f"{extra[edge_type]} extra copies - {collapsible}"
        )
    if not groups:
        print("  none")


def main() -> int:
    date = sys.argv[1] if len(sys.argv) > 1 else None
    ctx, _ = setup_context()
    snapshot = SiteSnapshot(
        KorytaNodes(date).read_or_process(ctx),
        KorytaEdges(date).read_or_process(ctx),
    )
    implied = Implied(snapshot)

    print(
        f"\npeople={len(snapshot.people_by_id)} "
        f"companies={len(snapshot.company_nodes)} "
        f"regions={len(snapshot.regions)} articles={len(snapshot.articles)}"
    )
    differing = round_trip(
        "people",
        list(snapshot.people_by_id.values()),
        implied.person,
        snapshot.changes,
    )
    differing += round_trip(
        "companies",
        list(snapshot.company_nodes.values()),
        implied.company,
        snapshot.company_changes,
    )
    duplicate_census(snapshot)
    return 0 if differing == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
