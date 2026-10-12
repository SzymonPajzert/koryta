# Kinship and partial-surname hypotheses

Status: design, 2026-10-12, against main 09a31cbd. Line references are to that
commit and drift; function names are the stable part.

This document names no private person. Its examples are invented
(„Nowak-Przykładowa”) and match no real record. The real cases that prompted
it are kept outside the repository, because this repository is public.

Owner's rules referred to below:
- **(R1)** two rejestr.io entries are never one person;
- **(R2)** a PKW record that nothing contradicts is attached to every person it
  fits, and reviewers reject on the page;
- **(R3)** published means reviewed by a person;
- **(R4)** pipelines are stateless, and jobs keep state as write-once parts;
- **(R5)** anything producing a data artifact is a registered pipeline;
- **(R6)** every open decision is a task.

## 1. Summary

The system produces machine-made **hypotheses** of two kinds. A hypothesis
becomes a public fact only after a person has confirmed it.

1. **"This PKW candidate may be this person, even though only half of the
   surname agrees."** For example, the register writes Anna Nowak and the
   ballot NOWAK-PRZYKŁADOWA Anna.
   - `PeopleMerged` gets a second matching tier for surname parts.
   - Matches that pass a gate are sent as **draft candidacies marked
     `pkw_match: "surname_part"`**. This is the "mark it during the upload":
     admins see a chip saying the match rests on half the surname, with the
     PKW spelling, and publish or remove the candidacy as today.
   - Matches below the gate stay in a private evaluation output, which the
     owner can read.
   - Measured: without a gate, 14% of these candidacies belong to the person.
     With gate E it is about 95%: 373 distinct (person, candidacy) pairs for
     239 people, about 130 of whom have no PKW candidacy at all today.
2. **"These two people could be family."** A private pipeline ranks pairs of
   one koryta person with a job (the *anchor*) and one person who stood for or
   holds public office (the *relative*).
   - The pair must share a surname part. The ranking weighs how rare the
     surname is, where both people are, a shared board and a shared local
     list.
   - The pairs are **not edges**. Draft edges are not private storage on this
     site, so a "possible family" edge would publish the guess.
   - They live in private job output (K1), and later in an admin-only
     `hypotheses` collection with its own queue (K2).
   - Confirming one writes a published `connection` edge with a relation and
     a cited source, in one admin act.
   - A first research batch of 40 pairs measures how often the leads hold up.
3. **Prerequisites:**
   - a correct surname-rarity table (`SurnameRarity`, §4.1);
   - CI that publishes no personal pipeline data (S0, §7);
   - the partial tier deployed fail-closed (§5.1).

## 2. Measured baseline

Measured 2026-10-12 on the 10-02 register (`people_krs_merged`, 140,123 rows),
today's export (10,836 person pages) and `person_pkw` (1,947,995 candidacy
rows). The unit is **one candidacy row**. A *PKW record* is the cluster of
rows `PeoplePKWMerged` groups as one person.

**Precision** is 1 − chance/real:
- "Chance" is the same join with PKW birth years shifted to [2,4] and [−4,−2],
  ×1.061.
- The ×1.061 was calibrated on same-surname namesakes whose middle names
  contradict, and checked on partial matches whose middle names contradict:
  1,255 real against 1,218 chance.

**The bar is today's exact join:**

| exact join | precision |
|---|---|
| all candidacies | 0.67 (register 0.66, pages 0.81) |
| middle names agree | 0.99 |
| one side has no middle name | 0.57 |

### Partial surname, dated candidacies

**Rule:** the same first name; birth year within 1; `surname_key` differs; at
least one surname part shared. A contradicting middle name excludes.

