"""Where to start looking for a unit's declarations: its office's BIP, or its website.

A unit is PKW's six digits, what ``BipPersonOfInterest.teryt`` holds: ``WWPPGG``
a gmina (or a Warsaw dzielnica), ``WWPP00`` a powiat, ``WW0000`` a województwo.
Its declarations are on the BIP of the office that serves its council: the
urząd gminy or miasta, the starostwo, the urząd marszałkowski.

Two lists of institutions say where those are. The gov.pl BIP registry (the
crawler's own host list) gives a BIP address, but has an office for only 905
of 2,479 gminas, 139 of 314 powiats and 13 of 16 województwa (measured
2026-10-29). The dane.gov.pl catalogue of public bodies lists every urząd
gminy, starostwo and urząd marszałkowski with a ``Strona www``: the office's
website, which links to its BIP more often than it is one.

Neither names the unit by its code the way PKW does, so this resolves them:

- A registry entry carries TERC's seven-digit code of the place the office
  stands in. A rural gmina's office often stands in the town of the same
  name (Urząd Gminy Garwolin, in the town of Garwolin, 1403011), which is a
  different gmina: the office's own name ("Gminy" or "Miasta") picks the right
  one of the pair.
- A starostwo of a land powiat may stand in a city with powiat rights (the
  krośnieński powiat's in Krosno, 1861): both lists then give the city. The
  land powiat of that województwo whose name starts like the city's is meant.
- The catalogue gives names; 143 gmina names are a town and the rural gmina
  around it, told apart the same way, and a big city's office names a
  district (Kraków Śródmieście) as its gmina.

Hosts that serve several units' BIPs (bip.malopolska.pl, samorzad.gov.pl) keep
each unit under its own path (``scopes``).

Pure functions: the crawler job reads the registry XML, the catalogue and TERC.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field

import pandas as pd

from entities.util import NormalizedParse
from scrapers.bip.registry import RegistryEntry, host_from_url

#: TERC's kinds of gmina (RODZ): 1 urban, 2 rural, 3 urban-rural, 8 a Warsaw
#: dzielnica. 4 and 5, the town and rural part of a 3, share its code.
URBAN, RURAL, MIXED, DZIELNICA = "1", "2", "3", "8"
_KIND_WORDS = {
    URBAN: "gmina miejska",
    RURAL: "gmina wiejska",
    MIXED: "gmina miejsko-wiejska",
    DZIELNICA: "dzielnica",
}

_GMINA_OFFICE = re.compile(
    r"^(urzad\s+(gminy|miasta|miejski|miasta i gminy|gminy i miasta|miejsko[ -]gminny|"
    r"m\s*st|dzielnicy)|gmina\b|miasto\b)"
)
_POWIAT_OFFICE = re.compile(r"^(starostwo\b|powiat\s)")
_WOJ_OFFICE = re.compile(r"^urzad\s+marszalkowski")
#: "Urząd Gminy X", "Gmina X" - but not "Gmina Miejska X" nor "... i Miasta".
_RURAL_OFFICE = re.compile(r"^(urzad\s+gminy|gmina\b)(?!.*(miejsk|miast))")
#: "Urząd Miasta X", "Urząd Miejski", "Miasto X", "Gmina Miejska X" - not "... i Gminy".
_URBAN_OFFICE = re.compile(
    r"^(urzad\s+(miasta|miejski)|miasto\b|gmina\s+miejska|urzad\s+gminy\s+miejskiej)"
    r"(?!.*\b(i|oraz)\s+gmin)"
)
#: A page of one office on Madkom's shared BIP: <office>,<type>,<id>,<slug>.html.
_MADKOM_PAGE = re.compile(r"([^.,=]+),[a-z],\d+(?:,|\.html|$)")
#: Catalogue types that are offices serving a council.
CATALOGUE_TYPES = {
    "urzędy miast i gmin": "gmina",
    "starostwa powiatowe": "powiat",
    "urzędy marszałkowskie": "wojewodztwo",
}


def fold(text: object) -> str:
    """Lower case, no diacritics, single spaces: how names are compared here."""
    raw = unicodedata.normalize("NFKD", str(text or "").lower().replace("ł", "l"))
    ascii_only = raw.encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", ascii_only).strip()


def office_level(name: str) -> str | None:
    """Which council's office an institution is, by its name, or None."""
    folded = fold(name)
    if _WOJ_OFFICE.match(folded):
        return "wojewodztwo"
    if _POWIAT_OFFICE.match(folded):
        return "powiat"
    if _GMINA_OFFICE.match(folded):
        return "gmina"
    return None


