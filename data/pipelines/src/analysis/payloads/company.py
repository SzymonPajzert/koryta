import argparse
from collections import Counter
from functools import cached_property

import numpy as np
import pandas as pd

from analysis.interesting import Companies
from analysis.payloads.site import SiteSnapshot
from entities.company import display_name
from entities.company_bodies import supervisory_body
from entities.company_categories import categories_for
from scrapers.koryta.download import KorytaCompanies
from scrapers.map.jst import SKARB_PANSTWA
from scrapers.stores import Context, Pipeline


def add_register_fields(payload: dict, form: str | None, organ) -> None:
    """The two register fields the site holds for display and nothing else.

    `legal_form` is `formaPrawna` verbatim; `supervisory_organ` is what
    `dzial2.organNadzoru` names, normalised by `scrapers.krs.organs`. Neither
    decides anything - `supervisory_body`, set beside them from `form`, is what
    the site excludes an unpaid seat by. Kept apart deliberately: the organ is
    finer, and can name a komisja rewizyjna, but it is absent for 719 of the
    1,192 SPZOZ in the crawl, so it can say a board is unpaid and never that
    one is paid.

    Omitted rather than sent empty when KRS did not say. The ingest writes a
    revision wholesale, so a key present and empty clears whatever the node
    already holds, and for a company no odpis was ever read for that would be
    a guess dressed as an answer. `supervisory_body` is the exception and
    sends "" on purpose: it is derived, so it always has an answer.
    """
    if form:
        payload["legal_form"] = form
    if isinstance(organ, str) and organ.strip():
        payload["supervisory_organ"] = organ.strip()


def read_an_odpis(row: dict) -> bool:
    """Whether the register's current extract of the company was read.

    `CompaniesKRS` records an `api-krs` source for a company only when the
    newest answer api-krs gave was an odpis. A company struck off answers 204
    and one in neither register 404, both stored as "Not Found", and one never
    asked has nothing stored at all - and in each case nothing was read that
    could say who owns it.
    """
    sources = row.get("sources")
    if not isinstance(sources, (list, np.ndarray)):
        return False
    return any(
        isinstance(source, dict) and source.get("source") == "api-krs"
        for source in sources
    )


def add_is_public(payload: dict, row: dict) -> None:
    """Whether the public sector owns the company, where anything says so.

    `true` is always sent: it comes from an owner the register names, from
    REGON's ownership code, from a hardcoded list or from a public parent, and
    any of those is evidence. `false` is sent only over an odpis that was read
    and named no public owner. Without one it is a default rather than an
    answer, and sending it flipped MAZOWIECKI REGIONALNY FUNDUSZ POŻYCZKOWY
    (0000224180), public on the site since August, to private once api-krs
    began answering 204 for it: the ingest writes `is_public` over anything
    not marked `isPublicSource: "manual"`. Left out, the stored flag stands.
    """
    is_public = row.get("is_public")
    if isinstance(is_public, (bool, np.bool_)) and is_public:
        payload["is_public"] = True
    elif read_an_odpis(row):
        payload["is_public"] = False


def wiki_categories(row: dict) -> list[str]:
    """The categories of the company's Wikipedia article, as `Companies` read
    them - see `entities.company_categories.categories_for` for what of them
    is used."""
    categories = row.get("wiki_categories")
    return list(categories) if isinstance(categories, (list, np.ndarray)) else []


def add_wikipedia(payload: dict, article) -> None:
    """The company's own Wikipedia article, as `Companies` matched it.

    Omitted rather than sent empty, on the terms `legal_form` is: a company
    with no article this run may carry one a reader linked by hand, and the
    ingest writes a revision wholesale.
    """
    if isinstance(article, str) and article.strip():
        payload["wikipedia"] = article.strip()


