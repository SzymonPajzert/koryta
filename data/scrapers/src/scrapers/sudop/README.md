# Pomoc publiczna po powodzi 2024 (SUDOP)

Public aid paid out after the September 2024 flood, from the UOKiK register,
joined to koryta.pl's companies and stored as a new `aid` edge type.

```
koryta AidPayloads | koryta_uploader --type aid --submit
```

## What the sources are, and which one is gone

| Source | Access | What it gives |
|---|---|---|
| **SUDOP** (UOKiK) | Public API, no key: `https://api-sudop.uokik.gov.pl/swagger/sudop-api.yml` | Every aid decision: grantor, beneficiary NIP, amount, legal basis, PKD, gmina TERYT |
| **Wykaz podatników VAT** (MF) | Public API, no key, 30 NIPs per request | NIP → KRS, which is the only way to join SUDOP to koryta.pl; and a sole trader's own name |
| **CEIDG** | Free API key by application (Profil Zaufany) | The person behind a sole trader: imię, nazwisko, seat |
| ~~**CRBR**~~ | **Closed** | — |

CRBR is what the published analyses of this data used for ownership, and it is
no longer available. Since 2026 the register is not openly searchable: direct
access is limited to authorities and obliged institutions, everyone else applies
and shows an *uzasadniony interes* under the AML rules, and the public form is
behind a reCAPTCHA either way.

This costs the pipeline nothing. koryta.pl already reads ownership out of KRS
for every company it tracks, so the 748 beneficiaries this ingests go to the
existing KRS pipeline and get the same ownership treatment as everything else -
current *and* historical, which CRBR does not hold. It also removes a problem
CRBR would have brought: its records carry PESEL numbers, and nothing here has
anywhere to put one.

Two corrections to what is published elsewhere about this data:

- **SA.115933 is not a flood measure.** It is not in SUDOP's dictionary, appears
  on no decision, and searching for it is a 400. The second measure is
  **SA.117151** - 109 decisions of preferential loans from the regional
  development agencies.
- Searching by the **purpose code `a17` bounded to 2024-09-01**, rather than by
  a measure number, is what returns all 9461 decisions. `SA.116730` alone
  returns 9350.

## The sole traders

Four in five beneficiaries - 2,967 of 3,715 - are a jednoosobowa działalność
gospodarcza or a spółka cywilna. **All of them are ingested.**

An earlier version of this pipeline kept only the 748 with a KRS number, on the
grounds that a sole trader has no ownership register behind it and so could
never gain an edge. That was the wrong test for whether a row is worth keeping.
The published analyses of this data treat a run of eight or more decisions as
the thing to look at; read by hand, the single-decision micro-firms are just as
interesting, and a filter that drops four in five beneficiaries drops those
before anybody can look at them.

What the filter used to do, **publication** now does. Storing a row and putting
up a public page about it are separate decisions in this model - `published`
against `revision_id` - so the register goes in whole and:

- a company in KRS is published on arrival, as `ingest/company` has always done;
- a natural person trading under their own name is stored **unpublished**. Their
  business is a matter of public record and the aid is public money, but the
  name on the door is a private individual's, and 2,967 automatically published
  pages about them is not a decision an ingest gets to make on its own.

That is one flag in `ingest/aid.post.ts` if you disagree.

### Tying one to a person: a name is not an identity

A councillor's own business taking flood money from a starosta is exactly what
this site is for, and CEIDG is the register that names the human being behind a
sole trader. The biała lista already returns that name for free, so the join is
available. **The problem is that a name is not an identity.**

Matching the 2,045 sole traders the biała lista resolved against the 6,113 people
already on koryta.pl, by name alone, returns **21 hits. All 21 are in a different
powiat from the person they matched:**

| business owner | matched person is tied to | aid, in powiat |
|---|---|---|
| Grzegorz Lach | 1418 (płocki) | 514 k PLN in 1607 (nyski) |
| Waldemar Olczyk | — | 259 k PLN in 0208 (kłodzki) |
| Tomasz Duda | 1005 (łódzkie) | 203 k PLN in 1607 |
| Andrzej Adamczyk | 2464 | 53 k PLN in 0261 |