def office_kind(name: str) -> str | None:
    """RURAL for "Urząd Gminy X", URBAN for "Urząd Miasta X", else None."""
    folded = fold(name)
    if _RURAL_OFFICE.match(folded):
        return RURAL
    if _URBAN_OFFICE.match(folded):
        return URBAN
    return None


@dataclass(frozen=True)
class Terc:
    """What the resolution needs from TERC, by PKW's six digits."""

    gmina_names: dict[str, str]
    gmina_kinds: dict[str, str]
    powiat_names: dict[str, str]
    woj_codes: dict[str, str]
    woj_names: dict[str, str] = field(default_factory=dict)

    def unit_name(self, teryt: str) -> str:
        """A unit's name for people: "Strzelin (gmina miejsko-wiejska)",
        "powiat garwoliński", "województwo mazowieckie"; "" when TERC lacks it."""
        if teryt.endswith("0000"):
            name = self.woj_names.get(teryt[:2], "")
            return f"województwo {name.lower()}" if name else ""
        if teryt.endswith("00"):
            name = self.powiat_names.get(teryt[:4], "")
            return f"powiat {name}" if name else ""
        name = self.gmina_names.get(teryt[:6], "")
        kind = _KIND_WORDS.get(self.gmina_kinds.get(teryt[:6], ""), "")
        return f"{name} ({kind})" if name and kind else name

    def gminas_named(self, powiat: str, name: str) -> list[str]:
        wanted = fold(name)
        return sorted(
            c
            for c, n in self.gmina_names.items()
            if c[:4] == powiat and fold(n) == wanted
        )

    def powiat_named(self, woj: str, name: str) -> str | None:
        wanted = fold(name)
        found = [
            c
            for c, n in self.powiat_names.items()
            if c[:2] == woj and fold(n) == wanted
        ]
        return found[0] if len(found) == 1 else None


def terc_index(frame: pd.DataFrame) -> Terc:
    """From TERC's CSV (columns WOJ, POW, GMI, RODZ, NAZWA, all text)."""
    gmina_names: dict[str, str] = {}
    gmina_kinds: dict[str, str] = {}
    powiat_names: dict[str, str] = {}
    woj_codes: dict[str, str] = {}
    woj_names: dict[str, str] = {}
    for row in frame.fillna("").itertuples(index=False):
        woj, pow_, gmi, kind, name = (
            str(getattr(row, c)) for c in ("WOJ", "POW", "GMI", "RODZ", "NAZWA")
        )
        if not pow_:
            woj_codes[fold(name)] = woj
            woj_names[woj] = name
        elif not gmi:
            powiat_names[woj + pow_] = name
        elif kind in (URBAN, RURAL, MIXED, DZIELNICA):
            gmina_names[woj + pow_ + gmi] = name
            gmina_kinds[woj + pow_ + gmi] = kind
    return Terc(gmina_names, gmina_kinds, powiat_names, woj_codes, woj_names)


def is_city_powiat(powiat: str) -> bool:
    """Cities with powiat rights are numbered from 61 within their województwo."""
    return powiat[2:4] >= "61"


