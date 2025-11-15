import os

import itertools

from util.config import versioned
import scrapers.krs.data as data

KRS_STARTERS_ALL = "krs_starters.csv"
COMMON_ROW = 7


def test_public_companies_list():
    PUBLIC_COMPANIES_KRS = data.from_source("PUBLIC_COMPANIES_KRS")

    manual = {
        *data.from_source("MINISTERSTWO_AKTYWOW_PANSTWOWYCH_KRSs"),
        *data.from_source("MINISTERSTWO_KULTURY_DZIEDZICTWA_NARODOWEGO"),
        *data.from_source("MINISTERSTWO_AKTYWOW_PANSTWOWYCH_KRSs"),
        *data.from_source("MINISTERSTWO_KULTURY_DZIEDZICTWA_NARODOWEGO"),
        *data.from_source("SPOLKI_SKARBU_PANSTWA"),
        *data.from_source("AMW"),
        *data.from_source("UZDROWISKA"),
        *data.from_source("WARSZAWA"),
        *data.from_source("MALOPOLSKIE"),
        *data.from_source("LUBELSKIE"),
        *data.from_source("LODZKIE"),
        *data.from_source("WROCLAW"),
        *data.from_source("KONIN"),
        *data.from_source("LESZNO"),
    }

    missing = manual - PUBLIC_COMPANIES_KRS

    assert len(PUBLIC_COMPANIES_KRS) > 0
    assert "0000000893" in PUBLIC_COMPANIES_KRS

    assert len(missing) <= 313, missing

    # TODO divide the missing by source, so we can tell what kind of data we don't currently have


def test_migration_to_single_list():
    iterator = itertools.chain(
        data.from_source("MINISTERSTWO_AKTYWOW_PANSTWOWYCH_KRSs"),
        data.from_source("SPOLKI_SKARBU_PANSTWA"),
        data.from_source("AMW"),
        data.from_source("WARSZAWA"),
        data.from_source("MALOPOLSKIE"),
        data.from_source("LODZKIE"),
        data.from_source("LUBELSKIE"),
        data.from_source("PUBLIC_COMPANIES_KRS"),
    )

    all_krs = set(iterator)
    common_row: dict[str, list[str]] = {}
    for krs in all_krs:
        common = krs[:COMMON_ROW]
        if common not in common_row:
            common_row[common] = []
        common_row[common].append(krs)

    if not os.path.exists(versioned.get_path("all_krs.txt")):
        with open(versioned.get_path(KRS_STARTERS_ALL), "w") as f:
            for common, ends in sorted(common_row.items(), key=lambda x: x[0]):
                f.write(",".join([common, *sorted(ends)]) + "\n")

    else:
        with open(versioned.get_path(KRS_STARTERS_ALL), "r") as f:
            found = set(
                krs for line in f.readlines() for krs in line.strip().split(",")[1:]
            )
            missing = found - all_krs
            assert len(missing) == 0, missing
