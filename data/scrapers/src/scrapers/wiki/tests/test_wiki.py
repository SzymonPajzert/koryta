from regex import search

from scrapers.wiki.process_articles import Infobox, safe_middle_name_pattern

problematic_titles = """
? (album Hey)
** ****** (album)
+ (album)
+ + +
+ piekło + niebo +
+18
5 * Stunna
Animal (F**k Like a Beast)
Do * w sztambuch
Do ***
Kopalnia Węgla Kamiennego „Śląsk”
Sunn O)))
The End of the F***ing World
"""


def test_title_parsed():
    for title in problematic_titles.split("\n"):
        title = title.strip()
        pattern = safe_middle_name_pattern(title)
        # Make sure, that all the special characters are expected
        try:
            search(pattern, title)
        except Exception:
            assert False, f"Failing to parse '{title}'"


def test_polityk_infobox():
    """Should find categories"""
    infobox = "{{Polityk infobox|polityk = Lilian Fowler|grafika = Lilian Fowler from Argus.jpg|opis grafiki = |data urodzenia = 7 czerwca 1886|miejsce urodzenia = [[Cooma]]|data śmierci = 11 maja 1954|miejsce śmierci = [[Sydney]]|funkcja = Burmistrz Newtown|partia = |od = 1938|do = 1940|poprzednik = Isidore Ryan|następca = Raymond Beaufils|commons = |quote =}}"
    results = Infobox.parse(infobox)
    assert results is not None
    for result in results:
        assert len(result.fields) > 0
        assert "polityk" in result.fields
        assert "grafika" in result.fields
        assert "opis grafiki" in result.fields
        assert "data urodzenia" in result.fields

        print(result.fields)