#: The land powiats whose starostwo stands in a city with powiat rights, by the
#: city. The two lists name the city as the starostwo's seat; the powiat's name
#: is the city's adjective, but no rule on the letters gets all of them
#: (Łódź - łódzki wschodni, Jelenia Góra - jeleniogórski) without also
#: "finding" one for cities that have none (Szczecin, Gdynia, Warszawa).
LAND_POWIAT_SEATED_IN = {
    "jelenia gora": "jeleniogórski",
    "legnica": "legnicki",
    "wroclaw": "wrocławski",
    "walbrzych": "wałbrzyski",
    "bydgoszcz": "bydgoski",
    "grudziadz": "grudziądzki",
    "torun": "toruński",
    "wloclawek": "włocławski",
    "biala podlaska": "bialski",
    "chelm": "chełmski",
    "lublin": "lubelski",
    "zamosc": "zamojski",
    "gorzow wielkopolski": "gorzowski",
    "zielona gora": "zielonogórski",
    "lodz": "łódzki wschodni",
    "piotrkow trybunalski": "piotrkowski",
    "skierniewice": "skierniewicki",
    "krakow": "krakowski",
    "nowy sacz": "nowosądecki",
    "tarnow": "tarnowski",
    "ostroleka": "ostrołęcki",
    "plock": "płocki",
    "radom": "radomski",
    "siedlce": "siedlecki",
    "opole": "opolski",
    "krosno": "krośnieński",
    "przemysl": "przemyski",
    "rzeszow": "rzeszowski",
    "tarnobrzeg": "tarnobrzeski",
    "bialystok": "białostocki",
    "lomza": "łomżyński",
    "suwalki": "suwalski",
    "slupsk": "słupski",
    "bielsko biala": "bielski",
    "czestochowa": "częstochowski",
    "gliwice": "gliwicki",
    "rybnik": "rybnicki",
    "kielce": "kielecki",
    "elblag": "elbląski",
    "olsztyn": "olsztyński",
    "kalisz": "kaliski",
    "konin": "koniński",
    "leszno": "leszczyński",
    "poznan": "poznański",
    "koszalin": "koszaliński",
}


def land_powiat_of_city(terc: Terc, city_powiat: str, city_name: str) -> str | None:
    """The land powiat whose starostwo stands in this city with powiat rights."""
    land = LAND_POWIAT_SEATED_IN.get(fold(city_name))
    if land is None:
        return None
    return terc.powiat_named(city_powiat[:2], land)


def _pick_by_kind(terc: Terc, codes: list[str], kind: str | None) -> str | None:
    """The one code of ``kind`` (a mixed gmina fits either), or the only code when
    the office does not say its kind; None when the kinds contradict."""
    if kind is not None:
        codes = [c for c in codes if terc.gmina_kinds.get(c) in (kind, MIXED)]
    return codes[0] if len(codes) == 1 else None


def _rural_gmina_around_city(
    terc: Terc, city_gmina: str, kind: str | None
) -> str | None:
    """A rural gmina's office standing in the city with powiat rights it is named
    after (Urząd Gminy Chełm, in Chełm): the gmina is in the land powiat."""
    if kind != RURAL or not is_city_powiat(city_gmina[:4]):
        return None
    city = terc.powiat_names.get(city_gmina[:4], "")
    land = land_powiat_of_city(terc, city_gmina[:4], city)
    if land is None:
        return None
    return _pick_by_kind(
        terc, terc.gminas_named(land, terc.gmina_names.get(city_gmina, city)), kind
    )


def registry_unit(entry: RegistryEntry, terc: Terc) -> str | None:
    """The unit an office in the gov.pl registry serves, or None for other bodies."""
    level = office_level(entry.name)
    code = re.sub(r"\D", "", entry.teryt or "")
    if level is None or len(code) < 6:
        return None
    if level == "wojewodztwo":
        return code[:2] + "0000"
    if level == "powiat":
        powiat = code[:4]
        if is_city_powiat(powiat) and fold(entry.name).startswith("starostwo"):
            land = land_powiat_of_city(terc, powiat, terc.powiat_names.get(powiat, ""))
            if land is None:
                return None
            powiat = land
        return powiat + "00"
    gmina = code[:6]
    kind = office_kind(entry.name)
    if kind is not None and terc.gmina_kinds.get(gmina) not in (kind, MIXED):
        # The office stands in the other gmina of a town-and-country pair.
        pair = _pick_by_kind(
            terc, terc.gminas_named(gmina[:4], terc.gmina_names.get(gmina, "")), kind
        )
        return pair or _rural_gmina_around_city(terc, gmina, kind)
    return gmina


