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
