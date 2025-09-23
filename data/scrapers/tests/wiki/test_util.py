import copy

import pytest

from process_articles import PolitykInfobox


def test_polityk_infobox():
    """Should find categories"""
    infobox = "{{Polityk infobox|polityk = Lilian Fowler|grafika = Lilian Fowler from Argus.jpg|opis grafiki = |data urodzenia = 7 czerwca 1886|miejsce urodzenia = [[Cooma]]|data śmierci = 11 maja 1954|miejsce śmierci = [[Sydney]]|funkcja = Burmistrz Newtown|partia = |od = 1938|do = 1940|poprzednik = Isidore Ryan|następca = Raymond Beaufils|commons = |quote =}}"
    result = PolitykInfobox.parse(infobox)
    assert result is not None
    assert len(result.fields) > 0
    assert "polityk" in result.fields
    assert "grafika" in result.fields
    assert "opis grafiki" in result.fields
    assert "data urodzenia" in result.fields

    print(result.fields)