def catalogue_unit(row: dict, terc: Terc) -> str | None:
    """The unit a catalogue office serves, from the names of where it stands."""
    level = CATALOGUE_TYPES.get(str(row.get("Typ podmiotu", "")).strip())
    woj = terc.woj_codes.get(fold(row.get("Województwo siedziby")))
    if level is None or woj is None:
        return None
    if level == "wojewodztwo":
        return woj + "0000"
    powiat_name = str(row.get("Powiat siedziby") or "")
    gmina_name = str(row.get("Gmina siedziby") or "")
    powiat = terc.powiat_named(woj, powiat_name) or terc.powiat_named(woj, gmina_name)
    if powiat is None:
        return None
    if level == "powiat":
        if is_city_powiat(powiat):
            land = land_powiat_of_city(terc, powiat, powiat_name or gmina_name)
            return land + "00" if land else None
        return powiat + "00"
    codes = terc.gminas_named(powiat, gmina_name)
    if not codes and is_city_powiat(powiat):
        # A big city's office names a district (Kraków Śródmieście) as its gmina.
        codes = [
            c
            for c in terc.gmina_names
            if c[:4] == powiat and terc.gmina_kinds.get(c) == URBAN
        ]
    kind = office_kind(str(row.get("Nazwa podmiotu", "")))
    picked = _pick_by_kind(terc, codes, kind)
    if picked is None and len(codes) == 1:
        return _rural_gmina_around_city(terc, codes[0], kind)
    return picked


@dataclass
class UnitSeed:
    """Where to look for one unit's declarations."""

    unit: str
    bip_urls: list[str] = field(default_factory=list)
    www_urls: list[str] = field(default_factory=list)
    #: "host" or "host/prefix": the pages that belong to this unit.
    scopes: list[str] = field(default_factory=list)
    names: list[str] = field(default_factory=list)


def _with_scheme(url: str) -> str:
    url = url.strip()
    return url if re.match(r"^https?://", url, re.I) else f"http://{url}"


def scope_of(url: str, shared_hosts: set[str]) -> str:
    """The host, and on a shared platform the unit's first path segment(s)."""
    host = host_from_url(url)
    if host not in shared_hosts:
        return host
    segments = [
        s for s in NormalizedParse.parse(_with_scheme(url)).path.lower().split("/") if s
    ]
    office = _MADKOM_PAGE.match(segments[0]) if len(segments) == 1 else None
    if office:
        # Madkom's <office>,m,<id>,<slug>.html: a page of the office's own.
        segments = [office.group(1)]
    elif segments and re.search(r"[.,=]", segments[-1]):
        segments = segments[:-1]  # a page, not a section
    keep = 2 if segments and segments[0] in ("web", "bip", "index", "start") else 1
    return host + ("/" + "/".join(segments[:keep]) if segments[:keep] else "")


def unit_seeds(
    entries: list[RegistryEntry], catalogue: pd.DataFrame | None, terc: Terc
) -> dict[str, UnitSeed]:
    """Every unit either list has an office for, with where to start."""
    seeds: dict[str, UnitSeed] = {}
    units_by_host: dict[str, set[str]] = defaultdict(set)
    for entry in entries:
        unit = registry_unit(entry, terc)
        if unit is None or not entry.host:
            continue
        seed = seeds.setdefault(unit, UnitSeed(unit))
        url = _with_scheme(entry.url)
        if url not in seed.bip_urls:
            seed.bip_urls.append(url)
            seed.names.append(entry.name)
        units_by_host[entry.host].add(unit)
    if catalogue is not None:
        for row in catalogue.to_dict(orient="records"):
            www = str(row.get("Strona www") or "").strip()
            unit = catalogue_unit(row, terc) if www and www.lower() != "nan" else None
            if unit is None:
                continue
            seed = seeds.setdefault(unit, UnitSeed(unit))
            url = _with_scheme(www)
            if url not in seed.www_urls:
                seed.www_urls.append(url)
                seed.names.append(str(row.get("Nazwa podmiotu", "")))
    shared = {host for host, units in units_by_host.items() if len(units) > 1}
    shared.add("samorzad.gov.pl")
    for seed in seeds.values():
        seed.scopes = sorted({scope_of(u, shared) for u in seed.bip_urls})
    # A Warsaw dzielnica's council files its declarations with the dzielnica's
    # office; where neither list has one, the city's BIP is where to look.
    for code, kind in terc.gmina_kinds.items():
        city = seeds.get(code[:4] + "01")
        if kind == DZIELNICA and code not in seeds and city is not None:
            seeds[code] = UnitSeed(
                code,
                list(city.bip_urls),
                list(city.www_urls),
                list(city.scopes),
                [
                    f"{n} (dzielnica {terc.gmina_names.get(code, code)})"
                    for n in city.names
                ],
            )
    return seeds
