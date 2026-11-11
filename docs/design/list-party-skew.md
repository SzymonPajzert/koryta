# Party make-up of local committees, and the same-committee line on a candidacy row

Status: design, 2026-11-11, against main dfddc531. Line references drift; names are stable.
The look: design-board round sklad-listy-r1 picked variant E (the committee heads a quiet rail
under the row); the owner approved round sklad-listy-r2 (folded by default, party colours in the
opened table, a link to the committee's list page) on 2026-11-11 at 20:18 UTC.

This document names no person. Its examples are invented („KWW Przykładowa Wspólnota”,
„gmina Przykładowo”, „Osoba A”) and match no real record. The real cases that prompted it,
and every committee and place it abstracts away, are kept in a private appendix outside the
repository, because this repository is public.

Owner's rules referred to below:
- **(R1)** published means reviewed by a person; a logged-out reader sees only published pages
  and published edges;
- **(R2)** a PKW record that nothing contradicts is attached to a page, and reviewers reject on
  the page; a statistic has no reviewer, so it may use a stricter rule, and says so;
- **(R3)** pipelines are stateless and registered in `PIPELINES`; jobs keep state as write-once
  parts; anything producing a data artifact is a registered pipeline;
- **(R4)** every open decision is a task;
- **(R5)** agent-written conventions are not the owner's decisions: rule F uses
  `committee_to_party` as it stands (which sends „kkw lewica” to SLD and the Nowa Prawica lists to
  Konfederacja, §16) and adds no mapping rule of its own; nothing here builds on the parked
  `party_bloc.py`;
- **(R6)** UI: no colour changes until the palette is picked, except where the owner asks for one
  (he did for the opened table, §6.3); sage is a fill, never text; method and explanations go
  behind the (i); reuse the site's components; the logged-in contributor comes first; relation
  rows stay short; every UI change goes on the design board before tests and baselines;
- **(R7)** copy is Polish and uses the plain hyphen only;
- **(R8)** the slate is a scoring signal (2026-08-29 note); the factual line stays apart from
  scoring and is never shown as a score's explanation;
- **(R9)** nothing committed names a person.

## 1. Summary

**What the owner asked** (2026-11-11): people published with „Inne” only often ran on a local
list whose other candidates, looked up in other elections, lean to one party („30% PSL”).
Compute that skew for local lists, show it on the candidacy row, and show on the same row that
the person ran with someone who has a published page. He had been recording the second fact by
hand, as connection edges („wspólna lista”).

**What a reader sees** (variant E, rounds sklad-listy-r1 and -r2, approved). A quiet rail under a local
candidacy row, about the committee, never about the person:

1. **The committee**, in PKW's short form („KWW PRZYKŁADOWA WSPÓLNOTA ›”), on one line, linking
   to the committee's own list page (§9).
2. **Its make-up**, when the rule holds: „11 z 31 (35%) kandydatów tego komitetu startowało w
   latach 2014-2018 z list PO” with the party as bold text, an (i), and „wszystkie partie ▾”,
   which opens a table of every party in the parties' own colours. Folded by default.
3. **The people with a published page** who stood for the same committee in the same election
   and unit, its candidate for wójt, burmistrz or prezydent included: „Z tego komitetu do rady
   na koryta.pl: Osoba A · Osoba B i 3 innych ›”, the overflow linking to the list
   page. On a party list too, with a person's chips shown only where they differ from the
   list's party.

A row with neither fact looks as it does today.

**Reach** on the 11-11 export (person_pkw of 11-03, the final rule of §4):

| | Visible rows | Published people |
|---|---|---|
| Make-up | 126 (89 committees) | 110 |
| Same committee, voters' committees | 294 | 203 |
| Either, voters' committees | 364 | 259 |
| Same committee, every local row, party lists too (published on both sides, across offices) | 2,120 | 1,042 |
| Make-up, counting draft candidacies too (signed-in readers) | 218 | 181 |

Nationally, 1,568 of 35,534 voters' committees with 10 or more council candidates carry a
make-up line. The motivating 2024 committee reads 11 of 31.

**Moving parts:**
- two registered pipelines: `ElectionSlates` (the make-up of every committee, from `PeoplePKW`
  alone) and `ElectionSlatePayloads` (each koryta candidacy placed on its committee; one
  document per committee holding a koryta candidacy, 24,332);
- one stateless night step, `koryta_slate_import`, which sends the documents whole and stops
  before any mass change until the owner has read it;
- one server-only collection, `electionSlates`, behind one ingest and one cached read endpoint
  that decides at read time whom it may name;
- one composable and the row; later, the list page (§9).

Nothing is written to edges or nodes: no revisions, no Functions triggers, no IAM change, no
index, no migration, nothing against `--max-published`.

**Rollout.** The data first, invisible. Then the rail for signed-in readers, in the look the
owner approves on the board. Then public, after the owner reads the launch set. The list page,
which needs five more `person_pkw` fields, is step 2 and its own board round.

## 2. Measured baseline

Measured 2026-11-11, read-only, on `person_pkw` of 11-03 (1.77M candidacies) and the 11-11
export (2,418 published person pages; 11,094 live election edges on them, 6,056 published).
**Visible** means a published election edge; every one of them sits on a published page. The
sources are six measurement reports, the critic's settled values, and a design-phase recount
under the rule of §4 („recount”), all kept with the private appendix.

### 2.1 What the line can rest on

| Measure | Value | Source |
|---|---|---|
| Identity links carrying a party: powiat block, middle names not conflicting (2024 councils against 2002-2018, a {0,+1} birth-year window) | 99.8% right (81,739 links, about 172 wrong); ±1 adds about 28 links inside the powiat, about 26 of them wrong, and precision stays about 99.8% | identity |
| The same, nationwide | 84.2% right | identity |
| Party-carrying links of national runs: from 2019 by residence powiat / before 2019 by district województwo | 99.1% / 81.3% | identity |
| Candidates the powiat rule links to a namesake inside one election (impossible pairs, 2024 councils) | 0.064% | identity |
| Flags chance alone would give (binomial model, any period) | n 5-9: 36%; n 10-19: 16%; n 20+: 0.5% | critic |
| 2024 voters' committees (n ≥ 10) whose own mayoral candidate declares a named party | 719; 123 get a line; 112 of those name the declared party (91%) | recount, corrected by the fact-check |
| The same by declared party: lined / agreeing / all | PiS 71 / 71 / 253; PSL 38 / 35 / 226; PO 9 / 6 / 147; Nowa Lewica 5 / 0 / 36; Polska 2050 0 of 24, Konfederacja 0 of 23, Razem 0 of 6, Nowoczesna 0 of 4 | recount |
| Slate-mate pairs standing in the same okręg (2024) | 17.5-26.2% in multi-member councils; 0% in gminy up to 20k | inventory |
| Council candidates' party membership published by PKW | none: it is in the consent form (Kodeks wyborczy art. 426 § 2), not on the poster (art. 435 § 1) | inventory |
| „Popierany przez” (art. 426 § 6) naming a national party, on voters'-committee candidacies | 482 of 119,355 in 2024 (0.40%); 594 of 104,852 in 2018 (0.57%) | inventory |

So the line is a high-precision, low-recall fact. Where it shows, it nearly always agrees with
the official signal; most committees with party ties never get one, and parties younger than
the window cannot appear at all. Its absence must never read as „no party ties”.

### 2.2 From the settled reference to the final rule

The settled reference (critic): powiat block, ±1, middle names not conflicting, national links,
same-year evidence, voters' and other unmapped committees. At n ≥ 5 it gives 138 visible rows
(121 people) and 1,964 committees nationally. The design recount of the same reference at n ≥ 10
gives 136 visible rows (119 people, 96 committees) and 1,701 committees; the rows below are that
recount's steps.

| Narrowing | What it removes | Measured cost |
|---|---|---|
| Local runs only | the national-run identity question | 1,643 of 1,668 lines stand on local links alone (earlier measurement, n ≥ 5) |
| Committee evidence only | the declared-membership normaliser and its mapping choices | 1,657 of 1,668 lines stand on committee evidence alone |
| Strictly earlier elections | impossible same-year pairs; June 2024 EP runs counted for April's committees | recount: at most 52 lines nationally and 6 visible rows rested on same-year evidence; the critic's upper bound for impossible same-year council links alone is 14 of 1,668 lined slates |
| Voters' committees only | unmapped party-like committees and associations | recount: 5 visible rows, 88 committees |
| The four together, with ambiguity dropped one way and n counted by candidacy | | recount: 126 visible rows, 110 people, 89 committees; 1,574 nationally |
| The reverse ambiguity drop, integer thresholds, the national class (§3, §4.2) | namesake evidence; national committees resting on open mapping choices | recount: 6 committees nationally; no visible row |
| **Final rule F** | | **126 visible rows, 110 people, 89 committees; 1,568 nationally** |

The motivating committee reads 11 of 31 under every variant: 12 counting any period, 10 of them
on the party's previous council list, 14 with any national-party run. (The owner's brief was
relayed to the measurement as 16; that was a miscount.)

