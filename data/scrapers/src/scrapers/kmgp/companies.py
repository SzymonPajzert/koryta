import dataclasses
import json
import typing

import pandas as pd

from entities.company import Company as KrsCompany
from entities.company import Source
from scrapers.krs.list import CompaniesKRS
from scrapers.stores import CloudStorage, Context, DownloadableFile, Pipeline


class NipToKrsMapper:
    """
    Maintains a mapping from NIP and REGON numbers to KRS IDs,
    allowing for cross-referencing company data from different sources.
    """

    def __init__(self):
        self.nip_to_krs: dict[str, str] = {}

    def add(
        self,
        # Adding line split
        krs: str | None = None,
        nip: str | None = None,
        regon: str | None = None,
    ):
        if krs and nip:
            self.nip_to_krs[nip] = krs
        if krs and regon:
            self.nip_to_krs[regon] = krs


class CompaniesKMGP(Pipeline[KrsCompany]):
    filename = "company_kmgp"
    companies_krs: CompaniesKRS

    @property
    def output_class(self):
        return KrsCompany

    def list_companies(
        self, ctx: Context, nipmapper: NipToKrsMapper
    ) -> typing.Iterator[KrsCompany]:
        # load krs mapping

        # TODO list files is a common pattern now, create a helper for it
        for blob_ref in ctx.io.list_files(
            CloudStorage(prefix="hostname=kazdymusigdziespracowac.pl")
        ):
            assert isinstance(blob_ref, DownloadableFile)
            if "bir12" not in blob_ref.url:
                continue

            blob = ctx.io.read_data(blob_ref)
            try:
                content = blob.read_string()
                data = json.loads(content)
            except Exception as e:
                print(f"Skipping {blob_ref.url}: {e}")
                continue

            for item in data:
                yield parse_company_data(item, nipmapper)

    def process(self, ctx):
        nipmapper = NipToKrsMapper()
        for c in self.companies_krs.read_or_process_list(ctx):
            nipmapper.add(krs=c.krs, nip=c.nip, regon=c.regon)

        output = []
        for company in self.list_companies(ctx, nipmapper):
            output.append(company)
        return pd.DataFrame.from_records([dataclasses.asdict(c) for c in output])


def parse_company_data(item: dict[str, str], nipmapper: NipToKrsMapper) -> KrsCompany:
    nip = item.get("nip")
    regon = item.get("regon")
    krs = item.get("krs")

    nipmapper.add(krs=krs, nip=nip, regon=regon)

    # generate surrogate krs if not found
    if not krs:
        krs = f"kmgp_{item.get('id')}"

    return KrsCompany(
        krs=krs,
        name=item.get("name"),
        city=item.get("poczta"),
        teryt_code=item.get("teryt"),
        nip=nip,
        regon=regon,
        sources=[Source("hardcoded", "kmgp")],
    )
