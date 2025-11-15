import os

import itertools

from util.config import versioned
import scrapers.krs.data as data


def test_public_companies_list():
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

    missing = manual - set(data.PUBLIC_COMPANIES_KRS)

    assert len(missing) == 0, missing


def test_migration_to_single_list():
    all_krs = set(
        itertools.chain(
            data.MINISTERSTWO_AKTYWOW_PANSTWOWYCH_KRSs,
            data.SPOLKI_SKARBU_PANSTWA,
            data.AMW,
            data.WARSZAWA,
            data.MALOPOLSKIE,
            data.LODZKIE,
            data.LUBELSKIE,
            data.PUBLIC_COMPANIES_KRS,
        )
    )

    if not os.path.exists(versioned.get_path("all_krs.txt")):
        with open(versioned.get_path("all_krs.txt"), "w") as f:
            f.write("\n".join(all_krs))
    else:
        with open(versioned.get_path("all_krs.txt"), "r") as f:
            found = set(line.strip() for line in f.readlines())
            missing = found - all_krs
            assert len(missing) == 0, missing
