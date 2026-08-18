"""Sole traders, from CEIDG.

Four in five flood-aid beneficiaries are a jednoosobowa działalność gospodarcza
or a spółka cywilna. KRS knows nothing about them and CRBR is closed, so the
only register that names the human being behind one is CEIDG.

What it is for here is narrow. koryta.pl tracks people in public life, and the
question worth asking of this data is whether any of them took flood aid through
a business of their own. That is a question about the ~6100 people already on
the site, not about the 2045 sole traders - so nothing here ever creates a
person. It resolves a NIP to a name and a seat, and the rollup then looks for
that name among people koryta.pl already has.

**A name is not an identity.** Matching the 2045 sole traders against the 6113
people on the site by name alone returns 21 hits, and all 21 are in a different
powiat from the person they matched - Grzegorz Lach's business took 514 k PLN in
powiat nyski while the councillor of that name sits in powiat płocki. Poland has
a lot of Krzysztof Nowaks. So `owner_of` returns the seat alongside the name and
the rollup will not propose a link without both; see `_owner_match`.

## Access

Needs a free API key: apply at https://biznes.gov.pl/pl/e-uslugi/00_9999_00
(Profil Zaufany or mObywatel), and it arrives by email. Put it in
`koryta AidPayloads --ceidg-key`. Nothing here reads the environment itself -
`scrapers` may not import `os`, and the key is a CLI argument for the same
reason every other secret in this tree is. Without one the rollup falls back to
the biała lista, which gives a sole trader's name but not a clean split into
imię and nazwisko, and gives nothing at all for a spółka cywilna.

The response shape below is written from the integrator documentation rather
than from a live call, since the key is applied for rather than issued. Every
field is read defensively and a firm that does not parse is skipped rather than
guessed at.
"""

import typing

import requests

BASE = "https://dane.biznes.gov.pl/api/ceidg/v3"

#: CEIDG's own cap on identifiers per request.
BATCH = 20


class CeidgError(RuntimeError):
    pass


def _first(source: dict, *names: str) -> str:
    """The first of several spellings a field is documented under."""
    for name in names:
        value = source.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


@typing.no_type_check
def _owner(firm: dict) -> dict[str, str] | None:
    owner = firm.get("wlasciciel") or firm.get("owner") or {}
    given = _first(owner, "imie", "imiePierwsze", "firstName")
    family = _first(owner, "nazwisko", "lastName")
    if not (given and family):
        return None

    address = (
        firm.get("adresDzialalnosci")
        or firm.get("adresKorespondencyjny")
        or firm.get("address")
        or {}
    )
    return {
        "nip": _first(owner, "nip") or _first(firm, "nip"),
        "name": f"{given} {family}",
        # TERC is the TERYT code of the gmina the business is registered in.
        # Truncated to a powiat by the caller, which is the level koryta.pl's
        # region nodes are complete at.
        "teryt": _first(address, "terc", "gmina_terc", "kodTerc"),
        "powiat": _first(address, "powiat"),
        "gmina": _first(address, "gmina"),
        "status": _first(firm, "status"),
    }


def owner_of(nips: typing.Iterable[str], api_key: str) -> dict[str, dict[str, str]]:
    """Maps each NIP to the human being registered as running that business.

    Only firms CEIDG answered for, and only those with both a given and a family
    name on the record, appear in the result. A spółka cywilna has several
    partners and CEIDG lists each of them as a separate firm sharing the
    company's NIP; the first one back wins, which is enough to raise the
    question and not enough to answer it - which is why nothing published comes
    out of this without review.
    """
    headers = {"Authorization": f"Bearer {api_key}"}
    unique = sorted({nip for nip in nips if nip})
    owners: dict[str, dict[str, str]] = {}

    for start in range(0, len(unique), BATCH):
        chunk = unique[start : start + BATCH]
        response = requests.get(
            f"{BASE}/firmy",
            params=[("nip", nip) for nip in chunk],
            headers=headers,
            timeout=60,
        )
        if response.status_code == 401:
            raise CeidgError(
                "CEIDG rejected the key. Apply for one at "
                "https://biznes.gov.pl/pl/e-uslugi/00_9999_00 and pass it as "
                "--ceidg-key."
            )
        if response.status_code >= 400:
            raise CeidgError(f"{response.status_code}: {response.text[:200]!r}")

        payload = response.json()
        firms = payload.get("firmy") or payload.get("dane") or []
        for firm in firms:
            owner = _owner(firm)
            if owner and owner["nip"] and owner["nip"] not in owners:
                owners[owner["nip"]] = owner

    return owners
