import os

import itertools

from util.config import versioned
import scrapers.krs.data as data


def test_public_companies_list():
    PUBLIC_COMPANIES_KRS = data.from_source("PUBLIC_COMPANIES_KRS")

    manual = {
        *data.MINISTERSTWO_AKTYWOW_PANSTWOWYCH_KRSs,
        *data.MINISTERSTWO_KULTURY_DZIEDZICTWA_NARODOWEGO,
        *data.MINISTERSTWO_AKTYWOW_PANSTWOWYCH_KRSs,
        *data.MINISTERSTWO_KULTURY_DZIEDZICTWA_NARODOWEGO,
        *data.SPOLKI_SKARBU_PANSTWA,
        *data.AMW,
        *data.UZDROWISKA,
        *data.WARSZAWA,
        *data.MALOPOLSKIE,
        *data.LUBELSKIE,
        *data.LODZKIE,
        *data.WROCLAW,
        *data.KONIN,
        *data.LESZNO,
    }

    missing = manual - PUBLIC_COMPANIES_KRS

    assert len(PUBLIC_COMPANIES_KRS) > 0
    assert "0000000893" in PUBLIC_COMPANIES_KRS

    assert len(missing) <= 313, missing

    # TODO divide the missing by source, so we can tell what kind of data we don't currently have


def test_migration_to_single_list():
    iterator = itertools.chain(
        data.MINISTERSTWO_AKTYWOW_PANSTWOWYCH_KRSs,
        data.SPOLKI_SKARBU_PANSTWA,
        data.AMW,
        data.WARSZAWA,
        data.MALOPOLSKIE,
        data.LODZKIE,
        data.LUBELSKIE,
        data.from_source("PUBLIC_COMPANIES_KRS"),
    )

    all_krs = set(iterator)

    if not os.path.exists(versioned.get_path("all_krs.txt")):
        with open(versioned.get_path("all_krs.txt"), "w") as f:
            f.write("\n".join(all_krs))
    else:
        with open(versioned.get_path("all_krs.txt"), "r") as f:
            found = set(line.strip() for line in f.readlines())
            missing = found - all_krs
            assert len(missing) == 0, missing
