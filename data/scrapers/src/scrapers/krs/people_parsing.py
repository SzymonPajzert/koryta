"""Parsing of censored people from api-krs.ms.gov.pl JSON responses.

Extracts the masked name/PESEL data from the OdpisAktualny JSON structure,
covering dzial1 (partners) and dzial2 (representation, supervision, proxies).
"""


def parse_person(p: dict) -> tuple | None:
    """Parse a single person dict into a (nazwisko, imie, imie2, pesel) tuple."""
    if not isinstance(p, dict):
        return None
    nazwisko = (
        p.get("nazwisko", {}).get("nazwiskoICzlon", "")
        if isinstance(p.get("nazwisko"), dict)
        else ""
    )
    imie = (
        p.get("imiona", {}).get("imie", "")
        if isinstance(p.get("imiona"), dict)
        else ""
    )
    imie2 = (
        p.get("imiona", {}).get("imieDrugie", "")
        if isinstance(p.get("imiona"), dict)
        else ""
    )
    pesel = (
        p.get("identyfikator", {}).get("pesel", "")
        if isinstance(p.get("identyfikator"), dict)
        else ""
    )
    if nazwisko or imie or pesel:
        return (nazwisko, imie, imie2, pesel)
    return None


def extract_sklad(
    container: dict, key: str, role_prefix: str, role_field: str,
) -> list[tuple]:
    """Extract people from a 'sklad' list inside a container dict."""
    results: list[tuple] = []
    section = container.get(key, {})
    if not isinstance(section, dict):
        return results
    sklad = section.get("sklad", [])
    if not isinstance(sklad, list):
        return results
    for p in sklad:
        parsed = parse_person(p)
        if parsed:
            fn = p.get(role_field, "") if isinstance(p, dict) else ""
            results.append((*parsed, f"{role_prefix}: {fn}"))
    return results


def extract_dzial1_people(dane: dict) -> set[tuple]:
    """Extract people from dzial1 (wspolnicySpzoo)."""
    people: set[tuple] = set()
    dzial1 = dane.get("dzial1", {})
    if not isinstance(dzial1, dict):
        return people
    for w in dzial1.get("wspolnicySpzoo", []):
        parsed = parse_person(w)
        if parsed:
            people.add((*parsed, "wspolnik"))
    return people


def extract_dzial2_people(dane: dict) -> set[tuple]:
    """Extract people from dzial2 (representation, supervision, etc.)."""
    people: set[tuple] = set()
    dzial2 = dane.get("dzial2", {})
    if not isinstance(dzial2, dict):
        return people

    # reprezentacja / prokurenci (sklad-based)
    for t in extract_sklad(
        dzial2, "reprezentacja", "reprezentacja", "funkcjaWOrganie",
    ):
        people.add(t)
    for t in extract_sklad(
        dzial2, "prokurenci", "prokurent", "rodzajProkury",
    ):
        people.add(t)

    # organNadzoru (can be list or dict)
    organ_nadzoru = dzial2.get("organNadzoru", {})
    organs = (
        organ_nadzoru
        if isinstance(organ_nadzoru, list)
        else [organ_nadzoru]
    )
    for organ in organs:
        if isinstance(organ, dict):
            for t in extract_sklad(
                {"o": organ}, "o", "nadzor", "funkcjaWOrganie",
            ):
                people.add(t)

    # reprezentacjaIBIGBPPSPZOZ (single person dict)
    rep_pzoz = dzial2.get("reprezentacjaIBIGBPPSPZOZ", {})
    if isinstance(rep_pzoz, dict):
        parsed = parse_person(rep_pzoz)
        if parsed:
            people.add((*parsed, "kierownik_pzoz"))

    # pelnomocnicy / osobyReprezentujacePZ (plain lists)
    for key, role in [
        ("pelnomocnicy", "pelnomocnik"),
        ("osobyReprezentujacePZ", "osoba_pz"),
    ]:
        for p in dzial2.get(key, []):
            parsed = parse_person(p)
            if parsed:
                people.add((*parsed, role))

    return people


def extract_censored_people(data: dict) -> set[tuple]:
    """Extract all censored people from an api-krs JSON response.

    Returns a set of (nazwiskoICzlon, imie, imieDrugie, pesel, role).
    """
    if not isinstance(data, dict) or "odpis" not in data:
        return set()

    dane = data["odpis"].get("dane", {})
    if not isinstance(dane, dict):
        return set()

    return extract_dzial1_people(dane) | extract_dzial2_people(dane)
