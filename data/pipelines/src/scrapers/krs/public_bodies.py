"""The public owners that are neither a government nor a company with a KRS number.

Unions of gminas, the metropolis, and state agencies, funds and banks own
companies under their own names. `JstIndex` places only gminas, powiaty,
województwa and the Treasury, and the parent test follows only KRS numbers, so
nothing else in the register says these owners are public. They are named
here, for both readers of an owner's name: `CompaniesKRS`, which decides what
the site marks public, and the register door, `public_owners`.

Deliberately a closed list: a prefix like "AGENCJA" or "INSTYTUT" is as often
an advertising agency as a state one.
"""

from scrapers.map.jst import normalise

#: Public legal persons that own companies without a KRS number of their own,
#: as the start of their normalised name. Found by reading every owner in a
#: 1,750-entry sample of the register that was neither a person, a company nor
#: a government `JstIndex` places - KOWR was the one public name among 137 -
#: plus the bodies `names_an_owner` already names as the ones REGON has to
#: answer for.
PUBLIC_BODY_PREFIXES = (
    # Unions of local governments, which hold utilities for their members.
    "ZWIAZEK GMIN",
    "ZWIAZEK MIEDZYGMINNY",
    "MIEDZYGMINNY ZWIAZEK",
    "ZWIAZEK POWIATOW",
    "ZWIAZEK POWIATOWO",
    "ZWIAZEK KOMUNALNY",
    "KOMUNALNY ZWIAZEK",
    "ZWIAZEK KOMUNIKACYJNY",
    "GORNOSLASKO-ZAGLEBIOWSKA METROPOLIA",
    "GORNOSLASKO - ZAGLEBIOWSKA METROPOLIA",
    "METROPOLIA",
    # State agencies and funds.
    "KRAJOWY OSRODEK WSPARCIA ROLNICTWA",
    "AGENCJA NIERUCHOMOSCI ROLNYCH",
    "AGENCJA WLASNOSCI ROLNEJ SKARBU PANSTWA",
    "AGENCJA MIENIA WOJSKOWEGO",
    "WOJSKOWA AGENCJA MIESZKANIOWA",
    # The state's housing land bank, which sets up the SIM housing companies
    # with gminas. Where no gmina holds 10%, it is the only owner the register
    # names, as for SIM "KZN-Zachodni" (0000920074).
    "KRAJOWY ZASOB NIERUCHOMOSCI",
    "AGENCJA RESTRUKTURYZACJI I MODERNIZACJI ROLNICTWA",
    "PANSTWOWE GOSPODARSTWO LESNE",
    "LASY PANSTWOWE",
    "PANSTWOWE GOSPODARSTWO WODNE",
    "NARODOWY FUNDUSZ OCHRONY SRODOWISKA",
    "WOJEWODZKI FUNDUSZ OCHRONY SRODOWISKA",
    # The Treasury's restructuring fund. A closed-end fund is registered with
    # the court's fund register, not KRS, so its companies name it with no
    # number: it held ENERGOMONTAŻ-PÓŁNOC GDYNIA (0000017026) from 2013 to the
    # day the company was struck off in 2016 (odpis pełny, entries 34-46).
    "MARS FUNDUSZ INWESTYCYJNY ZAMKNIETY",
    # The bank guarantee fund, a state legal person set up by statute. Sole
    # shareholder of DRUGI BANK BFG (0000825574) until it was struck off.
    "BANKOWY FUNDUSZ GWARANCYJNY",
    "BANK GOSPODARSTWA KRAJOWEGO",
    "NARODOWY BANK POLSKI",
    "ZAKLAD UBEZPIECZEN SPOLECZNYCH",
    "PANSTWOWY FUNDUSZ REHABILITACJI",
    "POLSKA AKADEMIA NAUK",
    "SIEC BADAWCZA LUKASIEWICZ",
    "NARODOWE CENTRUM BADAN I ROZWOJU",
)


def public_body(name: str) -> bool:
    """Whether an owner's name is one of `PUBLIC_BODY_PREFIXES`."""
    text = normalise(name).strip(' "')
    return any(text.startswith(prefix) for prefix in PUBLIC_BODY_PREFIXES)
