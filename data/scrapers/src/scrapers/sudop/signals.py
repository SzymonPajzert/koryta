"""Which flood-aid beneficiaries are worth a second look, and which test is a trap.

The published analyses of this data flag a beneficiary that collected **eight or
more decisions**. Measured over the whole register, that rule is worse than
useless as a way of finding the interesting recipients:

- 71 beneficiaries have 8+ decisions and hold **9.78%** of the 699.2 M PLN.
  1340 beneficiaries have **exactly one** decision and hold **9.72%** - the same
  pot, spread over nineteen times as many companies.
- 130 beneficiaries took more than a million złoty. The rule catches 20 of them
  and misses 110. Eight of the 130 got it in a single decision.
- What a high decision count actually measures is how many separate offices and
  instruments an applicant queued at: the 8+ group averages 2.59 grantors and
  4.13 aid forms against 1.00 and 1.00 for the single-decision group. It is a
  measure of persistence, not of size and not of irregularity. It also is not
  stable - it climbs every time SUDOP is refreshed, and it moves if a grantor
  splits one award across two documents.
- The "ZUS files one decision a month" explanation is false: ZUS never issued
  more than six decisions to one beneficiary, and the 8+ bucket is *less* ZUS
  (33.5%) than the single-decision bucket (64.3%).

So nothing here counts decisions. The signals below are structural: each asks
whether something about the beneficiary or the grant is out of place, and each
is deliberately blind to how many documents it took and to how large the grant
is. On the register as it stands their union flags 277 beneficiaries covering
19.6% of the money - twice what the 8+ rule finds - and 36% of them have exactly
one decision, which is the base rate. That is the test that matters: a signal
whose flagged set has a *lower* share of single-decision beneficiaries than the
register does is just re-finding the big fish.

None of these is an accusation. Every one has an ordinary explanation available.
"""

import typing

#: Województwo codes that took essentially all of this aid: dolnośląskie,
#: opolskie, śląskie. 9171 of the 9459 decisions - 96.9% - went to a seat in one
#: of the three.
#:
#: Two digits and not four. The powiat-level cut is useless as a filter: it
#: flags 1260 beneficiaries, a third of the register, because "outside the six
#: powiats where most of the money landed" is true of a great many perfectly
#: ordinary recipients of a nationwide programme.
FLOOD_VOIVODESHIPS = frozenset({"02", "16", "24"})

#: ZUS's per-beneficiary ceiling. A grant landing on it to the grosz is a grant
#: that was cut to fit rather than measured: all 29 beneficiaries with one are
#: ZUS's, and none of them has 8+ decisions.
DECISION_CAP = 1_000_000.00

#: A grantor this far down the list has essentially not run a programme - it
#: made a handful of decisions in total. That makes each one worth reading:
#: STAROSTA POWIATU WAŁBRZYCH made exactly one decision in the whole register and
#: it was worth 3.67 M PLN. Ten rather than fifty, which flags 103 and dilutes.
RARE_GRANTOR_DECISIONS = 10

#: PKD sections with no physical plant to be damaged by a flood: information and
#: communication, finance and insurance, real estate, professional services.
#: Real estate stays in deliberately - it is the largest and most interesting
#: slice of the four.
ASSET_LIGHT_SECTIONS = frozenset({"J", "K", "L", "M"})

#: Below this the asset-light set is 393 beneficiaries of mostly ordinary small
#: sums; above it, 59 that are worth reading.
ASSET_LIGHT_FLOOR = 200_000.0

#: The beneficiary-size code SUDOP uses for an entity that is not an SME at all.
#: 0 is micro, 1 small, 2 medium, 3 "nienależący do kategorii określonych kodem
#: od 0 do 2" - a large enterprise.
NON_SME_CODE = "3"

#: PKD division ranges for the sections above, as (first, last) inclusive.
_SECTION_DIVISIONS: dict[str, tuple[int, int]] = {
    "J": (58, 63),
    "K": (64, 66),
    "L": (68, 68),
    "M": (69, 75),
}


def pkd_section(code: str) -> str:
    """The PKD section letter a code belongs to, for the sections used here.

    Only the four asset-light sections are mapped, because they are the only
    ones any signal asks about; anything else returns "". PKD2007 and PKD2025
    agree on these four division ranges, and 801 of the 9459 rows are tagged
    PKD2025.
    """
    digits = (code or "").split(".")[0].strip()
    if not digits.isdigit():
        return ""
    division = int(digits)
    for section, (first, last) in _SECTION_DIVISIONS.items():
        if first <= division <= last:
            return section
    return ""


class Beneficiary(typing.NamedTuple):
    """One beneficiary's decisions under one programme, as the signals see them.

    `size` is the largest class any of its decisions asserted, not the first.
    SUDOP reports the class per decision and they disagree - a company that was
    called medium in one and large in another is large, and taking whichever
    came last would flag or unflag it on the order of the rows.
    """

    gross: float
    nominal: float
    size: str
    teryt: str
    pkd: tuple[str, ...]
    #: Every decision's gross value, so a single capped one can be spotted
    #: inside a beneficiary whose total is nowhere near the cap.
    decision_values: tuple[float, ...]
    grantors: tuple[str, ...]


def signals(
    beneficiary: Beneficiary,
    decisions_by_grantor: dict[str, int],
) -> list[str]:
    """Every structural signal this beneficiary trips, in a stable order.

    `decisions_by_grantor` counts decisions across the whole register, not
    within this beneficiary - "this office barely ran a programme" is a fact
    about the office.
    """
    found = []

    # A large enterprise inside a programme that is overwhelmingly micro-firms.
    # The 79 of them hold 10.0% of the money at a median of 24,517 PLN - *below*
    # the register's 46,381 - so this is not a size signal wearing a disguise:
    # 46 of the 79 have a single decision, and the list is Lidl, Dino, Rossmann,
    # Poczta Polska. The 8+ rule finds five of them.
    if beneficiary.size == NON_SME_CODE:
        found.append("non_sme")

    # A seat outside the three voivodeships that flooded. The damaged property
    # can genuinely have been elsewhere - SUDOP reports the seat, not the site -
    # which is exactly why this is a question and not a finding.
    if beneficiary.teryt[:2] and beneficiary.teryt[:2] not in FLOOD_VOIVODESHIPS:
        found.append("outside_flood_region")

    # A decision cut to the ceiling to the grosz.
    if any(abs(value - DECISION_CAP) < 0.005 for value in beneficiary.decision_values):
        found.append("capped_decision")

    # Paid by an office that made almost no decisions at all.
    if any(
        decisions_by_grantor.get(grantor, 0) <= RARE_GRANTOR_DECISIONS
        for grantor in beneficiary.grantors
    ):
        found.append("rare_grantor")

    # Substantial money to a line of business with little physical plant to
    # damage. The floor is what separates the 59 worth reading from the 393.
    if beneficiary.gross >= ASSET_LIGHT_FLOOR and any(
        pkd_section(code) in ASSET_LIGHT_SECTIONS for code in beneficiary.pkd
    ):
        found.append("asset_light")

    return found
