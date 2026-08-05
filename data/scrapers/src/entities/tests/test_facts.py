"""Round-trips and coercion for the fact dataclasses, incl. affair_involvement."""

import pytest

from entities.facts import (
    AffairInvolvementFact,
    EmploymentFact,
    PartyMembershipFact,
    PersonalRelationFact,
    dict_to_fact,
    fact_to_dict,
)


@pytest.mark.parametrize(
    ("fact", "fact_type"),
    [
        (EmploymentFact(
            url="u", justification="j", justification_in_text=None,
            person="Jan Kowalski", organization="Orlen", role="prezes",
        ), "employment"),
        (PartyMembershipFact(
            url="u", justification="j", justification_in_text="j",
            person="Jan Kowalski", party="PiS",
        ), "party_membership"),
        (PersonalRelationFact(
            url="u", justification="j", justification_in_text=None,
            subject="Jan Kowalski", object="Ewa Kowalska", relation="żona",
        ), "personal_relation"),
        (AffairInvolvementFact(
            url="u", justification="j", justification_in_text=None,
            person="Zbigniew Ziobro",
            role="kierujący zorganizowaną grupą przestępczą",
            affair="Fundusz Sprawiedliwości",
        ), "affair_involvement"),
    ],
)
def test_fact_round_trip(fact, fact_type):
    """asdict/dict_to_fact preserve every field and the discriminator."""
    data = fact_to_dict(fact)
    assert data["fact_type"] == fact_type
    restored = dict_to_fact(data)
    assert restored == fact


def test_affair_involvement_carries_all_three_fields():
    """person, role and affair all survive serialization."""
    fact = AffairInvolvementFact(
        url="u", justification="j", justification_in_text=None,
        person="Zbigniew Ziobro",
        role="kierujący zorganizowaną grupą przestępczą",
        affair="Fundusz Sprawiedliwości",
    )
    restored = dict_to_fact(fact_to_dict(fact))
    assert isinstance(restored, AffairInvolvementFact)
    assert restored.person == "Zbigniew Ziobro"
    assert restored.role == "kierujący zorganizowaną grupą przestępczą"
    assert restored.affair == "Fundusz Sprawiedliwości"


def test_unknown_fact_type_raises():
    with pytest.raises(ValueError):
        dict_to_fact({"fact_type": "nonsense", "url": "u"})