### 2.3 The final rule in detail

| | Value |
|---|---|
| Lined committees by election | 2002: 86 of 6,871; 2006: 350 of 5,965; 2010: 191 of 5,655; 2014: 307 of 5,996; 2018: 250 of 4,982; 2024: 384 of 6,033 (1998: 0 of 32) |
| By party | PSL 520, SLD 424, PiS 378, PO 245, Bezpartyjni Samorządowcy 1 |
| By council | Rada gminy 1,062, Rada powiatu 283, Rada miasta 221, other 2 |
| By size | 10-19: 1,110; 20-39: 381; 40+: 77 |
| Held back | 4 ties for the lead; 1 national-class committee. A second party is named on 53 |
| Visible rows by office | Rada miasta 41, Rada powiatu 40, Rada gminy 17, Burmistrz 9, Prezydent 7, Wójt 6, „Samorząd” 6 (22 head rows) |
| Visible rows by election | 2024: 41; 2018: 53; 2014: 22; 2010: 1; 2006: 8; 2002: 1 |
| Visible rows by party | PO 61, SLD 25, PSL 22, PiS 18 |
| The row's edge stores no committee | 39 of 126 (36 people) |
| The line names a party the person does not carry | 31 of 126 rows (30 people): 23 rows (22 people) whose parties do not include it, 8 rows (8 people) with no party |
| Visible rows on committees of 10-19 | 30 |
| The person is among the k | 73 of 104 council rows |
| Published people with „Inne” only (38) / with no party (259) reached | 3 / 8 visible; 5 / 13 counting draft candidacies |

The „Inne”-only and no-party counts will move once branch pkw-party-statements merges (§10):
it adds a person's declared membership and PKW's „popierany przez” to their parties, which on
the 11-11 export gives 115 published pages a party they do not show today.

### 2.4 Facts about the site the design has to fit

| Fact | Value | Source |
|---|---|---|
| Live candidacies on published pages placed on exactly one PKW committee, edge-anchored | 10,787 of 11,094 (97.2%) | pipeline |
| Placement without the stored committee chose the same candidacy as with it | 7,213 of 7,213 | critic |
| Visible voters'-committee rows; those storing no committee | 1,323 (750 people); 535 | recount |
| The same, all unmapped committees | 1,533; 617 | critic |
| Election-edge annotations | written once, never overwritten (`fillAnnotations`, server/api/ingest/person.post.ts) | pipeline |
| Published pages the night may change | 10 (`--max-published`): 177 or more nights for 1,770 pages | pipeline |
| Churn | 722 publications in 8 days changed the mate sets of 900 published pages across 1,755 committees | pipeline |
| The stored edge key (region, year, office, committee) | coarser than one contest on 773 of 2,374 rows with a published mate; merges two gminas in 812 of 17,616 gmina-level keys (4.6%) | frontend, pipeline |
| A read-time join from stored edges | median 119, p90 1,068 reads per view | frontend |
| The history request on a person page | median 16, p90 32 reads per uncached view | frontend |
| Distinct contest-level mates per published page | median 1, p90 8, max 24 | frontend |
| The meta line at 375 px | about 210 px on main, about 295 px on the redesign; the motivating committee's name alone is 275 px (41 characters, the median committee length on public rows) | frontend |
| Hand-made connection edges naming a shared list | 7 of 179, 3 published; 5 point at the person the committee is named after | critic |

## 3. Definitions

- **Local candidacy.** A `person_pkw` row with `election_type` 'samorządu', from 1998 (1994 has
  no committee), with a 6-digit `teryt_candidacy`, the **unit**: gmina xxyyzz, powiat xxyy00,
  województwo xx0000, Warsaw dzielnica 1465zz. Its office comes from `local_office`
  (scrapers/pkw/offices.py): a council (Rada gminy, Rada miasta, Rada powiatu, Sejmik, Rada
  dzielnicy) or a head office (Wójt, Burmistrz, Prezydent).
- **Committee key.** `normalise_committee` (scrapers/pkw/elections.py): lowercased, whitespace
  collapsed, the same fold as `field()` in server/utils/edges.ts. 2024 committees are PKW's
  abbreviations, unique within a council (0 collisions).
- **Slate** („komitet w radzie”). Keyed by (year, unit, committee key). It holds the committee's
  council candidates in that unit across every okręg, and its head candidate where it put one
  up in the same unit. Office is an attribute of each member, not part of the key. A slate is
  not a ballot list: those are per okręg, and in gminy up to 20k each okręg list holds one name.
  The owner's own „wspólna lista” edge for the motivating case joins two okręgi of one slate.
- **Slate id.** `"{year}-{unit}-{first 10 hex characters of sha1(committee key)}"`. It holds no
  name, but hashing the few committees PKW lists in a unit recovers the committee, so a slate id
  is a public fact about one committee: real ones never go into the repository (§4.8).