Twenty-one Krzysztof Nowaks and no findings. Had this shipped on names alone it
would have published twenty-one accusations of nothing.

So the rule is **name *and* powiat**, enforced twice - in
`scrapers/sudop/people.py` where the payload is built, and again in
`ingest/aid.post.ts` against the person's own region links, because the endpoint
does not take the pipeline's word for it. On today's data that proposes **zero**
links, which is the correct answer rather than a failure: koryta.pl does not yet
hold many people in the flooded powiats (0206, 0207, 0208, 0261, 1607, 1610).
As the person corpus grows into them the same rule starts proposing links, each
already carrying the corroboration a reviewer would otherwise have to find.

The link is an enrichment and not a gate. A claim that does not hold up costs
the claim and nothing else: the aid is still stored, because it is public money
either way and dropping a real grant over a guess about who owns the recipient
is the wrong trade. The endpoint logs it and carries on.

Two guardrails, both deliberate:

- **Nothing here ever creates a person.** Only people koryta.pl already tracks
  are ever linked to. A register of private individuals who had a flood is not
  what this site is - as much a data-protection point as a scale one.
- The `owns` edge from person to business is **always written unpublished**,
  whatever else the run publishes. It is the strongest claim this pipeline can
  make and the one it is least able to verify.

CEIDG's contribution over the biała lista is a clean imię/nazwisko split, the
business's own registered seat rather than the seat SUDOP reported, and coverage
of spółki cywilne. Without a key (`--ceidg-key`) the pipeline falls back to the
biała lista and says so; the match rule is the same either way.

### PESEL, which would settle it, and cannot be had

A date of birth is what actually separates one Krzysztof Nowak from another, and
a PESEL yields one exactly. `scrapers/sudop/pesel.py` implements the derivation
- century folded into the month, the 1800s band last, the checksum - and returns
a date and nothing else. The number itself is never stored, which is also what
the published analysis of this data did with the PESELs in its source.

Two things stand in the way, and the second is the one that matters:

1. **There is no source.** The official KRS API censors PESELs to their first
   digit: the 19,094 api-krs snapshots koryta has crawled hold `8**********` and
   names masked the same way (see `scrapers/krs/people_parsing.py`). CEIDG does
   not publish one. CRBR does, and closed to open access in 2026 - available on
   application showing an *uzasadniony interes*, which a journalistic project
   plausibly has, but that is an application and not an API key.
2. **There would be nothing to match against.** Exactly **1 of koryta.pl's 6,115
   people has a `birthDate`.** A perfect PESEL→date derivation resolves nothing
   against an empty column.

So the prerequisite is not a PESEL source at all - it is birth dates on the
people the site already has. Those are obtainable from data koryta already
scrapes: `scrapers/pkw/process.py:48` derives `birth_year` from the candidate's
age in the PKW files, and `entities/person.py` carries `birth_date`,
`birth_year` and `birth_iso8601`. The value is computed and then dropped before
Firestore. Wiring that through is the cheap, high-value piece of work, and it is
worth doing whether or not a PESEL ever arrives - a birth year alone cuts the
namesake problem down enormously.

## Scale: what this adds to the database

Measured against a prod export of 2026-08-11 (10,759 nodes, 28,465 edges,
41,896 revisions) and a full SUDOP pull of 2026-08-18.

| | In SUDOP | Ingested | |
|---|---|---|---|
| Decisions | 9,459 | **9,459 (100%)** | rolled up, not one document each |
| Beneficiaries | 3,715 | **3,715** | 748 published, 2,967 stored unpublished |
| Granting institutions | 31 | **31** | stored unpublished |
| `aid` edges | | **5,290** | one per (grantor, beneficiary, measure) |
| `owns` edges | | **3,715** | region seats |
| Gross value | 699.2 M PLN | **699.2 M PLN (100%)** | |

**+3,746 nodes (+35%), +9,005 edges (+32%).** `nodes` goes 20.3 → ~27 MB and
`edges` 9.0 → ~11.9 MB.