**What separates right from wrong:**
- **Middle name:** agrees 0.77–0.93; silent 0.10; contradicts 0.03.
- **Place** (the employer's seat against the PKW candidacy or residence): same
  powiat 0.88–0.92; same voivodeship only ~0.25; elsewhere ~0.
- **Bearers of the shared part** (PESEL, both sexes summed): under 50, 0.92;
  50–500, 0.82; 500–5,000, 0.41; over 5,000, 0.07.

**Gates compared.** These counts add the register and the pages, so a page
with a register link is counted twice; distinct pairs are about 85% of these.
"Est. true" is real − chance.

| gate | candidacies | chance | precision | est. true | marginal over E |
|---|---|---|---|---|---|
| none | 5,135 | 4,396 | 0.14 | ~739 | |
| A: agree OR same powiat OR part < 500 | 672 | 151 | 0.78 | ~521 | +231 at 0.44 |
| C: (agree OR same powiat) AND part < 5,000 | 337 | 16 | 0.95 | ~321 | |
| **E**: part < 5,000: agree OR same powiat; ≥ 5,000: agree AND same voivodeship | **441** | **21** | **0.95** | **~420** | |
| E+: E OR (part < 500 AND same voivodeship) | 476 | 30 | 0.94 | ~446 | +35 at 0.74 |

**Gate E, distinct:** 373 (person, candidacy) pairs for 239 people. That is
366 register rows for 236 people, plus 7 rows for 3 pages with no register
row. About 130 of the 239 have no exact PKW candidacy.

**Gate E by shape and written position:**
- "Shape a" means one surname in the register and a double one in PKW.
- Position is where the shared part sits **as written**, e.g. Nowak is the
  first half of NOWAK-PRZYKŁADOWA.
- Real and chance counts are double-counted; the last column is distinct
  pairs.

| shape | real | chance | distinct |
|---|---|---|---|
| a, first written half | 122 | 0 | 103 (65 people) |
| a, second written half | 18 | 5.3 (0.71) | 15 (10 people) |
| b, register double, PKW single | 247 | 13.3 (0.95) | 211 |
| c, both double, one part shared | 54 | 2.7 (0.95) | 44 |

**Sub-cells:**
- The first-half cell with a silent middle name and the same powiat is 12/0,
  11/0 and 23/0 for parts under 50, 50–500 and 500–5,000 bearers.
- The second-half cell with a silent middle name and the same powiat is 5
  against 3.2, which cannot be told from chance.

**Other measurements:**
- **Undated national rows** (Sejm/Senate 2001+, EP) are chance, except with an
  agreeing middle name and a part under 5,000 bearers: 55 candidacies for 40
  people, 1.5 by chance.
- **Reversed doubles** (Nowak-Przykładowa vs Przykładowa Nowak): 26, 0 by
  chance.
- **1994 rows** use the old 7-digit TERYT codes, so 241 can never pass a place
  test.
- **The register side** was the 10-02 build, which predates the odpis-only
  people (6,475 on 10-09). Their precision is unmeasured (§8).

### Rarity

`NamesCountByRegion` takes `AVG("Liczba")` over the male and female rows
(`analysis/utils/names.py:41`), with no `sex` column. As a result:
- every surname written the same for both sexes is halved;
- -ski and -ska count as separate names;
- a double form below the source's cutoff of 2 bearers per voivodeship is
  absent. About 6.5% of PKW-2024 double surnames are in the table.

A missing surname scores as 50,000 bearers in `unique_probability`
(`analysis/people.py:52`): the rarest names are read as the commonest.

### Kin pairs

**The pool:**
- **Anchors:** 10,371 koryta people with a live `employed` edge.
- **Relatives:**
  - 160,260 PKW clusters: winners where PKW records a result, plus every
    Sejm, Senate, EP and sejmik list row;
  - 22,770 Wikipedia politicians;
  - 6,204 koryta pages with a party or candidacy;
  - other koryta employees (5,527 pairs).
- **Pairs:** 476,570, of which 471,043 have a politician relative. 538 share a
  part with ≤ 100 bearers.

**Place:** the finest overlap between {the anchor's employer seats, the
anchor's own candidacy and residence TERYT codes} and {the relative's
candidacy and residence TERYT codes, the relative's seats}.

**Labels: 66 claims,** 44 hand-made family `connection` edges and 22 in page
text.
- 10 share no surname part: in-laws, a married daughter or sister, a wife who
  kept her name, a partner, a typo, and two unexplained.
- 8–12 of the 44 edges (the counts differ by method) share only one half of a
  double surname.

**Recall:**

| score ≥ | pairs | claims found |
|---|---|---|
| 4 | 236 | 7 |
| 3 | 815 | 12 |
| 2 | 3,944 | 25 |
| 1 | 23,483 | 36 |

Within an anchor's list, the true relative is first for 33 claims and in the
top 3 for 47.

**Lift** (how much more often a feature appears among labelled pairs than
among all pairs):

| feature | lift |
|---|---|
| ≤ 20 bearers | 224× |
| 21–100 | 37× |
| 101–500 | 21× |
| 501–2,000 | 7× |
| > 10,000 | 0.44× |
| same gmina | 52× |
| same powiat | 9.5× |
| same voivodeship | 1.6× |
| no overlap | 0.16× |
| same company | 117× |
| same committee | 28× |
| double-surname link | 1.14× |

The ≤ 100-bearer, same-company and same-committee lifts rest on 2–4 labelled
pairs each; the rest rest on 7–27 of 72. The labels also lean towards pairs
inside koryta. **The weights built from these are priors, not measurements.**

**Earlier work:**
- a rare surname plus an official of the paying gmina: research confirmed 1
  in 20;
- the same surname on one board as a locally elected politician: 11 in 12;
- rare-surname kin matching, in the story-clusters work: about 51% false
  positives;
- a hidden-links placebo expected ~56 of 60, and research found 19 (+5
  maybe). **Placebos overstate kin precision by about 2.5×.**

**Other kinship signals that exist locally:**
- PKW, same local list and same surname: 42.5 pairs per 10k, against 11.1 on
  other lists in the same unit (2024);
- odpis surname history: 281 people with two or more surnames, 109 of whom add
  or drop half of a double surname;
- Wikipedia kin infobox fields: 393 politicians, 230 of them linking the
  relative;
- `personal_relation` article extractions: 694 kin facts, 83 with both ends on
  pages.

**Site.** The owner made 146 of the 153 hand-made connections, and the label's
direction is inconsistent: sometimes it names the source, sometimes the target.
Of 397 removed election edges, 383 were merge or duplicate clean-ups.

## 3. Concepts and data model

### 3.1 A partial PKW match is a marked draft candidacy

**On the edge.** A tier-1 candidacy is an ordinary draft `election` edge plus
one field, `pkw_match: "surname_part"`. The field is:
- neither a discriminator nor an annotation in `EDGE_SEMANTICS`
  (`frontend/server/utils/edges.ts:46`) or its mirror in
  `analysis/payloads/site.py`. As a discriminator, re-tiering would move the
  edge id; as an annotation, the mark would be written "approved" onto an
  exact candidacy;
- never copied from an incoming edge by `enrichedEdge` (`edges.ts:399`), which
  always keeps the stored value;
- served only in admin responses.

**Off the edge.** The PKW spelling, the cell and the committee go into
`matchNotes/{edgeId}`, an admin-only collection:
- `allow read, write: if false`;
- written only by the ingest;
- read only through `requireAdmin`;
- deleted when the edge is removed as a wrong match.

For a wrong match, these would glue a stranger's name, middle name and year to
a private person. For a right match, they reveal a maiden or married name that
nobody has reviewed.

The **committee** is held back while the candidacy is unpublished, because a
local committee is often named after the candidate. The first send after
publication fills it in.

**Keys:**
- A **candidacy key**: sha1 of (election type, year, 6-digit candidacy TERYT,
  folded PKW full name, birth year). It is built from public facts and
  survives a `person_pkw` rebuild and a split by place.
- A PKW record is identified by **the set of its candidacy keys**. Two records
  match when the sets overlap.

**Lifecycle:**
- **Draft (marked)** → **published**: confirmed. The mark stays.
- **Draft (marked)** → **removed**: rejected. Any removal of a marked edge is a
  verdict, unless its reason is „duplikat”, a merge clean-up or „wycofane
  automatycznie”. A verdict sticks (§5.2).
- **Draft (marked)** → **retracted**: soft-deleted by the pipeline with the
  reason „wycofane automatycznie” when the candidacy no longer qualifies. It
  is restored as a draft if the candidacy qualifies again.

### 3.2 A kin hypothesis: "A and B could be family"

**What it is.** An undirected claim with no relation label until a person gives
one. The machine never guesses "wife", because that is a sharper claim than
"could be family" and it would anchor the reviewer.

**Ends.** Each end is a set of keys:
- `node:<id>`
- `rejestrio:<id>`
- `wiki:<page id>`
- `pkw:{candidacy keys}`

An end never holds a PESEL fingerprint or anything derived from one.

**(R1) applies to ends:**
- An end carries at most one `rejestrio:` key. A cross-source join that would
  give it two is refused.
- Two ends with different `rejestrio:` keys never share a hypothesis id or a
  verdict.
- A pair that may be one person is excluded from kin, never merged: 573 pairs
  by full name, and 175 by half a surname.
- A confirmation never travels through an undated `pkw:` key, because undated
  keys pool namesakes such as a father and son.

**Id:** `kin_` + HMAC-SHA256, under a secret kept outside the repository, of
the sorted primary keys. The secret stops anyone who sees an id from
confirming a guessed pair by hashing it.
- **Primary key:** `rejestrio:` where one exists, else `node:`, `wiki:`,
  `pkw:`.
- **The anchor's `node:`** is resolved through `merged_into` tombstones, so a
  verdict survives a duplicate-page merge.
- **Verdict matching:** a verdict records every key seen on both ends. A later
  pair is matched to it on any overlap that does not cross two different
  `rejestrio:` keys.

**Fields:**
- both ends' keys, display names, birth years, offices and places;
- the shared part and its bearer count;
- place level, same company, same local committee, age gap;
- the score, with its term breakdown and version;
- evidence, as citations of records;
- stratum, `status`, and
  `verdict {by, at, decision, relation, sources[], reason}`;
- `promotedEdgeId`.

**Lifecycle:**
- `generated` → `selected` → `researched`. Research gives one of `kin` (with
  relation, quotes and URLs), `tie_not_kin`, `unconfirmed` or `refuted`, and
  separately whether the relative's identity is confirmed.
- → **confirmed** by the owner with a source → a published `connection` edge
  carrying `hypothesis_id`.
- → or **rejected**, which is sticky. Removing a promoted edge with any reason
  except „duplikat” also rejects.
- **Stale:** an open hypothesis that is absent from 3 consecutive generator
  runs leaves the queue.
- An `unconfirmed` pair is eligible for research again when its score gains a
  new feature.
- **Rejected:** after 90 days a rejected hypothesis is reduced to a tombstone
  (id, keys, verdict, date).

**Where it lives:**
- K1: the private pipeline output and the write-once parts of
  `jobs/kin_research/` in `koryta-pl-sharedcache`.
- K2: also a Firestore collection `hypotheses` (`allow read, write: if false`),
  read through `requireAdmin`.
- Never in `edges`, `revisions`, `nodes`, notes, comments, feedback or `audit`
  before promotion. Verdicts write only the id to `audit`.

### 3.3 Why a kin hypothesis is not an edge before confirmation

The request was to "create an edge: they could be a family". A draft edge is
not private on this site:
- signed-in accounts see drafts by design, and sign-up is open;
- the revision history is not access-controlled per edge.

The site already has a model for unreviewed machine claims about named people:
`extractions`. Its Firestore client access is limited to `datascience`, and a
person promotes a claim into a `connection`. Its API text still needs the same
admin gate (K0).

The admin queue (K2) can draw a hypothesis as a dashed „możliwa rodzina” link.
That is an edge in the UI, not in `edges`.

## 4. Generation

### 4.1 `SurnameRarity` (new pipeline)

**Input:** the two PESEL CSVs `NamesCountByRegion` reads.

**Output:** `(key, key_type, voivodeship, count_m, count_f, count, count_upper)`.
- `key_type` is `form`, `family` (-ska/-cka/-dzka folded into -ski/-cki/-dzki)
  or `part`.
- `part` splits on space, hyphen and en dash, folds gender, and drops
  particles (vel, von, de, van).
- A form missing in a voivodeship may have one bearer there. `count_upper`
  adds those, and scoring uses it.

**Nightly:** rebuilt every night, not held. It reads two CSVs. A held pipeline
keeps what is on disk, or what it restores from the shared cache when nothing
is (`jobs/nightly/__init__.py:152-167`), so later fixes would never reach the
night.

**Left alone:** `NamesCountByRegion` and `unique_probability`. Repointing
`unique_probability` at the new table is its own measured change.

### 4.2 Tier 1 inside `PeopleMerged`

The tier is a CTE beside `pkw_candidates` (`analysis/people.py:326`). Its rows
are keyed by `krs_row`, which exists only inside that query (`:243`).

**The `pkw_partial` CTE** is an equi-join on (first name, surname part of 4+
letters), unnesting `string_split(surname_key(last_name), ' ')` on both sides.
An `OR` in the existing predicate (`:373-383`) would turn the hash join into a
nested loop. A row is kept when:
- `surname_key` differs and a part is shared;
- the record was not emptied (`len(elections) > 0`);
- the existing middle-name predicate passes;
- the birth year is within 1, **or** PKW's year is null with an agreeing
  middle name and a part under 5,000 bearers. That last group is `held` until
  D2.

**The cell** is built from the PKW surname **as written**, never from a list
that went through `list_distinct` or `list_sort`; that once read the position
backwards. Its parts:
- shape: a, b or c;
- position: first or second;
- rarity band: the `part` key's `count_upper`;
- middle name: agree or silent;
- place: powiat, voivodeship or other. Place is the employer's seat from
  `Companies` (output `companies_merged`) against `teryt_candidacy` or
  `teryt_living`.

**Tiers:**
- **`attach`:** gate E, except shape a second half, and minus any cell D1
  holds.
- **`audit`:** shape a, second written half. It attaches per record only on an
  audit `same` (§6).
- **`held`:** A minus E, and the undated group above.
- **`below`:** everything else.

`held`, `below` and un-cleared `audit` rows are dropped before the query's
output. They are kept only in `PkwPartialEval`.

**Reversed doubles** join through the exact key, with the parts sorted on both
sides. They are tier 0.

**What `PeopleMerged` takes from tier 1:**
- **`pkw_match`** becomes exact `UNION ALL` attach.
- **Candidacy structs** are stamped through `struct_insert` with
  `surname_tier`, the candidacy key, and a private `pkw_spelling` (PKW surname
  as written, middle name, year, cell). Tier-0 structs get `surname_tier := 0`
  and nulls, so the lists union.
- **`pkw_attached`** (`:401`) becomes `every LEFT JOIN best`:
  - `best`, the record that names the person, comes from tier-0 rows only, so
    a half-surname record never supplies the PKW name, birth year,
    `kp_same_birth_year`, `unique_chance` or the `overall_score` bonus;
  - a person with only tier-1 matches keeps their candidacies, and those
    columns are null.
- **`pkw_records`** lists tier-1 records separately, labelled.
- **Tier 0 only:** `pkw_last_names` (`:432`) and the year-only Wikipedia guard
  in `wiki_kept` (`:485`). A half match never supplies the hyphen and never
  drops an article.

**Rejections are applied after the tier-0/tier-1 union** (§5.2), so a
rejected record cannot come back through tier 0.

### 4.3 Downstream of `PeopleMerged`

**Payload.**
- `Election` (`entities/composite.py`) gains `match` and `pkw_spelling`.
- `_extract_elections` (`analysis/payloads/person.py`) copies them.
- An unpublished tier-1 candidacy sends **no `committee` and no `party`**. The
  published state is read from `KorytaEdges`.

**Parties.** `parties_from_committees` (`payloads/person.py:902`) reads every
committee and checks no flag. It must skip elections that are `surname_part`
and unpublished. Otherwise a namesake's party lands in `parties`, and on a
published page the ingest approves that automatically.
`party_from_committee` keeps its meaning.

**Scores.** `Population` (`analysis/scores/base.py:415`) reads `elections` for
all seven models, and five of them use candidacies: capture, company,
pagerank, succession and turnover. Votes are world-readable. `Population`
drops `surname_part` candidacies whose edge is unpublished.

**Search.** The page keeps its name. Whether a confirmed half match adds the
ballot spelling as a search alias is D10.

### 4.4 Private evaluation pipelines

All of these are excluded on CI and from the night, nothing public depends on
them, and they use `backup_to_shared_cache=False`.

- **`PkwPartialEval`:**
  - the tier-1 join over all tiers, each candidacy in a published-state
    column;
  - the placebo windows, with a cell table (real against chance, no names);
  - the held rows the owner may add by hand.

  It runs weekly or on demand.
- **`PkwPartialAuditSample`:** the audit draw, with a fixed seed.

**`PkwAuditVerdicts`** is not private, because `PeopleMerged` reads it:
- it folds `jobs/pkw_audit/verdicts/` parts into (node id or sorted rejestr.io
  ids, candidacy keys, verdict), never a fingerprint;
- it returns an empty frame where the shared cache is unreachable, as on CI;
- it is never printed.

### 4.5 `FamilyCandidatePairs` (new, private)

**Inputs:**
- `KorytaPeople`, `KorytaNodes`, `KorytaEdges`;
- `PeoplePKW`, `ProcessWiki`, `PeopleKRSCombined`;
- `SurnameRarity`;
- `KinSeeds`;
- the verdict sources `KinResearchVerdicts`, `KinOwnerVerdicts` and (K2)
  `HypothesisVerdicts`. The owner's verdict wins over research.

**Universe (v1):** as measured in §2. Relatives who hold no office are kept,
because same-board pairs are the strongest signal. Whether such a tie may ever
be published, or even researched, is D5, and it is decided before batch 1.
Each widening (K3) is measured one at a time.

**A pair is excluded when:**
- the two may be one person;
- any `connection` joins them, live or removed;
- a verdict covers the pair.

**Score v1** is phase 1's rule with three changes:

| term | value |
|---|---|
| rarity | max(0, log10(5000 / count_upper)) |
| place (§2) | gmina +2, powiat +1.5, voivodeship +0.5, no overlap −1 |
| same company or co-owners | +2 |
| same committee | +1.5, only on gmina, powiat or mayoral lists, or for parts with ≤ 2,000 bearers |
| age gap 13–17 | −1 |

The changes:
- committees count only on local lists or for rare parts. 5 of 7 noisy
  mid-score pairs were lifted by big lists; 2 by a shared gmina on a common
  surname, which v2 addresses;
- the double-surname bonus is dropped (1.14× lift);
- the over-45 penalty is dropped.

**Score v2,** computed beside v1, conditions place on the surname's own
spread. The chance that two bearers share a unit is Σ_unit share_unit(s)².
Batch 1 decides between v1 and v2.

**Bands**, re-counted under v1 in `FamilyHypothesesEval` (phase 1's sizes are
236 and 579):
- ≥ 4: research-eligible;
- 3–4: lead list;
- below 3: not persisted. The top 3 per anchor, and any seeded pair, are
  computed on demand.

**Output:** one row per kept pair, with its features, both scores, stratum,
keys and id. `batch_rank` dedupes to at most 1 per relative and 2 per anchor.

### 4.6 Seeds, batches, evaluation (new, private)

- **`KinSeeds`** folds the owner's seed parts.
- **`FamilyResearchBatch`** computes seeded pairs' features through the
  on-demand path and draws the batch with a fixed seed. Seeds form their own
  stratum; a seeded pair that is also drawn counts only as a seed.
- **`FamilyHypothesesEval`** reports:
  - recall on the 66 claims, with top-1 and top-3;
  - a surname-rotation placebo, as an upper bound;
  - precision per stratum, with Wilson intervals;
  - precision of the relative's identity;
  - v1 against v2.
- **`FamilyBatchDigest`** turns a batch's verdict parts into the owner's
  digest.

### 4.7 Where each pipeline runs

| pipeline | nightly | CI full tier |
|---|---|---|
| `SurnameRarity`, `PkwAuditVerdicts` | rebuilt | runs (no names in output) |
| `PeopleMerged` with tier 1 | rebuilt | runs |
| `PkwPartialEval`, `PkwPartialAuditSample` | `EXCLUDED` | excluded |
| `FamilyCandidatePairs`, `KinSeeds`, `FamilyResearchBatch`, `FamilyHypothesesEval`, `FamilyBatchDigest`, `KinResearchVerdicts`, `KinOwnerVerdicts`, `HypothesisVerdicts` | `EXCLUDED` | excluded |

`--exclude` drops only top-level targets. So a test pins two things:
- every pipeline in a `PRIVATE` set is in both exclusion lists;
- no non-private pipeline depends on a private one.

`PeopleMerged`'s output still carries tier-1 spellings, so S0 must land
before P1-out (§7).

## 5. Upload and review

### 5.1 The PKW mark, through the existing night

**P1a, frontend** (live on autopush **and** on prod before P1b sends):
- **Schema and ingest:**
  - `electionRequestSchema` (`shared/api.ts:150`) accepts `match` and
    `pkw_spelling`.
  - `createElection` (`server/api/ingest/person.post.ts:558`) writes
    `pkw_match` to the edge, and `pkw_spelling` only to `matchNotes/{edgeId}`.
    Neither goes into the edge's revision.
  - The ingest response returns the edge id for every election it wrote or
    matched.
- **Matching a marked row.** For a `match: "surname_part"` row,
  `createElection`:
  - forces `vouched = false`;
  - accepts only an exact-identity `same` match, or a stored edge that already
    carries `pkw_match`;
  - otherwise creates a new marked draft. It **never enriches an unmarked
    stored candidacy**, which could be published, so a namesake's committee
    and party cannot land unmarked on the person's own run.
- **Retract and restore.**
  - A `retract` operation (`requireDatascience`) soft-deletes only unpublished
    edges carrying `pkw_match`, with the reason „wycofane automatycznie”.
  - A marked row that meets an edge removed with that reason undeletes it as a
    draft, with a revision.
  - `ingest-keeps-removed-candidacies-removed` must keep this exception.
- **Admin data paths.**
  - `getEdges` (`shared/graph/util.ts:191`), `edges/unpublished.get.ts`
    (`/admin/krawedzie`) and `edges/byNode.get.ts` (`PublishNodeDialog`)
    carry `pkw_match` in admin responses only.
  - `GET /api/admin/match-notes/[edgeId]` (`requireAdmin`, `no-store`) serves
    the spelling.
- **Chip.** In `card/EmploymentHistory.vue` and on all its person-page hosts,
  for admins: „Dopasowanie po części nazwiska — PKW: NOWAK-PRZYKŁADOWA Anna
  Maria, 1980”. The tooltip lists what to check: the committee, the gmina and
  the year on PKW's page, and to remove as „inna osoba” if it is someone else.
- **Publishing:**
  - both select-alls skip marked rows;
  - `/api/edges/publish` refuses a `pkw_match` edge in a multi-edge request;
  - the publish dialog warns when the candidacy would put the person in two
    places in one election. That would push
    `test_nobody_stands_in_two_places_at_once` over its budget of 24, and a
    newly failing invariant holds the people and scores uploads.
- **Announcement:** a `shared/qa.ts` entry with no names, and a legend line on
  `/admin/krawedzie`.

**P1b, pipeline:**
- **Kill switch.** `people_import` reads one shared flag that both the night
  and the „Wyślij dane” requests VM read. When it is off, `match` rows **and**
  retractions are not sent: a pause never retracts. `PeopleMerged` itself
  stays pure.
- **Fail closed.** `people_import` sends `match` rows only when the endpoint
  declares the `pkw_match` capability. Otherwise it drops them and says so in
  the run summary.
- **Edge records.** `people_import` writes the edge id ↔ (node id, candidacy
  key) map from the ingest response as write-once parts under
  `jobs/people_import/edge_records/`.
- **Retractions** are computed against the ungated attach set.
- **Arrival.**
  - Pages queue under the 100-a-night cap, and unpublished pages come last.
  - The queue is already long behind `split-pkw-records-by-place` and
    `merge-local-candidacy-offices`.
  - „Wyślij dane” sends one page at once.
- **Region.** Candidacies land on the powiat region node
  (`analysis/utils/elections.py:18`).

**Confirm** = publish, which needs both ends published. **Reject** = remove as
„inna osoba”.

### 5.2 How a PKW rejection sticks

1. Removed marked edges are read from `KorytaEdges`, including those on every
   page whose `merged_into` chain ends at the person's page. A merge leaves
   removed relations on the merged-away page (`server/utils/merge.ts`).
2. They are mapped to candidacy keys through the edge-record parts.
3. In `PeopleMerged`, after the union, any PKW record whose candidacy keys
   overlap a rejected key is detached from that person: one removal takes the
   whole record off the page. This is `decide-how-to-keep-rejected-connections`
   option (a), applied to the new tier whatever that decision says for the
   old one.

The rule also holds through a `person_pkw` rebuild, a split by place and an
office rename, because candidacy keys contain none of those. A hand-made
candidacy has no edge record; for its rejection to stick, the edge needs
`pkw_match`.

### 5.3 Kin, K1: a private list, research, and promotion by hand

Nothing is uploaded in K1. The owner gets:
- the ≥ 3 band as a private pipeline output;
- `koryta_kin_research seed --anchor <key> --relative <key> --reason …`, which
  writes a write-once part and accepts `wiki:`, `pkw:` and `rejestrio:` keys,
  so a relative without a page can be seeded;
- research results as parts, and `FamilyBatchDigest`;
- `koryta_kin_research verdict --id … --decision confirm|reject --reason …`
  (`KinOwnerVerdicts`).

**Promotion is one admin act.** `AddRelationDialog` gains an admin-only
„Opublikuj od razu” for `connection` edges, with:
- a fixed relation list: żona, mąż, partner/partnerka, syn, córka, ojciec,
  matka, brat, siostra, zięć, synowa, teść, teściowa, szwagier, szwagierka,
  krewny/krewna;
- a required reference;
- a sentence preview following D6;
- an optional hypothesis id, stored on the edge as `hypothesis_id`.
  `FamilyCandidatePairs` reads a connection carrying it as `confirmed`, so no
  CLI verdict is needed.

**`/api/edges/create` honours `publishNow` only when:**
- the caller passes `requireAdmin`, checked first;
- both ends are published;
- `references` is non-empty;
- the relation is on the list;
- one end **holds or held public office**, defined as either:
  - a published, non-`surname_part` election edge with `elected: true`, or
  - a published employment whose role is on a fixed list (poseł, senator,
    eurodeputowany, minister, wiceminister, wojewoda, marszałek, starosta,
    wójt, burmistrz, prezydent miasta, radny), or one D5 adds.

It writes the `connection` with an approved revision, already published. Every
refusal returns the same error.

**A relative without a page.** The owner creates and publishes it first, with
`wikipedia`, a full `birthDate` and, when exactly one register entry is known,
`rejestrIo`. Pages with no register row get no PKW candidacies from
`PeopleMerged`. Until `pkw-candidacies-for-pages-without-krs-row` ships, the
owner adds the relative's offices by hand, which is what the office test
reads.

### 5.4 Kin, K2: the admin queue

K2 is built when D0 chooses it, or when batch 1 clears its bar.

**Upload.** `jobs/hypotheses_import`, shaped like `people_import`:
- uploads the ≥ 4 band, seeds and research-confirmed pairs that the store
  lacks;
- writes `payloads/date=<day>/<run>.jsonl.gz` once;
- POSTs at most 40 new a night to `/api/ingest/hypotheses`
  (`requireDatascience`), and logs what it held back;
- runs as its own night step that can never hold the people step.

**Ingest:**
- `create` on the id;
- a conditional update while the hypothesis is open;
- `decided` otherwise;
- it never writes nodes, edges or revisions.

**Verdicts back.** Not through the daily export, which is kept indefinitely.
`hypotheses_import` pulls (id, status, decision, relation, sources, at) through
a `requireDatascience` endpoint into write-once parts, folded by
`HypothesisVerdicts`. K1 parts stay inputs, and the first K2 run uploads them
as `decided`.

**UI:**
- **Queue:** `/admin/hipotezy`, built on `note/TriageCard.vue`. One card per
  anchor shows its candidates and their evidence lines. Keys: 1 confirm, 2
  reject (a reason is required), 3 research, s skip.
- **Panel:** „Możliwe pokrewieństwo — hipoteza, nie fakt”, for admins only and
  fetched on the client only (`server: false`). Ids stay out of Plausible and
  Sentry. Non-admins see no count.
- **Seeds:** „Zgłoś możliwe pokrewieństwo” files a seed with any key type.
- **Confirm** opens §5.3's dialog with nothing prefilled.

### 5.5 Worked examples (invented)

**1. PKW, first half.**
- The register has "Anna Nowak", born 1971, on the supervisory board of a
  water company in powiat X.
- PKW has "NOWAK-PRZYKŁADOWA Anna Maria", born 1971, a powiat-council
  candidate in powiat X.
- Her cell: shape a, first half, middle name silent, same powiat. That is
  `attach`.
- A marked draft arrives. The admin sees the chip with the PKW spelling,
  checks the committee and the place, and publishes.
- The next send fills in the committee.

**2. PKW, second half.** As example 1, but the register has "Anna Przykładowa".
That is `audit`: the candidacy attaches only after an audit `same` for that
record.

**3. Kin.**
- A deputy director of a powiat water company and a powiat councillor share a
  surname with 30 bearers.
- They are in the same powiat and on the same local list, so v1 gives
  2.2 + 1.5 + 1.5 = 5.2, which is research-eligible.
- Research finds an interview naming them as siblings. The owner confirms,
  citing it.
- „Opublikuj od razu” writes „Jan Nowak → Anna Nowak: siostra”, published,
  with the reference. The councillor's elected seat satisfies the office test.

## 6. Research and audit

**The workflow** (slice W0) is written from scratch at
`data/pipelines/src/scripts/family/workflows/triage-family-hypotheses.js`.
- Research handles 3 pairs per agent, with web search and fetch and the KRS
  API.
- An adversarial verifier tries to refute **every** `kin` and `tie_not_kin`
  finding: a namesake, another local family, the wrong PKW cluster.
- The workflow returns jsonl, which `koryta_kin_research store` writes as
  write-once parts. `model` is set on every agent.

**Scope:**
- only ties already public that bear on a public role;
- no private life, addresses, health, minors or relatives' social media;
- birth year only;
- a shared surname is never a tie, and every claim cites a page the agent
  opened;
- the public figure is searched first, and a private person's name is never
  sent to a search engine together with kin words.

**Outcomes:** `kin` (relation, quotes, URLs), `tie_not_kin`, `unconfirmed` or
`refuted`, plus whether the relative's identity is confirmed. In earlier
research, most failures turned on the relative's identity.

**Sources, strongest first:**
1. Wikipedia kin fields or linking text;
2. oświadczenia majątkowe (no job fetches them yet);
3. odpis pełny surname history;
4. `personal_relation` extractions;
5. press and BIP rosters.

**Batch 1** is 40 pairs from `FamilyResearchBatch`, 10 per stratum after
`batch_rank`, plus seeds:
- S1: ≥ 4, same company;
- S2: ≥ 4, no shared company, koryta relative;
- S3: ≥ 4, no shared company, PKW or Wikipedia relative;
- S4: 3–4.

If D5 rules that pairs with no office holder are out, they are dropped from S1
and S2 before the draw. Drawing the top 30 instead would mostly re-measure the
board tie, which is already 11 in 12.

**The PKW audit** runs the same workflow with another question: is this
candidate the register person? It looks at the office, residence, committee,
BIP rosters and press, and answers `same`, `different` or `unknown`.
- **First, a free check.** For odpis-only people, compare the number of
  surname parts in the parsed odpis with `krs_censored_people`. A two-part
  masked surname against a one-part parsed one is a parser defect, filed
  separately and left out of the audit.
- **Sample:** the second-half candidacies (15 distinct) plus about 25 from the
  other cells.
- **Answers:**
  - `same` attaches that record;
  - `different` and `unknown` keep it out. An attach-tier record is never
    audited, so the audit adds no new exclusion.
- **Cells:** a cell is released for future records only when the Wilson lower
  bound of `same` reaches 0.67. `unknown` answers are counted against it.

**Cost.** About $0.7–1.8 per pair, since each pair is two people at
$0.36–0.91 each at Sonnet list prices.
- Batch 1 with a few seeds: about $30–75.
- The PKW audit: about $15–35.

The owner launches both, because agents are not allowed live fetching in auto
mode. The CRU hidden-links batch can share the workflow.

## 7. Privacy, safety, legal

**Before anything here ships:**
- **S0:** CI must publish no personal pipeline data:
  - no uploaded artifact of personal outputs (an allowlist, or none);
  - no cache of export files that pull-request runs can restore;
  - no row samples printed to logs when `CI` is set.
- **K0:** machine kin claims and family `connection` drafts are readable by
  admins only. How the owner's own drafting changes is D12.
- **Notes, comments and feedback** never carry kin suspicions from this
  system. Seeds and verdicts go only to the private parts or to `hypotheses`.

**PKW marked drafts:**
- They carry only `pkw_match` beyond today's exact drafts.
- The spelling and the committee stay in `matchNotes` until publication.
- The remaining public signal is that a candidacy was matched on part of a
  surname. That is accepted for public PKW facts, and only in cells measured
  at or above the exact join's precision.

**Kin claims** are public only as published edges with a cited source, both
pages published, and the office test (D5) passed.

**Store checks** (K2), pinned by tests and checked at rollout:
- anonymous calls to `/api/hypotheses/*` get 401, and non-admin calls 403;
- a Firestore client read fails;
- no hypothesis field appears in search, graph, node, revision or notes
  responses.

**Buckets and retention:**
- Private parts go only to `koryta-pl-sharedcache` under `jobs/`, with a
  lifecycle rule (D9).
- Private pipelines are not backed up.
- `matchNotes` is deleted when an edge is removed as a wrong match.

**Never committed or written anywhere public:**
- pair outputs, batches, seeds, dossiers and audit sheets;
- real names in tests, fixtures, comments, commit messages or `shared/qa.ts`;
- relatives' names in task bodies, which cite private cache paths instead.

**Legal.** GDPR article 85 asks for a public-interest test per tie, which the
office test encodes. Anything beyond ties to office holders waits on the legal
opinion the owner has already planned.

## 8. Evaluation and tests

**PKW:**
- **Before D1**, `PkwPartialEval` re-measures gate E on the night's
  `PeopleKRSMerged`, odpis-only rows included and reported separately:
  - per (person, PKW record) and per candidacy;
  - with the pipeline's own middle-name predicate (phase 1 counted any shared
    word as agreement);
  - with `Companies` seats.

  It also records the tier's wall time and peak memory with `memory_limit` and
  `max_temp_directory_size` set.
- **Nightly report lines,** not invariants:
  - the attach and retract counts;
  - placebo precision per cell, from the latest `PkwPartialEval`;
  - per cell, „inna osoba” above 15% of at least 30 decided records.
- **Recall per cell** from synthetic positives: exact matches with agreeing
  middle names, one surname half deleted.

**Kin:**
- Recall on the 66 claims is a regression test.
- Precision comes only from research verdicts: per stratum, with Wilson
  intervals, `unconfirmed` and `tie_not_kin` apart, seeds left out.
- Re-weighting waits for 50 verdicts: fit on the 44 edges, check on the 22
  text claims.

**pytest** (invented names only):
- rarity: both sexes summed, -ska folded to -ski, particles dropped, the upper
  bound for missing forms;
- position is read as written ("Nowak" vs "Nowak-Przykładowa" is first);
- gate E boundaries; second-half records out unless audited `same`; undated
  rows only as `held`;
- a half-surname-only person keeps exactly their tier-1 elections, with the
  PKW name, birth-year and score columns null and the rest of the payload
  unchanged;
- unpublished tier-1 candidacies give no party, hyphen, committee or score
  change;
- a verdict removal detaches the record through tier 0, after a `person_pkw`
  rebuild, after a split by place, after an office rename, and after an
  anchor merge; a „duplikat” removal does not;
- no verdict, edge-record or audit part contains a `p:` key;
- kin ids are symmetric and keyed;
- two namesake relatives with different register ids get different ids, and
  rejecting one leaves the other open;
- a verdict survives an anchor merge;
- the `PRIVATE` set is excluded on CI and in the night, and nothing public
  depends on it.

**vitest:**
- the mark is stored on create, and `pkw_spelling` reaches only `matchNotes`,
  never the edge or the revision;
- a mark-only difference is `same`;
- `enrichedEdge` keeps the stored mark through `elected` and `party`;
- a marked row against a published bare candidacy creates a separate marked
  draft and leaves the published edge unchanged;
- retract and re-send restores the draft;
- both select-alls skip marked rows, and `/api/edges/publish` refuses them in
  bulk;
- `matchNotes` is admin-only;
- `publishNow` is refused to non-admins, for unpublished ends, without a
  reference, for a relation off the list, and when the only office evidence is
  a draft, a marked candidacy or a lost run;
- removing a promoted edge rejects its hypothesis, except for „duplikat”.

## 9. Rollout

| # | slice | depends on |
|---|---|---|
| S0 | CI publishes no personal pipeline data (§7) | — |
| P0 | `split-pkw-records-by-place`, `local-candidacy-offices`, person_pkw rebuilt (existing tasks) | — |
| R0 | `SurnameRarity`, rebuilt nightly | — |
| P1-out | tier 1 in `PeopleMerged` (nothing sent); `PkwPartialEval`; parser check; re-measured gate; runtime | R0, S0, P0 |
| P1a | ingest fields, `matchNotes`, marked-row matching, retract/restore, admin paths, chip, publish guard, QA entry; autopush and prod | D3 |
| P1b | `people_import` sends `attach` rows: kill switch, capability check, edge records, retractions, rejection filter, report lines | P1-out, P1a on prod, D1 |
| W0 | the research/audit workflow | — |
| P1-audit | audit of second-half records | P1-out, W0, `decide-pkw-partial-audit` |
| P2 | `ingest-keeps-removed-candidacies-removed`, `pipeline-detaches-removed-pkw-records` (keeping the retraction exception) | `decide-how-to-keep-rejected-connections` |
| P3 | undated partial matches | D2, P1b |
| K0 | kin extractions and family connection drafts admin-only | D12 |
| K1 | family pipelines, `kin_research` (seed, verdict, store), „Opublikuj od razu”, batch 1 | R0, S0, K0, W0, D5, D6, D9, `decide-family-research-batch-1` |
| K2 | store, ingest, verdict pull, `hypotheses_import`, `/admin/hipotezy`, panel | D0 (b), or batch 1 + D8 |
| K3 | one widening at a time, each with pair count and recall delta | D7 |

The PKW slices (P) do not wait on any kin decision.

**Not now:**
- a new edge type;
- connections written by a pipeline;
- a PKW review queue below the gate (held rows are in `PkwPartialEval` for
  hand-adding);
- a fitted linkage model;
- stub nodes at generation.

## 10. Decisions for the owner

Each is a task under the goal `family-hypotheses`.

**D0 `decide-kin-hypothesis-representation`:**
- **(a) Recommended:** private parts now; the admin store after batch 1.
- (b) The admin store and queue now (about 4–5 days, nothing public).
- (c) A draft `connection` named „możliwa rodzina”. Rejected, because drafts
  are not private.

**D1 `decide-partial-surname-pkw-gate`.** Any gate **departs from the 10-07
rule** (attach what nothing contradicts). It treats a missing surname half as
missing evidence, which positive evidence must replace. Recommended: E, with
second-half records only on an audit `same`. That keeps about 400 of an
estimated ~739 true candidacies at 0.95, and withholds about 330.

| option | adds over E | its precision |
|---|---|---|
| A | 231 | 0.44 |
| E+ | 35 | 0.74 |
| no gate | 4,694 | ~0.07 |

New automatic exclusions under E:
- `held` and `below` rows;
- second-half rows without an audit `same`;
- surname parts under 4 letters;
- undated rows until D2.

**D2 `decide-undated-partial-pkw`.** Recommended: attach only with an agreeing
middle name and a part under 5,000 bearers (55 candidacies, 1.5 by chance),
once P1b is live.

**D3 `decide-marked-candidacy-review`.** Recommended:
- marked rows stay out of bulk publication, enforced on the server;
- the PKW spelling is shown to admins only;
- the mark stays after publication.

**D4a `decide-pkw-partial-audit`** (about $15–35) and
**D4b `decide-family-research-batch-1`** (about $30–75). The K2 bar is that S2
and S3 together reach 6 of 20: 0.30, Wilson lower bound 0.145, three times the
rare-surname baseline. S1 does not count.

**D5 `decide-kin-publication-rule`.** Recommended:
- a cited source;
- one end passes the office test (§5.3);
- never between two people who both fail it;
- both pages published.

Also: does a board seat in a publicly owned company count as a public role?
And may pairs with no office holder be researched at all?

**D6 `decide-kin-relation-direction`.** Recommended: the source is the anchor,
and the label says what the target is to the source („A → B: siostra” means B
is A's sister). Should the 44 existing family edges be normalised? The
migration would skip removed edges.

**D7 `decide-kin-relative-universe`.** Which K3 widenings to make, starting
with every candidate for parts with ≤ 100 bearers (538 → 2,429 pairs) and
public-company board members.

**D8 `decide-build-hypotheses-store`.** After batch 1, unless D0 chose (b).

**D9 `decide-kin-research-retention`.** Recommended: a lifecycle rule on
`jobs/kin_research/`, with rejected material reduced to tombstones after 90
days.

**D10 `decide-half-surname-search-alias`.** Should a published half match add
the ballot spelling as a search alias?

**D11 `decide-unpublished-family-drafts`.** What happens to the family
`connection` drafts that exist today: publish, keep, or move them to the
private store.

**D12 `decide-family-connection-drafting`.** After K0, how does the owner draft
a family tie on an unpublished page: never (publish only), admin-only drafts,
or only in the private store?

**Existing tasks this depends on:**
- `merge-split-pkw-records-by-place`;
- `merge-local-candidacy-offices` and its person_pkw rebuild;
- `decide-how-to-keep-rejected-connections`;
- `stop-latest-true-serving-drafts`;
- `legal-notice-and-opinion`;
- `run-next-cru-hidden-links-batch`.

**Agent follow-ups:**
- `repoint-unique-probability-at-surname-rarity`;
- `pkw-candidacies-for-pages-without-krs-row`.

## 11. Risks and what to measure next

**Risks:**
- **Kin precision is unknown,** and placebos overstate it. The hypotheses are
  leads.
- **The relative's identity:** PKW splits one politician into several clusters,
  and a winner far away is often a namesake.
- **Gate E's 0.95 is a placebo estimate** on a register build without odpis-only
  people, and the employer-powiat test is partly circular.
- **Arrival is slow:** unpublished pages wait behind two backlogs at 100 a
  night.
- **One reviewer:** the caps and the required source guard against
  rubber-stamping.

**Measure next:**
- the gate on the night's inputs, per record;
- the audit by cell;
- batch 1 by stratum, v1 against v2;
- a sector (PKD) feature;
- one-letter surname typos;
- first-name rarity;
- odpis surname history as a same-person signal: a register entry that once
  carried the double surname is close to certain.