- **Size (n).** The slate's council candidacy rows. Two namesakes born the same year count twice
  (2 slates differ from counting by name and birth year, of the 35,749 counted before the
  national class was split off; rule F's population is 35,534). A head candidate counts only
  if also standing for the council.
- **Committee class.**
  - `party`: `parties_of_committee` names a party; the row already shows it.
  - `national`: unmapped, with lists in the sejmiks of 3 or more województwa in that election
    (32 committees, 1998-2024).
  - `voters`: unmapped and not national, with a key that starts with „kww” or contains
    „wyborców” (or „wyborcow”).
  - `other`: every other unmapped committee: local associations, minority committees, unmapped
    party-like ones. PKW's committee type sorts these in step 2.
- **Head candidate.** The committee's candidate for wójt, burmistrz or prezydent in the same unit
  and election.
- **Evidence.** A slate member's own earlier local candidacy, linked by rule F (§4.2), on a
  committee that `parties_of_committee` maps to a named party. A coalition counts for each of its
  parties. „Inne” never counts.
- **Line.** The named party with the most members carrying evidence (k), shown when the class is
  `voters`, n ≥ 10, k ≥ 3, 10·k ≥ 3·n, and no other party has the same k.
- **Second party.** The best other named party with k2 ≥ 3 and 5·k2 ≥ n.
- **Mate.** Another koryta person whose own candidacy edge is placed on the same slate.

## 4. Pipeline

### 4.1 person_pkw: unchanged in step 1

Step 1 reads only what `person_pkw` already keeps: names, birth year, `teryt_candidacy`,
`teryt_living`, office and committee. What it drops matters for the list page (§9):
- every local council file from 1998 holds the okręg, the committee's list number and the
  position, filled at 100% (the 2024 small-gmina file has no position, and its list number is
  „Numer na karcie do głosowania”); the 2002-2018 files also hold PKW's committee type, and the
  2006-2018 files its signature (Sygnatura); `headers.py` maps most of it to `None`, and the
  three okręg columns it does map go through `lookup_teryt`, which leaves them empty for local
  runs;
- national runs keep only the województwo that `lookup_teryt` derives, not the district.

**Step 2: five fields**, `district`, `list_number`, `list_position`, `committee_type` and
`committee_id`, all `str | None`, kept as PKW wrote them:
- about 30 header-map entries change from `None` to `SetField(<field>, parse_code)`; one
  `ALSO_KEEP` loop keeps the okręg columns that already feed `teryt_candidacy`; three per-file
  overrides (the 2002 mayoral `Typ_1`, the 1994 `Typ`, the 2024 small-gmina ballot number); the
  four code columns become `str` in `PeoplePKW.dtype`;
- a dry run over all 44 header layouts maps no two columns to one field;
- `rebuild_held` rebuilds `PeoplePKW` the first night (173 s, 6.2 GB); the output grows by about
  0.2 GB; nothing downstream changes, because `people_pkw_merged` selects named columns.

The inventory's sixth field, Poparcie, arrives as `supported_by` with branch
pkw-party-statements (task merge-pkw-party-statements), which also restores the 2014 mayoral
and 2009 European membership columns. The five fields land as their own change from main, so
nothing waits on that review; whichever merges second resolves the overlap in `headers.py`,
`process.py` and `entities/person.py`. The list page also wants the votes (`Liczba głosów`,
about 28 MB more), decided with the page (§9).

**Never in this work:** replacing the 2024 committee abbreviations with full names. The
committee is an edge discriminator (`EDGE_SEMANTICS.election`, server/utils/edges.ts), so that
would change the identity of every 2024 candidacy edge, and every 2024 slate id. It is a
migration of its own.

### 4.2 Identity: rule F

A page attaches every PKW record that nothing contradicts and leaves the rest to a reviewer
(R2). The statistic has no reviewer, so it links two candidacies as one person's only when all
of these hold:
1. **Names.** The same first name and the same whole surname under `normalize_person_name`
   (util/polish.py), which folds case, diacritics and the spacing around a hyphen. Not
   `surname_key` in analysis/payloads/site.py: it keeps the last word only, so „Kowalska-Nowak”
   would link to a plain „Nowak”, which is looser than the rule measured.
2. **Middle names do not conflict:** equal, or missing on one side. Strict equality would lose
   23% of true links in 2002.
3. **Birth year within ±1.** Not {0, +1}: that holds only against 2024. Between earlier
   elections the offset runs both ways: 2018 against 2014 or 2010 at -1 and 0, 2014 against 2010
   also at +1, 2010 against 2006 on both sides.
4. **The same home powiat:**
   - council, head and dzielnica runs: the first 4 digits of the unit;
   - sejmik runs: the residence powiat (`teryt_living`);
   - sejmik runs of 1998, 2002 and 2014, where person_pkw holds no residence: the same
     województwo (whether the raw files have one is task
     check-sejmik-residence-in-the-1998-2002-2014-files).
5. **Local runs only.** National runs stay out: before 2019 their party-carrying links are 81.3%
   right, and every line that needs any national link is 1.5% (25 of 1,668, earlier
   measurement), so a 2019+ rule buys at most that.
6. **Unique.** A member matching two or more council candidacies of one earlier election takes
   nothing from that election, and an earlier candidacy matched by two or more council
   candidacies of one later election gives nothing to any of them (3,753 pairs each way). Two
   namesakes on one slate therefore lend each other nothing.

Links are pairwise inside the run and never clustered, so nothing chains. `people_pkw_merged`'s
clusters are not reused: they are nationwide, and they split 6.8% of continuing candidates.

### 4.3 Evidence and the line

- **Evidence** is a linked candidacy that is strictly earlier, at most 10 years before the
  slate's election, local, and on a committee mapped to a named party. In practice that is the
  two previous local elections: 2014 and 2018 for 2024, 2010 and 2014 for 2018, down to 1998
  alone for 2002.
- **k** per party is the number of distinct member candidacies with evidence for it. **Years**
  are the elections the counted runs come from.
- **The line** follows §3. Thresholds use integers (10·k ≥ 3·n, 5·k2 ≥ n), never floating point.
- **The opened table** lists every named party with k ≥ 1 in the window, under the same rule
  id, once the line itself shows. A joint list counts once and names both its parties.
- **Suppressed slates.** `analysis/slates/suppressed.py` holds `SUPPRESSED: dict[str, str]`, a
  slate id and a reason that names no one („namesake evidence, task <id>”). A listed slate shows
  no line from the next night. It is reviewed like any code.
- **Nothing below the thresholds is written anywhere.** A count on a one-person committee would
  be a fact about one private person.
- **The rule has an id**, `RULE = "F1"`, written into every output row and document. Any change
  to the rule bumps it.

The window only looks back, so a slate's line changes only when PKW data, `committee_to_party`
or the rule changes. A later election never moves it.

Declared membership (`party_member`, and from pkw-party-statements `member_parties` and
`backing_parties`) is not evidence in step 1. Once that branch is merged and its curated
`affiliations.py` table is the owner's, it is the only parser a later rule may use; no second
membership table is written here.

### 4.4 ElectionSlates

**Where.** `data/pipelines/src/analysis/slates/__init__.py` (`class ElectionSlates(Pipeline)`,
`filename = "election_slates"`), with `rule.py` (the constants, `committee_class`, the SQL
builders and `explain`) and `suppressed.py` beside it. The row dataclass `ElectionSlate` goes in
`entities/slate.py`.

**Source.** `pkw: PeoplePKW` only. It imports `normalise_committee`, `parties_of_committee` and
`OTHER_PARTY` from scrapers/pkw/elections.py, and the name folds above.

**`process(ctx)`.** One DuckDB pass over `ctx.con`: local candidacies; slates and their class; a
blocked self-join on (first name, surname key, block) with the ±1 and middle-name conditions;
the two ambiguity drops; evidence; k per slate and party; the line, the second party, the table
and the reason. About 30 s and under 1 GB (the critic's build of the same joins took 13 s and
0.75 GB).

**Output.** Parquet, one row per committee in a unit and election: 190,255 council slates, plus a
row for every committee that put up only a head candidate there:

| Field | Content |
|---|---|
| `slate_id`, `year`, `unit` | as defined; `unit` and `slate_id` pinned to `str` in `dtype` |
| `unit_name` | the TERC name through `read_terc`, or None where TERC 2025 lacks an old code |
| `council` | „Rada gminy” and so on, or None when the committee ran no council list there |
| `committee`, `cnorm`, `committee_class` | PKW's most common spelling, the key, the class |
| `size` | n, or None with no council list |
| `head_office` | Wójt, Burmistrz or Prezydent when the committee put up a head candidate there |
| `line_party`, `line_count`, `line_years` | or None |
| `second_party`, `second_count` | or None |
| `parties` | the table: `[{party or parties, count}]`, only when the line shows |
| `reason` | `line`, `class`, `size`, `threshold`, `tie`, `no_evidence` or `suppressed` |
| `rule` | `RULE` |

No member list and no per-member evidence is written: the links exist only inside the run.
`backup_to_shared_cache = False`, since it rebuilds in seconds.

### 4.5 ElectionSlatePayloads: the join to site candidacies

**Where.** `data/pipelines/src/analysis/payloads/slates.py`, beside `RegionPayloads`. The output
is day-named like the export frames (`election_slate_payloads_<day>`, jsonl), with
`backup_to_shared_cache = False`.

**Sources.** `slates: ElectionSlates`, `pkw: PeoplePKW`, and the day's `KorytaNodes` and
`KorytaEdges`. Neither export frame changes: the site checks publication at read time, and
`EDGE_FIELDS` and `NODE_FIELDS` stay what the people import's `--only-changed` compares.

**Placement** is edge-anchored, the route that places 97.2% of live candidacies on published
pages; `BipPeopleOfInterest` is the in-tree precedent for joining a stored candidacy back to
PKW's 6-digit unit. For every live election edge of a person page (tombstones skipped through
`merged_into`; `KorytaNodes` carries no `deleted` or `published`, so a deleted page that was not
merged is placed too, and the read-time check of §5.3 drops it) with a local office, „Samorząd”
or no office, from 1998:
- **strict:** PKW local rows with the edge's year and office (any council for „Samorząd” or
  none), a unit under the region node's TERYT, the same committee key where the edge stores a
  committee, the page's folded first name and surname key, and, where the page has a birth date,
  a PKW birth year within ±1;
- **relaxed:** for an edge with no committee or no office, the same without that field, accepted
  only when exactly one candidacy matches;
- exactly one match places the edge. None, several (108 rows on published pages), a
  contradicting birth date or a committee conflict leave it unplaced, which means no line;
- a head edge lands on its committee's slate as a head member.