The rollup is the only thing still compressing anything: 9,459 decisions become
5,290 edges, because eight grants from one starosta to one company are eight
rows of one report rather than eight ties. No decision and no złoty is lost -
the edge carries the sum and the count, and `SudopAid` holds every row as
downloaded.

### The hub, which is real and is contained

ZUS decided on 5,690 of the 9,459 grants, to 2,914 different companies. Ingested
whole, that is one node with **2,914 edges** against a current widest of 852 - a
3.4× step change, and the one genuine risk in this design. Two things hold it:

- **`edgeTraverse.aid` is `dead_end` in both directions**
  (`shared/graph/util.ts`), as `tagged` is and for the same reason. Without it,
  ZUS would assert a connection between every pair of its 2,914 beneficiaries -
  4.2 million pairs of companies "connected" by having filed with the same
  office. With it, the grantor's own group still lists who it paid, which is the
  useful half, and the hop after that stops. Guarded by a test in
  `tests/shared/graph/util.test.ts`.
- **The document stays inside its limits.** `stats.edges.all.targetNodeIds` on
  the ZUS node is 2,914 ids ≈ 90 KB stored as a numbered-key object, 180 KB with
  the `approved` copy, against Firestore's 1 MiB per document. Room, but this is
  the number to watch if a second nationwide programme is ever ingested.

Being paid by the same office is also not the kind of claim this graph makes
anywhere else. `owns` and `employed` are ties between the two ends; a grant is a
transaction each end had with the state. What is worth reading off it - who got
how much - is a number on the edge, and shows on the company's own page without
any traversal at all.

## Cost of running it

**Pulling the data.** One SUDOP search, which queues for four to eight minutes
and returns all 9,459 rows in one response; 124 white-list requests, about a
minute. Both free, both cached as pipeline outputs, so re-running the rollup
costs nothing.

**Writing it.** 3,815 requests to `/api/ingest/aid`, touching ~12,850 documents.
`createRevisionTransaction` writes twice per document - the revision and the
target - so **≈25,700 writes and ≈17,000 reads**, once. That is over Firestore's
20,000-writes-a-day free tier, so it either costs a little or runs across two
days. The recurring cost is a 32% larger `edges` collection, which matters
because `fetchEdges()` reads all of it on any `/api/graph/local` request past
distance 1: 9.0 MB becomes 11.9 MB.

Two things keep re-runs cheap, and both are deliberate:

- A granting institution is written **only when the payload says something new
  about it**. 25 institutions stand behind 1,040 grants, and restating each per
  grant would be 1,040 revisions of 25 documents, every one of them in front of
  a reviewer.
- An `aid` edge's document id is derived from (grantor, beneficiary, measure),
  so a re-run - SUDOP is fed with a delay, and the totals grow - lands on the
  document that is already there and replaces the totals rather than adding a
  second edge beside it.

**Review.** 748 companies land published, on the same terms as any other company
ingest. Everything else lands unpublished: 2,967 sole traders, and the 31
institutions, because a public body appearing on the site for the first time is
worth a reviewer's glance. That is a large queue and it is meant to be - it is
the same 2,967 rows a filter would have thrown away, held somewhere a person can
work through them. Nothing new appears in the sitemap: `_sitemap-urls.ts` lists
`person` and `article` only.

## Pipelines

| | Cached | Cost |
|---|---|---|
| `SudopAid` | `sudop_aid` | one API search, 4-8 min |
| `SudopBeneficiaries` | `sudop_beneficiaries` | 124 white-list requests |
| `KorytaPeoplePowiats` | `koryta_people_powiats` | reads the nightly export |
| `AidPayloads` | volatile | pure rollup, plus CEIDG if a key is given |

`pesel.py` is a pure function used by none of them yet; see above for why.

## What is deliberately not here

Nothing from the register. Every decision, every beneficiary and every złoty is
either a node, an edge, or summed into one.

What is not here is a **public report page** in the shape the published analyses
of this data take - a sortable table of who received what. `SudopAid` holds
every row as downloaded, so one can be built from it without going back to the
API.
