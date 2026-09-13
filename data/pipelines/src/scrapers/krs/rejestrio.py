"""What a rejestr.io connection query costs, and the URL that asks it.

Split out from the population being asked about, because the price and the
route are properties of the service rather than of whichever spend register
picked the companies. Both a sponsorship list and the CRU register walk the
same two URLs at the same 0.05 PLN.
"""


#: The rejestr.io connection queries worth asking of a company once its KRS is
#: known. Both are needed and they are not interchangeable: `aktualne` is who
#: sits there now, `historyczne` is everyone who used to -- and a politician who
#: resigned the month before the money arrived is only in the second.
REJESTRIO_QUERIES = ("aktualne", "historyczne")

#: Zloty per rejestr.io call, matching `scrapers.krs.scrape.RejestrIOQuery.cost`.
PLN_PER_CALL = 0.05


def rejestrio_urls(krs: str, with_org_record: bool = False) -> tuple[str, ...]:
    """Both connection lists for one KRS number, and the org record on request.

    The org record is off by default: it carries no connections, and its name,
    city and teryt are already in the free api-krs odpis.
    """
    padded = str(krs).rjust(10, "0")
    base = f"https://rejestr.io/api/v2/org/{padded}"
    connections = tuple(
        f"{base}/krs-powiazania?aktualnosc={a}" for a in REJESTRIO_QUERIES
    )
    return (base, *connections) if with_org_record else connections


def cost_pln(companies: int, with_org_record: bool = False) -> float:
    """What asking rejestr.io about this many companies costs.

    Two calls each -- the connection lists, which are the only ones that carry
    people. ``with_org_record=True`` adds the company's own entry at 0.05 PLN
    more each, which is worth it only for rejestr.io's teryt.
    """
    per_company = len(REJESTRIO_QUERIES) + (1 if with_org_record else 0)
    return companies * per_company * PLN_PER_CALL