**Output.** One document per slate holding at least one placed edge, drafts included, party
lists included: 24,332 on 11-11, 5,867 of them touching a published page. Each carries the
fields of `ElectionSlates`, plus:
- `members`: `[{edgeId, personId, office, head}]` (koryta people per document: median 1, p90 3
  and at most 16 on voters' committees; up to 30 on party lists);
- `edgeIds`, and `regionIds`, the region nodes the members' edges point at;
- `export`, the export day.

Beside the documents it lists, for the job's summary, the unplaced edges by reason and the
slates where two koryta pages carry the same folded name.

Both pipelines go into `PIPELINES` (src/pipelines.py), neither `HELD` nor `EXCLUDED`, so the
night's reprocess rebuilds them.

### 4.6 Job koryta_slate_import

**Where.** `data/pipelines/src/jobs/slate_import/`, with the console script
`koryta_slate_import = "jobs.slate_import:main"` beside `koryta_score_import` in pyproject.toml.

**A run:**
1. Refuses unless the newest finished export was taken today at 04:00 Warsaw time, or is the one
   `--export` names (`export_refusal`, as `people_import` does).
2. Reads `ElectionSlatePayloads` for that export day.
3. Folds its last complete sent part and compares: documents whose line appeared, disappeared or
   changed party, count or years, and documents that would disappear.
4. Exits 1 and sends nothing when:
   - more than 200 existing documents would change their line;
   - more than 10% of the last run's documents would disappear;
   - a first run has fewer than 20,000 documents (24,332 on 11-11).

   `--accept-changes` lifts the first two, once the owner has read `--dry-run`.
5. Signs in through `stores/koryta_login`, as the other uploads do, and sends every document, at
   most 250 per request, under one `generation` (the run's start). 20 refusals in a row fail the
   run.
6. Sends `{generation, finish: {expected: N}}`. The site deletes older generations only if it
   holds N documents of this one.
7. After a successful finish, writes the write-once part
   `gs://koryta-pl-sharedcache/jobs/slate_import/sent/date=<day>/<run>.jsonl.gz` (slate id, line
   digest) and a run summary under `jobs/slate_import/runs/`, and reports through
   `stores/job_runs.py` to /admin/procesy.

**The summary** holds the documents sent and deleted; the lines by party; each line change by
slate id; the unplaced edges by reason; and the same-name pairs on one slate, by page id. It
never names a private person.

**Flags.** `--dry-run` prints counts and the first 20 changes and sends nothing.
`--accept-changes`, `--export <day>`, and `--endpoint` (default https://autopush.koryta.pl,
which writes production Firestore, as `people_import` does). `--max-minutes N` stops sending
after N minutes with exit 75; with no finish, nothing is deleted. `--explain <slate id>`
recomputes one slate from `PeoplePKW` and prints its members with the earlier candidacies that
counted and the links dropped as ambiguous: to the terminal only, on predator, to answer a
complaint. It writes and sends nothing.

**Exit codes** as `score_import`: 0, 75 (try later) or 1.

**Why a full send.** About 24,300 small writes a night cost about $1.5 a month at list prices
(an estimate: about 730,000 writes a month at $0.18 per 100,000, plus deletes).
Nothing has to stay in step with the collection, and a document that should go goes at the next
finish.

**/admin/procesy.** An entry `slate_import` in frontend/shared/jobs.ts: title „Komitety wyborcze
z PKW”; summary „Skład komitetów wyborców i osoby z koryta.pl z tych samych komitetów, do wierszy
kandydatur. Wysyła wszystkie komitety, z których kandydował ktoś z koryta.pl.”; runsOn „Ręcznie
koryta_slate_import na predatorze”, which the night-step change (§4.7) extends to „Krok nocy na
VM koryta-nightly (koryta_nightly), po ocenach; ręcznie koryta_slate_import”.

### 4.7 The night

In data/pipelines/src/jobs/nightly/__init__.py:
- **reprocess** builds both pipelines;
- **tests** runs the invariants of §4.8;
- **outputs** checks the `election_slates` entry;
- **a new step** `Step("slates", "komitety", 10)` after `scores`, with `step_slates` written like
  `step_scores`. In `why_not`, the tuple `("people", "scores")` gains `"slates"`, so the step
  needs tonight's export, a successful reprocess and checks with nothing newly failing. It does
  not need the people step: pages that step creates are placed the next night;
- documented in data/nightly/README.md and src/jobs/README.md.

The step comes after two clean runs by hand.

### 4.8 Tests and checks

Only checks that fail when the code is wrong go where a new failure holds the night's uploads
(`CHECKS`, `why_not_upload`). Reach moves with the export and the people import; the job's
guards and summary watch it instead.

**Unit tests** (`analysis/slates/test/`, invented names only):
- identity: links at ±1 but not at ±2 or in another powiat; a sejmik run by residence; a sejmik
  run with no residence within the województwo; a middle-name conflict blocks and a missing
  middle name does not; both ambiguity drops, including two namesakes on one slate;
- evidence: same-year, later and older-than-10-years runs do not count, nor does „Inne”; a
  coalition counts for each party; an earlier head run counts;
- the line: none at n 9, at k 2, at 5 of 18, on a tie, on a mapped committee whose name starts
  with „kww”, on a national or other committee; a line at 3 of 10 and at 6 of 20; a second party
  at exactly 3 of 15; `SUPPRESSED` gives reason `suppressed`; the table lists a joint list once;
- years: 2024 gives 2014 and 2018; 2002 gives 1998;
- the slate id is stable and independent of row order; `unit` and `slate_id` read back as
  strings (`test_pipeline_identifier_dtypes`).

**Payload tests** (`analysis/tests/test_slate_payloads.py`): strict placement; relaxed placement
on a unique candidate only; namesakes on one slate left unplaced; a contradicting birth date left
unplaced; a head edge on its committee's council slate; a document for every slate holding a
placed edge, party lists included; `regionIds`; the day-named filename.

**Night invariants** (`src/tests/pipelines/test_election_slates.py`), with no reach bands:
- every line meets the rule, sits on a `voters` committee and counts runs within 10 years
  before;
- `RULE` equals `SLATE_RULE` in frontend/shared/electionSlates.ts, parsed from the file;
- two to five canary slates keep their party, count and size. Their ids are read at test time
  from a private file outside the repository (a slate id decodes to a real committee, place and
  year); the check is skipped where the file is absent, and the night VM holds it;
- the namesake budget: rule F applied inside one local election (2024 councils) links at most
  0.10% of candidates (measured 0.064%). A widened block fails it with no labelled data.

**Outputs.** baseline.json gains `election_slates`, with `rows` from an observed run
(`KORYTA_E2E_UPDATE_BASELINE=1`) and `non_null` on `slate_id`, `unit` and `committee_class`. It
depends only on `PeoplePKW`. The day-named payload output gets no entry, like the export frames.

**Job tests** (`jobs/slate_import/tests/`): chunking, the generation, finish, the export refusal,
each guard, `--dry-run` sending nothing, `--accept-changes`, the sent part written only after
finish.

**Site tests:**
- `tests/shared/electionSlates.test.ts`: the strict schema; the copy builders of §6.2 for every
  party's genitive, one and two years, the head sentence, the second party, the
  `polishCounting` forms, the office qualifiers, „szkic”, the PKW-committee sentence and the
  rounding; no banned word and no en or em dash in any output;
- `tests/server/api/ingest/slates.test.ts`: datascience only, the 250 cap, whole-document
  writes, finish refusing on a short count and deleting only older generations;
- `tests/server/api/nodes/slates.test.ts`, in the style of the successions and declarations
  tests: whom a logged-out reader is named, a draft subject page answering 404, a contradicting
  edge dropping its row, a merged page keeping its lines, a rule mismatch dropping the line,
  `SLATES_PUBLIC` false answering logged-out readers with nothing;
- `tests/rules`: `electionSlates` denied both ways.

## 5. Delivery to the site

### 5.1 Store

A Firestore collection `electionSlates/{slateId}` in the koryta-pl database:

```
{
  schema: 1, rule: "F1",
  slateId: "2024-123456-0a1b2c3d4e", year: 2024, unit: "123456", unitName: "Przykładowo",
  council: "Rada gminy",                       // or null: no council list
  committee: "KWW PRZYKŁADOWA WSPÓLNOTA", cnorm: "kww przykładowa wspólnota",
  class: "voters",                             // "party" | "national" | "voters" | "other"
  size: 27,                                    // or null
  line: { party: "PSL", count: 9, years: [2014, 2018] },   // or null
  second: { party: "PO", count: 6 },                         // or null
  parties: [ { parties: ["PSL"], count: 9 }, { parties: ["PO"], count: 6 } ],  // or null
  reason: "line",
  members: [ { edgeId: "...", personId: "...", office: "Rada gminy", head: false } ],
  edgeIds: [ "..." ], regionIds: [ "teryt1234" ],
  export: "2026-11-11", generation: "2026-11-11T05:12:00Z"
}
```

- **Rules.** `match /electionSlates/{slateId} { allow read, write: if false; }` in
  firestore.rules, beside the declarations blocks. It documents the default deny and rides the
  next rules deploy.
- **Indexes.** None new: `array-contains-any` on `edgeIds`, `array-contains` on `regionIds` and
  equality on `generation` all use automatic single-field indexes.
- **Size.** 1-3 KB a document, 24-73 MB in all.

### 5.2 Ingest: POST /api/ingest/slates

`frontend/server/api/ingest/slates.post.ts`, modelled on `/api/ingest/declarations`:
1. `requireDatascience(await getUser(event))` runs before the body is read.
2. A `.strict()` zod schema in `frontend/shared/electionSlates.ts` refuses unknown keys. A
   non-strict schema drops them silently and still answers 200, the trap `shared/api.ts` warns
   about.
3. One of two bodies:
   - `{generation, slates: [1..250]}`: each document is `set` whole under its fixed id, in
     batches; the answer is `{written}`;
   - `{generation, finish: {expected}}`: a `count()` of this generation; if it equals
     `expected`, documents of other generations are deleted in pages and the answer is
     `{kept, deleted}`; otherwise the answer is 409 with the count, and nothing is deleted.

No revisions: the data is derived, as for votes and declarations.

### 5.3 Read: GET /api/nodes/[id]/slates

`frontend/server/api/nodes/[id]/slates.get.ts`, wrapped in
`editorFreshCachedEventHandler(handler, { name: "slates", editorMaxAge: 600 })`
(server/utils/handlers.ts). Logged-out answers are cached 6 h per URL. Signed-in answers are at
most 10 minutes old: `latest=true` rides on every signed-in request, and handlers.ts recommends
`editorMaxAge` for aggregates like this one.

1. `resolveMergedNode(id)`. Not a person: 404. A logged-out reader and `!pageIsPublic(person)`:
   404, which Nitro does not cache, so a newly published page shows at once. A logged-out reader
   while `SLATES_PUBLIC` is false: `{rows: {}}`.
2. The person's election edges: `edges where source == id and type == "election"` (the existing
   (source, type) composite). Keep live edges with a local office, „Samorząd” or none; for a
   logged-out reader, published ones only.
3. The documents: `electionSlates where edgeIds array-contains-any <up to 30 ids>`, one query per
   30 edges. Edge ids survive a page merge (`applyNodeMerge` rewrites the source in place), so a
   merged page keeps its lines the same day.
4. For each of the person's edges in a document, the live edge must not contradict it: the same
   year; the same office, unless „Samorząd” or none; the same committee key where the edge
   stores one. A contradiction drops the row. A page with a council row and a head row on one
   slate gets the lines on the council row only.
5. The make-up is kept when `class == "voters"`, `rule == SLATE_RULE` and `line` is set.
6. **Mates**, on every local row (voters' committees and party lists, the owner's call on
   sklad-listy-r1): a `getAll` of the other members' edges, then of their current source nodes.
   A mate is kept when the edge exists, is not deleted and does not contradict the slate, and the
   node is a live person page with a name that is not the subject; for a logged-out reader, also
   `pageIsPublic(node)` and `edge.published === true`. A mate whose folded name equals the
   subject's (a likely duplicate page) is dropped. One entry per person, offices merged; the
   head candidate first, then by surname in Polish collation; the person's parties come with
   each entry, so the row can show only the ones that differ from a party list's own.
7. The answer is `PersonSlates`, with an empty `rows` when there is nothing to say.

**Contract** (`frontend/shared/electionSlates.ts`):

```ts
export const SLATE_RULE = "F1";      // equals RULE in data/pipelines/src/analysis/slates/rule.py
export const SLATES_PUBLIC = false;  // flipped by one commit after the launch check

export interface SlateLine {
  party: string;          // a site party, never "Inne"
  count: number;          // k
  size: number;           // n
  percent: number;        // floor((200k + n) / 2n), never under 30
  years: number[];        // [2014, 2018]
  council: "Rada gminy" | "Rada miasta" | "Rada powiatu" | "Sejmik" | "Rada dzielnicy";
  table: { parties: string[]; count: number }[];   // the opened table, a joint list once
}
export interface SlateMate {
  personId: string;
  name: string;
  parties: string[];      // the mate's page parties, as the row shows them
  office: string;         // the mate's office on this slate
  draft: boolean;         // page or candidacy unpublished; signed-in readers only
}
export interface RowSlate {
  slateId: string;        // the list page's address (§9), once it exists
  committee: string;      // PKW's spelling, for the rail head
  line: SlateLine | null;
  mates: SlateMate[];
  pkwCommittee: boolean;  // the edge stores no committee: the head is PKW's name
}
export interface PersonSlates { rows: Record<string, RowSlate> }  // keyed by the person's election edge id
```

**Client.** `usePersonSlates(personId)` in `frontend/app/composables/personSlates.ts`, modelled on
`usePersonSuccessions`: `latest` in the query, not awaited, called only when the page has a local
candidacy row and, before the flip, only for a signed-in reader. An error gives an empty map, and
the rows render without the rail.

### 5.4 Reads and writes

| | Cost |
|---|---|
| An uncached view, voters' committees only, over the 2,418 published pages | the lean design's estimate, not reproduced by the fact-check: median 8, mean 10.7, p90 23, max 100 reads; pages with a voters'-committee document: median 14, p90 31; pages without one: 3-5 |
| Naming mates on party lists too | two reads per named mate (their edge and page); distinct contest-level mates per published page: median 1, p90 8, max 24 |
| For comparison, the history request | median 16 |
| Logged-out readers | at most one uncached call per page per 6 h |
| Signed-in readers | at most one per page per 10 minutes |
| A night | about 24,300 document writes, one count, tens of deletes: about $1.5 a month; the first load costs the same |
| Never | edge, node or revision writes; Functions triggers; the people step's caps |

### 5.5 Failure modes

| Event | Effect |
|---|---|
| The night skips the step, or the job fails | yesterday's documents stand: a day old, consistent |
| A run dies between chunks | no finish, so nothing is deleted; the next run completes it |
| An output collapses, or the key derivation changes | the deletion and change guards stop the job before it sends |
| A map, PKW or rule change | the change guard stops the job; the owner reads `--dry-run`, then runs it with `--accept-changes` |
| The rule changes on one side first | the endpoint drops lines whose rule differs from the site's until both agree |
| The endpoint fails | rows render without the rail |
| An edge edited during the day | the live check drops a contradicting row |
| A mate withdrawn or deleted during the day | the live check stops naming them |
| A page merged | its edges keep their ids, so its rows keep their lines |
| Placement is ambiguous | the edge is not placed: no line |
| A wrong line is reported | `--explain` on predator, then a rule fix, or the slate id in `SUPPRESSED` |

### 5.6 Deploy order

1. **Site:** `shared/electionSlates.ts` (`SLATES_PUBLIC` false), the ingest, the read endpoint,
   the jobs.ts entry and the rules block. Merge to main (autopush), then a prod rollout. Nothing
   visible.
2. **Pipelines and the job:** merge to main.
3. **First runs by hand on predator:** `koryta_slate_import --dry-run`, then a real run against
   autopush, which writes production Firestore. Check about 24,300 documents, about 600 of them
   with a line (PSL 161, PiS 151, PO 146, SLD 143, BS 1; the national 1,568 counts committees
   with no koryta candidacy too), and a few appendix rows through the endpoint, signed in. A second run the next day reports about zero line
   changes.
4. **The night step.**
5. **The UI**, after the board's OK, for signed-in readers.
6. **The launch check**, then the commit that flips `SLATES_PUBLIC`. Logged-out readers see it
   within one cache window.

The site always deploys before anything sends to it, and the UI only reads an endpoint that
already holds data.

## 6. Display contract

What shows, when, and in which words is fixed here. The look is variant E from design-board
rounds sklad-listy-r1 (picked) and sklad-listy-r2 (folded by default, party colours, the list-page
link; approved 2026-11-11). The approved r2 capture becomes the visual spec of the build.

### 6.1 What shows, and when

**The rail** shows under a person page's election row when the row is a local candidacy (a
council, a head office, „Samorząd” or none) from 1998, its edge is placed on a slate, the live
edge does not contradict the slate, the reader receives the row (logged out: a published edge on
a public page; until the flip, signed in only), and at least one of the two facts below holds.
A row with neither keeps today's meta line, with the committee cut to one line by
fb10-wiersze-powiazan-nizsze.