class CompaniesPayloads(Pipeline):
    """Emits ingest payloads for companies already submitted to koryta.pl.

    Joins the enriched `Companies` data (PKD `activity`, the `is_public`
    spółka-publiczna flag, the register's `form`, and the `supervisory_organ`
    it names) with the set of companies already on the site
    (`KorytaCompanies`), so a migration re-submits only companies that already
    exist.

    The payloads carry `categories`, worked out here by
    `entities.company_categories`. The site used to derive them itself from the
    `activity` codes in the payload, which put the whole mapping - two vintages
    of PKD, and an override list for the companies neither vintage places
    correctly - behind a frontend constant that nothing could test against the
    register. A category a person has edited on the site is not overwritten:
    the ingest endpoint skips any node carrying `categoriesSource: "manual"`.

    They also carry `supervisory_body`, from `entities.company_bodies`: the
    243 SPZOZ hospitals are supervised by a rada spoleczna rather than a rada
    nadzorcza, and a seat on one is unpaid, so the site has to be able to tell
    those seats apart from the board seats it counts as employment.

    Beside it, and not to be confused with it, go `legal_form` - the register's
    `formaPrawna` verbatim - and `supervisory_organ`, the organ `dzial2` itself
    names, normalised by `scrapers.krs.organs`. Those two are what
    /eksploruj/szpitale reports a hospital's board by, and they are reporting
    only: `supervisory_organ` is "brak" for 719 of the 1,192 SPZOZ in the
    crawl, because a rada spoleczna is created by statute and often never
    filed, so it can say a board is unpaid but never that one is paid. The
    rule stays with `supervisory_body`, which reads the form and is total.

    The payloads carry `teryt_code`, which the uploader maps to the `teryt`
    field the ingest endpoint links a company to its region with. They also
    carry `owners` and `owner_teryts`, so the ownership the register records is
    finally drawn: 964 shareholder entries name a company by KRS and 1,675 name
    a gmina, powiat, wojewodztwo or the Skarb Panstwa. Location edges used to
    be left out too, because the endpoint allocated a random id per edge and
    re-running duplicated them; it now derives the id from the link itself and
    skips edges that already exist, so this is safe to re-run.

    Where `Companies` matched the company's own Polish Wikipedia article, the
    payload carries its address as `wikipedia`, which the site links from the
    company's page the way it links a person's. The article stands in for the
    register in two places as well, both only where the register is silent:
    its infobox's owners become `owners`, `owner_teryts` and
    `owner_skarb_panstwa` for a spolka akcyjna the register lists no
    shareholder of, and its categories place a company no PKD code does - see
    `wiki_owners` in `analysis.interesting` and `categories_for`.
    """

    volatile = True
    filename = None

    companies: Companies

    @cached_property
    def args(self):
        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--koryta-date",
            help="Date (YYYY-MM-DD) of the koryta.pl export listing already "
            "submitted companies, and holding what they say for "
            "--only-changed. Defaults to the latest available export.",
            default=None,
        )
        parser.add_argument(
            "--only-changed",
            help="Emit only the companies whose payload would write something "
            "koryta.pl does not already hold. Every company here is one the "
            "site already has, so on a quiet day that is most of them.",
            default=False,
            required=False,
            action=argparse.BooleanOptionalAction,
        )
        return parser.parse_known_args()[0]

    def only_changed(self, ctx: Context, payloads: list[dict]) -> list[dict]:
        """The payloads that would write something, and a note of what.

        Every company here is one the site already holds, and most runs learn
        nothing about most of them: the register has not moved and the
        categories are worked out from codes that have not moved either. The
        ingest declines to write those - see `revisionChangesNothing` in
        `frontend/server/utils/revisions.ts` - but declining still costs a
        request and a lookup each, and the uploader sleeps 0.3s between them.

        Deciding it here rather than in the uploader is what makes the saving
        real: a payload dropped here is never sent. `SiteSnapshot` replays the
        ingest's own rules against the nightly export, and errs towards keeping
        a payload wherever the two could disagree - the server-side guard is
        what makes that cheap, because a payload sent needlessly now costs a
        request and no write.
        """
        snapshot = SiteSnapshot.read(ctx, self.args.koryta_date)

        changed = []
        reasons: Counter[str] = Counter()
        for payload in payloads:
            payload_reasons = snapshot.company_changes(payload)
            if not payload_reasons:
                continue
            changed.append(payload)
            reasons.update(payload_reasons)

        print(
            f"{len(changed)} of {len(payloads)} payloads differ from "
            f"koryta.pl; dropping {len(payloads) - len(changed)} that would "
            f"write nothing. What the rest would write:"
        )
        for reason, count in reasons.most_common():
            print(f"  {count:6d}  {reason}")
        return changed

    def process(self, ctx: Context):
        # TODO this should be a field and dependency
        submitted_df = KorytaCompanies(self.args.koryta_date).read_or_process(ctx)
        submitted_krs = {
            str(krs).zfill(10) for krs in submitted_df["krs"].dropna().tolist()
        }
        print(f"{len(submitted_krs)} companies already submitted to koryta.pl")

        companies_df = self.companies.read_or_process(ctx)

        payloads = []
        for row in companies_df.to_dict(orient="records"):
            krs = row.get("krs")
            if krs is None or (isinstance(krs, float) and np.isnan(krs)):
                continue
            krs = str(krs).zfill(10)
            if krs not in submitted_krs:
                continue

            name = row.get("name")
            if not isinstance(name, str) or not name:
                name = krs
            else:
                city = row.get("city")
                name = display_name(name, city if isinstance(city, str) else None)

            activity = row.get("activity")
            if not isinstance(activity, (list, np.ndarray)):
                activity = []

            form = row.get("form")
            form = form if isinstance(form, str) and form.strip() else None

            # Who owns it, split the way the ingest takes them: a company owner
            # by KRS, a gmina/powiat/wojewodztwo by the TERYT code its register
            # name resolved to. This pipeline used to emit neither, so no
            # ownership edge was ever written for a company already on the site
            # - which is why 3,927 of 4,024 of them had exactly one `owns` edge
            # and it was the seat.
            owners, owner_teryts = [], []
            # The Treasury rides in on `teryt` because it has no KRS, but it is
            # not a territory and the ingest must not look it up as one - see
            # `company_from_api_krs`. Split out here into a flag the ingest
            # resolves to the site's own "Skarb Panstwa" node.
            skarb_panstwa = False
            for parent in row.get("parents") or []:
                if not isinstance(parent, dict):
                    continue
                if parent.get("krs"):
                    owners.append(str(parent["krs"]).zfill(10))
                elif parent.get("teryt") == SKARB_PANSTWA:
                    skarb_panstwa = True
                elif parent.get("teryt"):
                    owner_teryts.append(str(parent["teryt"]))

            payload = {
                "krs": krs,
                "name": name,
                "activity": list(activity),
                "categories": categories_for(
                    krs, list(activity), form, wiki_categories(row)
                ),
                "supervisory_body": supervisory_body(form),
                "owners": owners,
                "owner_teryts": owner_teryts,
                "owner_skarb_panstwa": skarb_panstwa,
            }
            add_is_public(payload, row)
            add_register_fields(payload, form, row.get("supervisory_organ"))
            add_wikipedia(payload, row.get("wikipedia"))

            teryt_code = row.get("teryt_code")
            if isinstance(teryt_code, str) and teryt_code.strip():
                payload["teryt_code"] = teryt_code.strip()

            payloads.append(payload)

        if self.args.only_changed:
            payloads = self.only_changed(ctx, payloads)

        # Counted and printed because the failure mode here is silence: when
        # `Companies` dropped `parents`, every payload came out with two empty
        # lists and the run reported nothing wrong. A zero on either of these is
        # worth noticing - the register names a company owner for 837 of the
        # companies on the site and a JST owner for 1,354. Counted over what is
        # left after `--only-changed`, so the line describes what is emitted.
        with_teryt = sum(1 for p in payloads if p.get("teryt_code"))
        with_owners = sum(1 for p in payloads if p["owners"])
        with_jst = sum(1 for p in payloads if p["owner_teryts"])
        with_skarb = sum(1 for p in payloads if p["owner_skarb_panstwa"])
        with_wikipedia = sum(1 for p in payloads if p.get("wikipedia"))
        print(
            f"Emitting {len(payloads)} company payloads "
            f"({with_teryt} with a TERYT code, {with_owners} with a company "
            f"owner, {with_jst} with a JST owner, {with_skarb} owned by the "
            f"Treasury, {with_wikipedia} with a Wikipedia article)"
        )
        if not payloads:
            return pd.DataFrame(
                columns=[
                    "krs",
                    "name",
                    "activity",
                    "categories",
                    "supervisory_body",
                    "is_public",
                    "owners",
                    "owner_teryts",
                    "owner_skarb_panstwa",
                    "teryt_code",
                    "legal_form",
                    "supervisory_organ",
                    "wikipedia",
                ]
            )
        return pd.DataFrame.from_records(payloads)
