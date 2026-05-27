from scrapers.krs.scrape import KRSScraped


def test_krs_scraped_parse_api_krs():
    url1 = "gs://koryta-pl-crawled/hostname=api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000952604/date=2026-02-13"
    result1 = KRSScraped.parse(url1)
    assert result1 is not None
    assert result1.krs == "0000952604"
    assert result1.date == "2026-02-13"
    assert result1.method == "api-krs"

    url2 = "gs://koryta-pl-crawled/hostname=api-krs.ms.gov.pl/date=2025-10-26/api/krs/OdpisAktualny/0000024375"
    result2 = KRSScraped.parse(url2)
    assert result2 is not None
    assert result2.krs == "0000024375"
    assert result2.date == "2025-10-26"
    assert result2.method == "api-krs"