**The make-up** shows on a `voters` slate with a line, under the site's rule. On a head row it
describes the committee's council slate in the same unit (22 of the 126 visible rows).

**The people** show on any local row with at least one mate this reader may be named (§7).

**When.** The morning after the job first sees the edge. A newly published page shows them on its
first uncached view, since drafts are already in the documents.

**Never:**
- the make-up on rows of `party`, `national` or `other` committees;
- anything on Sejm, Senat or PE rows (no okręg is stored);
- in PersonTeaser, ShortNode or the graph;
- a zero, a negative or an absence („0 z 31”, „brak powiązań”, „komitet bezpartyjny”).

### 6.2 Exact copy

Placeholders are in braces; plain hyphen only. Every string is built and tested in
`frontend/shared/electionSlates.ts`. These are the strings of round sklad-listy-r2, which the
owner approved.

**The rail, closed (the default):**

| Line | Text |
|---|---|
| Head | PKW's committee in its short form: „KOMITET WYBORCZY WYBORCÓW” shown as „KWW”, „KOMITET WYBORCZY” as „KW”, „KOALICYJNY KOMITET WYBORCZY” as „KKW”; one line with an ellipsis, the full name in `title`; a link to the list page (§9) with „›” once that page exists, plain text before |
| Make-up | „{k} z {n} ({p}%) kandydatów tego komitetu startowało {w latach Y1-Y2 / w Y} z list {P}”, the counts and {P} in bold, then the (i) and „wszystkie partie ▾” |
| People | „Z tego komitetu {do rady / do sejmiku / do rady dzielnicy} na koryta.pl: {A} · {B} i {m} innych ›”, the names as links to their pages, the overflow linking to the list page (before the page exists, „i {m} innych” is text with every name in `title`) |

