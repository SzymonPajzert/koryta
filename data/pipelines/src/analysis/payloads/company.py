import argparse
import collections
from functools import cached_property

import numpy as np
import pandas as pd

from analysis.interesting import Companies
from entities.company import display_name
from entities.company_bodies import form_for_supervisory_body, supervisory_body
from entities.company_categories import categories_for
from scrapers.koryta.download import KorytaCompanies
from scrapers.map.jst import SKARB_PANSTWA
from scrapers.stores import Context, Pipeline


class CompaniesPayloads(Pipeline):
    """Emits ingest payloads for companies already submitted to koryta.pl.

    Joins the enriched `Companies` data (PKD `activity` + the `is_public`
    spółka-publiczna flag) with the set of companies already on the site
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

    The payloads carry `teryt_code`, which the uploader maps to the `teryt`
    field the ingest endpoint links a company to its region with. They also
    carry `owners` and `owner_teryts`, so the ownership the register records is
    finally drawn: 964 shareholder entries name a company by KRS and 1,675 name
    a gmina, powiat, wojewodztwo or the Skarb Panstwa. Location edges used to
    be left out too, because the endpoint allocated a random id per edge and
    re-running duplicated them; it now derives the id from the link itself and
    skips edges that already exist, so this is safe to re-run.
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
            "submitted companies. Defaults to the latest available export.",
            default=None,
        )
        return parser.parse_known_args()[0]

    def process(self, ctx: Context):
        # TODO this should be a field and dependency
        submitted_df = KorytaCompanies(self.args.koryta_date).read_or_process(ctx)
        submitted_krs = {
            str(krs).zfill(10) for krs in submitted_df["krs"].dropna().tolist()
        }
        print(f"{len(submitted_krs)} companies already submitted to koryta.pl")

        companies_df = self.companies.read_or_process(ctx)

        payloads = []
        with_teryt = 0
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

            is_public = row.get("is_public")
            is_public = (
                bool(is_public) if isinstance(is_public, (bool, np.bool_)) else False
            )

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
                "categories": categories_for(krs, list(activity), form),
                "supervisory_body": supervisory_body(form),
                "is_public": is_public,
                "owners": owners,
                "owner_teryts": owner_teryts,
                "owner_skarb_panstwa": skarb_panstwa,
            }

            teryt_code = row.get("teryt_code")
            if isinstance(teryt_code, str) and teryt_code.strip():
                payload["teryt_code"] = teryt_code.strip()
                with_teryt += 1

            payloads.append(payload)

        # Counted and printed because the failure mode here is silence: when
        # `Companies` dropped `parents`, every payload came out with two empty
        # lists and the run reported nothing wrong. A zero on either of these is
        # worth noticing - the register names a company owner for 837 of the
        # companies on the site and a JST owner for 1,354.
        with_owners = sum(1 for p in payloads if p["owners"])
        with_jst = sum(1 for p in payloads if p["owner_teryts"])
        with_skarb = sum(1 for p in payloads if p["owner_skarb_panstwa"])
        print(
            f"Emitting {len(payloads)} company payloads "
            f"({with_teryt} with a TERYT code, {with_owners} with a company "
            f"owner, {with_jst} with a JST owner, {with_skarb} owned by the "
            f"Treasury)"
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
                ]
            )
        return pd.DataFrame.from_records(payloads)


class SiteCompanyCategories(Pipeline):
    """Recomputes `{krs, categories}` from what the site already stores.

    The catch-up producer for `frontend/scripts/migrate/apply-company-categories.ts`,
    and the reason it exists is operational rather than analytical. A change to
    `entities.company_categories` changes what a *new* upload files a company
    under and nothing about the 4047 place nodes already stored, so between the
    rule change and a run of that migration the site serves the previous
    mapping's answer with nothing to say it is stale. The only producer of the
    migration's input used to be `CompaniesPayloads`, which reads `Companies` -
    a KRS scrape and a wiki rebuild - so applying a one-line change to the
    mapping cost a full crawl, and in practice was never done: the categories on
    production were still the ones the old frontend rule produced, two months
    and one whole rewrite of the mapping later.

    This reads the nightly Firestore export instead. The site's `activity` is a
    verbatim copy of the register's PKD codes - replaying the pre-2026-08-26
    frontend rule over the stored codes reproduces 2800 of the 2801 stored
    category sets, the one exception being a company somebody edited by hand -
    so it is good enough to re-derive a category from, and it costs one export
    read.

    `CompaniesPayloads` stays authoritative and this does not replace it. It
    cannot: it can only repeat the codes the site was last ingested with, so a
    company whose register entry changed since gets yesterday's answer, and a
    company the site has never held is not here at all. What it is for is
    applying a change to the mapping on the day the change lands, rather than
    whenever the next full company upload happens to run.

    Emits exactly the two fields the migration reads. Everything else a company
    payload carries - the name, the raw codes, `is_public`, the TERYT - is
    deliberately absent: this is not an ingest payload and must not be fed to
    the uploader, which would re-submit companies from a stale copy of the
    register.
    """

    volatile = True
    filename = None

    @cached_property
    def args(self):
        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--koryta-date",
            help="Date (YYYY-MM-DD) of the koryta.pl export to read the stored "
            "PKD codes from. Defaults to the latest available export.",
            default=None,
        )
        return parser.parse_known_args()[0]

    def process(self, ctx: Context):
        # Constructed here rather than declared as a source for the same reason
        # `CompaniesPayloads` does it: the export date is an argument, and a
        # declared dependency is built with no arguments at all.
        submitted_df = KorytaCompanies(self.args.koryta_date).read_or_process(ctx)

        records = []
        counts: collections.Counter[str] = collections.Counter()
        without_pkd = 0
        for row in submitted_df.to_dict(orient="records"):
            krs = row.get("krs")
            if krs is None or (isinstance(krs, float) and np.isnan(krs)):
                continue
            krs = str(krs).zfill(10)

            activity = row.get("activity")
            if not isinstance(activity, (list, np.ndarray)):
                activity = []
            activity = [str(code) for code in activity]
            if not activity:
                without_pkd += 1

            # The form, recovered from the only field on the node that
            # remembers it. Without it every SPZOZ - 243 hospitals, none of
            # which declares a single PKD code - would come back with no
            # category at all, and the migration would strip `szpitale` from
            # each of them. See `KorytaCompany.supervisory_body`.
            form = form_for_supervisory_body(row.get("supervisory_body"))

            categories = categories_for(krs, activity, form)
            counts.update(categories or ["(none)"])
            records.append({"krs": krs, "categories": categories})

        # Refuse rather than emit an answer that would strip the site bare.
        # `KorytaCompanies` caches its output per export date, and a copy
        # written before it carried `activity` reads back with no such column at
        # all - at which point every company here looks like it declares no PKD,
        # only the ~30 on the override lists keep a category, and the migration
        # dutifully removes `categories` from the other 2,771 nodes. A loud
        # failure with the flag to fix it is the only safe answer.
        if records and without_pkd == len(records):
            raise ValueError(
                "No company in the koryta.pl export carries any PKD code. That "
                "is almost certainly a KorytaCompanies output cached before it "
                "read `activity` - re-run with --refresh KorytaCompanies. "
                "Applying this result would delete the categories of every "
                "company on the site."
            )

        print(
            f"Recomputed categories for {len(records)} companies already on "
            f"koryta.pl ({without_pkd} of them declare no PKD, so only an "
            f"override can place them):"
        )
        for value, count in counts.most_common():
            print(f"  {count:6d}  {value}")

        if not records:
            return pd.DataFrame(columns=["krs", "categories"])
        return pd.DataFrame.from_records(records)