**The rail, opened** („wszystkie partie ▾” pressed; the people line does not open in place):

| Part | Text |
|---|---|
| Only when the edge stores no committee | „Komitet według PKW: {committee}.” |
| Caption | „W poprzednich wyborach samorządowych, najwyżej 10 lat wcześniej, z list partii startowało:” |
| One table row per party | the party's PartyChip, „{k} z {n}”, a bar in the party's colour, „{p}%”; a joint list once, with both chips and a bar split between the two colours |
| A head row's council | „Komitet wystawił do {R} {n} kandydatów.” above the table |
| Always, last | „Start z listy partii nie oznacza członkostwa w niej.” |

**Fill-ins:**
- {P}, in the genitive after „z list”: PO → „PO”, PiS → „PiS”, PSL → „PSL”, SLD → „SLD”, Razem →
  „Razem”, Nowa Lewica → „Nowej Lewicy”, Polska 2050 → „Polski 2050”, Konfederacja →
  „Konfederacji”, Nowoczesna → „Nowoczesnej”, Bezpartyjni Samorządowcy → „Bezpartyjnych
  Samorządowców”. A test checks that the table covers every site party but „Inne”.
- Years: „w latach 2014-2018” for two counted elections, „w 2018” for one.
- {R}: „rady gminy”, „rady miasta”, „rady powiatu”, „sejmiku województwa”, „rady dzielnicy”.
- {p}: floor((200·k + n) / (2·n)), never shown without „{k} z {n}”.
- {m}: the number of mates beyond those that fit the line; „innych” in every form.
- A mate who stood for the head office: „(na wójta)”, „(na burmistrza)”, „(na prezydenta)”. A
  draft, for signed-in readers only: „szkic” in the same brackets, or alone („(szkic)”).
- A mate's PartyChips follow their name, except, on a party list, the list's own party.

**The (i)** sits beside the make-up line, and the same text goes in the `#info` slot of
„Historia powiązań” (PageSection) when the page has a rail:
1. „Przy kandydaturze z komitetu wyborców podajemy, ilu kandydatów tego komitetu do tej samej
   rady startowało wcześniej z list jednej partii, według danych PKW. Liczymy starty w
   poprzednich wyborach samorządowych, najwyżej 10 lat wcześniej. Pokazujemy to tylko wtedy, gdy
   komitet wystawił do rady co najmniej 10 kandydatów, a z list tej partii startowało co
   najmniej 3 z nich i co najmniej 30% wszystkich.”
2. „Kandydata łączymy z jego wcześniejszym startem, gdy zgadzają się imię, nazwisko i drugie imię
   (jeśli podają je oba starty), rok urodzenia różni się najwyżej o rok, a oba starty są z tego
   samego powiatu. Przy sejmiku liczy się powiat zamieszkania, a w latach 1998, 2002 i 2014, w
   których dane nie podają miejsca zamieszkania, województwo. Pomijamy starty, których nie da się
   przypisać jednej osobie. Partie komitetom przypisujemy tak samo jak na stronach osób.”
3. „To informacja o komitecie, a nie o tej osobie. Start z listy partii nie oznacza członkostwa w
   niej. Brak tej informacji nie znaczy, że komitet nie miał związków z partiami: PKW nie podaje,
   do jakich partii należą kandydaci do rad, starty osób po zmianie nazwiska łączymy rzadziej, a
   partie założone niedawno mają mało wcześniejszych list.”
4. „Z tego komitetu na koryta.pl: osoby, których strona i kandydatura są opublikowane na
   koryta.pl, a które w tych samych wyborach kandydowały z tego samego komitetu w tej samej
   gminie, mieście, dzielnicy, powiecie lub województwie, do rady albo na wójta, burmistrza lub
   prezydenta. Nie znaczy to, że startowały w tym samym okręgu.”
5. For signed-in readers only: „Zalogowani widzą też osoby, których strony lub kandydatury nie są
   jeszcze opublikowane.”

The r2 render's (i) still counted same-year runs; rule F does not, and the text above is the one
to ship.

**Banned on these surfaces**, by a unit test over every builder's output, matched on whole words
(a `\b` boundary, so „10 z” and „startowało” pass): „członek” and its forms outside the two
caveat sentences, „działacz”, „partyjny” and its forms, „lista {partia}” for a committee,
„przybudówka”, „fasadowy”, „ukryty” and its forms, „w rzeczywistości”, „faktycznie”, „powiązany
z”, „bezpartyjny” about a committee, „brak powiązań”, a count of zero („0 z”), any en or em dash,
and the person-level verbs „startował” and „startowała” about the row's subject.

**qa.ts entry** (area "public", no names), added with the UI; the flip commit adds the logged-out
step:
- id `sklad-komitetu-przy-kandydaturze`, title „Skład komitetu przy kandydaturze”;
- description: „Pod kandydaturą z komitetu wyborców jest nazwa komitetu, a pod nią, gdy co
  najmniej 3 osoby i 30% komitetu startowały wcześniej z list jednej partii, ilu ich było; obok
  osoby z koryta.pl, które startowały z tego samego komitetu.”;
- steps:
  - „Otwórz osobę z kandydaturą z komitetu wyborców podaną w zadaniu - pod wierszem ma być nazwa
    komitetu i zdanie „... kandydatów tego komitetu startowało ... z list ...”.”
  - „Kliknij „wszystkie partie” - ma się rozwinąć tabela partii w ich kolorach, a przy
    kandydaturze bez zapisanego komitetu także „Komitet według PKW”.”
  - „Otwórz kandydaturę z listy partii, np. do sejmiku - nie ma tam być zdania o składzie, a mają
    być osoby z koryta.pl z tego samego komitetu.”
  - „Otwórz tę samą osobę w panelu na /eksploruj/tabela - wiersze mają być te same.”
  - after the flip: „Wyloguj się - lista osób ma wymieniać tylko osoby z opublikowanymi stronami i
    kandydaturami.”

### 6.3 Colour

The closed sentence names the party in bold ink text, never as a PartyChip: on this site a chip
beside a person reads as that person's party, and 31 of 126 lined rows name a party the person
does not carry. The opened table uses the parties' own chips and colours (`partyChipPaint`,
`partyColors` in shared/misc.ts): the owner asked for them on round sklad-listy-r1, so this one
element is an exception to the colour hold, by his decision, and is recorded in
`.interface-design/system.md` by him if he wants it there.

### 6.4 Phone and short rows

- The rail adds two lines where the make-up shows and one where only the people do. Against the
  fb10 baseline (the committee cut to one line) round r1 measured +49 to +71 px on a computer and
  +44 to +106 px on a phone for E; the owner picked E with those figures on the board.
- The committee is one line with an ellipsis; the make-up wraps to at most two lines on a phone;
  the people fold to what fits and „i {m} innych ›”.
- Links in the rail need the row restructured: the row stops being one anchor
  (`v-list-item :to`), and its title link stretches over the row with `::after`, so the rail's
  names and links sit beside it rather than inside it. That touches every history row and also
  makes today's sources, edit and remove buttons valid HTML (they are buttons inside an anchor
  now). The keyboard focus ring moves to the title link's `::after`.
- The rail's left rule follows the redesign's „Wcześniej:” rail; that rule is the held sage
  treatment, and the rail takes whatever the palette decides for it.

## 7. The same-committee line

- **It crosses offices.** A council candidate and the committee's head candidate in the same unit
  are mates. That is the pairing the owner records by hand: 5 of the 7 hand-made list edges point
  at the person the committee is named after, mostly its head candidate. 45 visible
  voters'-committee rows have such a mate.
- **Every local row, party lists too.** The owner kept the line on a party sejmik row on
  sklad-listy-r1 („highlight which other person was also on this list that we have published”).
  On a party list the row shows a mate's chips only where they differ from the list's party, so
  the people who also carry another stand out.
- **No full list in place.** Opening every name on the row was „TMI on this page” (owner,
  sklad-listy-r1): the row names what fits and links the rest to the list page (§9).
- **Names only of pages this reader may see.** No count of unpublished mates on the row.
- **„Komitet”, not „lista”**, unless the owner decides otherwise: the slate spans every okręg
  (decide-komitet-or-lista-on-the-candidacy-row). The list page may still be called „lista”: it
  is the committee's numbered list in that council, split by okręg.

## 8. The hand-made edges

- Seven connection edges name a shared list, 3 of them published: „razem na liście w 2024”,
  „dwa razy na tej samej liście” and „startował na jego liście” (published); „wspólna lista”
  twice, „Komitet wyborczy” and „kolega z listy” (drafts). Five point at the person the committee
  is named after, usually its head candidate.
- **They stay as they are.** They are authored edges, which no merge touches. Nothing here
  creates, migrates or deletes a connection edge.
- **On 11-11 none of the seven pairings reaches a logged-out reader through the row:** in each, a
  partner's page or candidacy edge is a draft, or a partner stores no candidacy. Signed-in readers
  can see up to five, marked as drafts.
- **When both apply, both show:** the edge under „Osoby”, and the name in the rail. The authored
  relation and the PKW record are different facts, and the rail confirms the edge. Whether to keep
  recording them by hand once the rail ships is a question on round sklad-listy-r2.

## 9. The committee's list page (step 2)

The owner on sklad-listy-r1, on a party sejmik row opened to every person from its committee:
„This should be on a dedicated page for the given lista - mirroring PKW behaviour but with a
unified UI for each year. TMI on this page.”

**What it is.** One page per slate, addressed by slate id, reached from the rail's committee head
and its „i {m} innych ›”, and from the region pages' lists (§11). It mirrors what PKW publishes
about one committee in one council, in one layout for every year from 1998 (PKW's own sites
differ election by election):
- the committee, the council, the unit and the election, with a link to PKW's own page or file
  for that election;
- the make-up table (§6.2) when the rule holds;
- per okręg: the committee's list in PKW's order, with each candidate's position, name, votes and
  whether they won the seat; the head candidate apart;
- koryta people linked and marked, as the row marks them.

**What it needs.**
- The five `person_pkw` fields (§4.1): okręg, list number and position make the list a list; the
  committee type and PKW's signature tell local associations from party-like committees.
- The votes, a sixth field (about 28 MB), if the page shows them.
- The members of every slate it serves, from `PeoplePKW`, which `ElectionSlates` deliberately
  does not keep (§4.4). A list page needs them, so its store is its own decision: a per-slate
  member document beside `electionSlates`, or static files, sized for the slates with a koryta
  person (24,332) or for all of them (about 190,000).

**What it must decide first** (decide-committee-list-page-scope):
- **Who is named.** PKW lists every candidate by name. Mirroring it puts tens of thousands of
  people with no koryta page on a site about political appointees. Options: every candidate as
  PKW lists them, with the page out of search engines (`noindex`); koryta people by name and the
  rest as counts per okręg; or names for signed-in readers only. In every option the page shows
  no person's earlier party runs unless they have a published page: compiling those is
  political-opinion data (RODO art. 9).
- **Its address and owner.** `/lista/{slateId}` or a section of the region page. The region
  session already groups a region's runs into lists (§11); one of the two has to be the list's
  home, and the other links to it.

The page is its own design-board round, after the decision.

## 10. Fit with the person's own party statements

Branch pkw-party-statements (another session, 2026-11-11; tasks merge-pkw-party-statements,
carry-pkw-poparcie-onto-election-edges, show-popierana-przez-on-candidacies) does the person-level
half of the same question. The owner decided on 11-11 that a party's backing („popierany przez”)
counts as an affiliation, as a declared membership does, and that the page shows how each party
is known.
- **Two kinds of fact, two places on the row.** „Popierana przez X” and the person's party chips
  are about the person: they belong on the meta line, as show-popierana-przez-on-candidacies
  plans. The rail is about the committee. Neither borrows from the other: the rail never adds a
  party to the person, and the person's statements never count as the committee's make-up in
  step 1.
- **Shared parser later.** If a later rule counts declared membership as evidence, it uses that
  branch's `affiliations.py` table and no other.
- **The counts move.** After the merge, 115 published pages gain a party (mostly „Inne”), so the
  „Inne”-only and no-party figures of §2.3 change. The rail's reach does not.
- **One row, two rounds.** Both rounds change the candidacy row on the redesign's
  `card/EmploymentHistory.vue`; they are sequenced, and the second one re-renders the first's
  rows.

## 11. Fit with the region pages

Another session is building a page for every region (bookmark region-pages-person-runs, on
redesign-entity-pages, unmerged; whether region pages ship at all is
decide-whether-region-pages-merges):
- `/api/nodes/[id]/election-lists` reads the election edges filed under a region and groups them
  into „Listy wyborcze” by (election, folded committee), across offices (`groupElectionLists`,
  shared/electionLists.ts);
- it names unpublished candidates that an import wrote or a reviewer approved, with their parties
  hidden from logged-out readers (the owner's 2026-11-11 yes);
- the person page's candidacy row links to `/region/<slug>?osoba=<id>`, which opens on the
  person's runs there, each with „Kto jeszcze był na tej liście: N”.

How the two fit:
- **Different keys now, one source later.** Their key is the stored region (the powiat for gmina
  runs), the election and the committee. It merges 812 of 17,616 gmina-level keys, mostly on party
  lists, and every Warsaw dzielnica, and it leaves runs with no committee unlisted. The documents
  carry the PKW unit and `regionIds` for every slate holding a koryta candidacy, party lists
  included. Their endpoint can read `electionSlates where regionIds array-contains <region id>` in
  one query, split their lists by unit, place the runs with no stored committee, show the make-up
  under each voters' list heading, and use the slate id as the list's anchor or link to the list
  page.
- **No shared fold.** The person row joins by edge id, and so would the region page; nothing
  depends on their unmerged `committeeKey`.
- **Wording.** Their box says „na tej liście”, the row „z tego komitetu”. Decision
  decide-komitet-or-lista-on-the-candidacy-row settles both surfaces at once.
- **Different naming rules, on purpose.** The region page names unpublished pages without parties;
  the row names to logged-out readers only published pages; the make-up names no one.

## 12. Parity surfaces

| Surface | What happens | Step |
|---|---|---|
| Person page (`EntityDetailView`, `CardEmploymentHistory`) | the rail, through a `slates` prop keyed by edge id, like `predecessors` | 1 |
| /eksploruj/nowe | renders the same view: the same day | 1 |
| /eksploruj/tabela and /admin/notatki (`explore/NodeDrawer.vue`) | `usePersonSlates` wired by hand; the drawer already lacks `predecessors`, and this must not repeat that | 1 |
| Table election chips (`ElectionChips.vue`, `ElectionRich`) | the make-up in the tooltip, from a field built on the server | 2 |
| Region pages | read the documents by region (§11) | 2 |
| The list page | new (§9) | 2 |
| Company page | no candidacy rows | - |
| PersonTeaser | never: `shared/personTeaser.ts` carries no candidacy and no connection | - |
| ShortNode, the graph | nothing; branch co-candidate-edges should key its lines on slate ids, not on the stored region key | - |

## 13. Privacy and wording rules

- **Counts only for anyone without a published page.** The make-up names no one. The row names to
  logged-out readers only people whose page and candidacy are both published. Compiling a private
  person's party runs is political-opinion data (RODO art. 9), even though PKW publishes each run.
- **No member-level party data is kept where a reader or a bucket could hold it.** Links and
  evidence exist only inside the pipeline run; `ElectionSlates` holds counts; neither pipeline is
  backed up to the shared cache; `--explain` recomputes one slate on demand and prints it to a
  terminal.
- **Counts below the thresholds are never written**, so no count describes one person.
- **No per-member party lists for signed-in readers either**: anyone can sign in.
- **Every statement is about the committee:** the committee heads the rail, the sentence's verbs
  are the committee's candidates', the closed sentence names the party in text, and the count
  always comes with its denominator. Chips and colours appear only in the opened table, where every
  row is a party and none is a person.
- **The caveat travels with the number:** „Start z listy partii nie oznacza członkostwa w niej.”
  closes the opened table, and the (i) says why a line can be missing.
- **A wrong line can be withdrawn** by slate id from the next night (`SUPPRESSED`).
- **The line feeds nothing else:** no score, score explanation, queue, filter, auto-approval or
  person's parties (R8, §10).
- The question goes on the owner's legal-opinion task (legal-notice-and-opinion), with the list
  page's naming question.

## 14. Phasing

| Step | What | Visible result | Effort |
|---|---|---|---|
| 1a | `ElectionSlates`, `ElectionSlatePayloads`, the job, the ingest, the rules block, the read endpoint (`SLATES_PUBLIC` false) and all their tests; two runs by hand; then the night step | none: about 24,300 documents, kept current nightly | about 4 agent-days |
| 1b | the approved look (sklad-listy-r2): the rail on the person page, nowe and the drawer; the row restructure for links; the (i); the qa.ts entry; the visual spec and baselines | the rail for signed-in readers | about 2-3 agent-days |
| 1c | the owner reads the launch set (the appendix's 364 voters'-committee rows, a sample of party-list rows, a 20-row sample on autopush); one commit flips `SLATES_PUBLIC` | public | owner, about 30 minutes |
| 1d | four weeks later: use (opens of the table, clicks through), reports, suppressions, line changes, the „Inne”-only and no-party pages touched | a read-out that decides what step 2 builds first | half a day |
| 2 | the list page (§9) after its decision, with the five `person_pkw` fields; region pages reading the documents; the table's tooltip; optionally national runs from 2019 by residence powiat | | 4-7 agent-days, part of it in the region session |

## 15. Decisions

Each open one is a decision task with options, numbers and a recommendation.

| Task | Question | Recommendation | Blocks |
|---|---|---|---|
| decide-where-the-committee-numbers-live | a server-only collection, fields on edges, a migration plus the collection, or GCS files | the collection | 1a |
| decide-komitet-or-lista-on-the-candidacy-row | „komitet” or „lista”, on the row and on the region page | „z tego komitetu” on both; „lista” for the list page | 1b |
| decide-rows-without-a-stored-committee | show with PKW's committee named, wait, or store voters' committees on edges | show now; the edge fix as its own task | 1b |
| decide-committee-make-up-evidence-defaults | threshold, window, later runs, „Inne”-led lists, the person in their own k; and that the line never adds a party to the person | the defaults of §4.3 | 1c |
| decide-committee-list-page-scope | whom the list page names, `noindex`, its address, and whether it or the region page is a list's home | every candidate as PKW lists them, `noindex`, no party runs for anyone without a published page, `/lista/{slateId}` linked from the region page | 2 |
| decide-who-the-committee-rail-names | a mate needs a published page, or also a published candidacy; naming an unpublished head candidate; the 7 hand-made list edges | page and candidacy published for logged-out readers; drafts only for signed-in readers, marked „szkic”; keep the edges | 1b |
| decide-whether-committeeparties-and-peopleparties-retire | the old PageRank party inference in analysis/graph.py | retire both, separately | nothing |

Settled on the board (sklad-listy-r1 and -r2, 2026-11-11): the look (E, the committee heads a
rail, folded by default); the table in party colours; the people on party lists too, with
differing chips only; no full list in place, a list page instead. Left unanswered on the board,
now decision decide-who-the-committee-rail-names: whom a row counts as a mate (a published page,
or also a published candidacy), whether a row ever names a head candidate without a published
page, and whether the hand-made list edges stay. Proposed for `.interface-design/system.md`, which
only the owner writes: task record-the-committee-rail-decisions-in-system-md.

## 16. Risks

- **A missing line read as „no party ties”.** Of 719 2024 committees whose own mayoral candidate
  declares a party, 123 get a line; none of the 24, 23, 6 and 4 committees of Polska 2050,
  Konfederacja, Razem and Nowoczesna mayors does, and parties younger than the window cannot
  appear at all. The (i) says so, and nothing is ever printed below the thresholds.
- **The party read as the person's.** 31 of 126 rows (30 people) name a party the person does not
  carry, 8 of them for people with no party. Hence the committee heading the rail, the committee-level
  sentence, the party as text on the closed row, and chips only in the opened table.
- **Chance flags in small committees.** About 16% of flags at n 10-19 are what chance gives under
  the looser model, and 30 visible rows sit in that band. The count stays true; its notability may
  not be.
- **Undercounting.** Women link at 28.8% against 43.1% for men (surname changes); 1998's thin
  middle names weaken 2002; the 10-year window has a cliff; national runs are left out. All stated
  in the (i) or listed for step 2.
- **A map, PKW or rule change flips public lines.** „kkw lewica” maps to SLD, so 2024 Lewica runs
  would read SLD on 2029 committees; the 5 lined 2024 committees of declared Nowa Lewica mayors read
  SLD today, from 2018 lists. The change guard and `--dry-run` put every such flip in front of the
  owner, and the rule id keeps the (i) honest. The mapping decisions stay the owner's.
- **Mapping conventions leaking in.** Nowa Prawica maps to Konfederacja; the national class keeps
  the one line it touched off the site, and no new mapping rule is added.
- **Two groupings until step 2.** The region page's key merges 4.6% of gmina-level keys and the
  dzielnice, so a row can name fewer people than the region page lists. The wording differs until
  the region page reads the documents.
- **The list page exposes people without pages.** Its naming decision (§9), `noindex`, and no
  party runs for them.
- **Deletion by mistake.** The first-run floor, the deletion guard and the completeness check
  before any delete.
- **Staleness.** Membership is one night behind the export; every name and row is checked live.
- **Privacy and defamation.** Counts only; published names only; the caveat beside the number;
  `SUPPRESSED`; the question added to legal-notice-and-opinion.
- **Duplicate pages naming a person as their own mate.** The region session reports 1,099 names on
  two pages of one list (its count, not reproduced here). Same-name mates are dropped, and the pairs are listed for the duplicate
  check.
- **Competition for the row.** fb10, the losses chip, „popierana przez” and the redesign stack
  want the same row; the rail keeps the committee's facts off the meta line, and the rounds are
  sequenced on the redesign card.
- **Tidying the 2024 committee strings** would change every 2024 slate id and candidacy edge
  identity: a migration only.

## 17. What not to build

- Fields on election edges: no make-up, mates, mate ids or slate id; nothing through the person
  ingest or under `--max-published`. Annotations are written once, so values would freeze, and
  1,770 pages would take 177 nights.
- Lists inferred at read time from the stored edge key: wrong for 773 of 2,374 mate rows, at a
  median of 119 reads.
- A list of every member's earlier party runs, on the row or the list page, for anyone without a
  published page; member-level evidence in Firestore or the shared cache; per-member party lists
  for signed-in readers.
- Make-up lines on party, national or other committees, below the thresholds, on ties, where
  „Inne” leads (759 lists; a historical label map is undecided), or from later runs (a „później”
  line: 46 rows that would move at every election).
- A percentage without its count; any zero, negative or absence statement.
- A PartyChip or a party colour for the share on the closed row; a composition bar on the row.
- Any use in scores, score explanations, queues, filters or auto-approval; setting a person's
  `parties` from a line.
- `people_pkw_merged` clusters, `CommitteeParties` or `PeopleParties`, the scratch membership
  normaliser, a second membership table beside `affiliations.py`, the parked `party_bloc.py`; any
  new party-mapping rule.
- Pre-2019 national runs, same-year or later runs, a {0, +1} window, a województwo or nationwide
  block.
- Changes to `person_pkw`'s 2024 committee strings without a migration.
- Any change to the 7 hand-made edges.
- Reach budgets in src/tests/pipelines, or enforced row bands on an output that depends on the
  export.
- A dependency of step 1 on pkw-party-statements or on the five fields.
- Sending before the ingest is deployed; deleting without the completeness check and the guards.
- Real names in fixtures, tests, qa.ts or commit messages, and real slate ids in the repository:
  canaries live in a private file.
- An admin UI for hiding lines, or scheduled review loops: one launch check and one read-out are
  enough.
- A promise on the site of a full list before the list page ships.
- En or em dashes in any copy.
