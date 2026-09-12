"""Tests for ArticleAnalyzed fact deduplication (within + between articles)."""

from scrapers.article.pipelines.article_analyzed_pipeline import (
    _canonical_org,
    _canonical_party,
    _canonical_role,
    _collapse_between_articles,
    _dedup_facts_for_article,
    _fact_key,
    _fact_matches_koryta,
    _fact_person,
    _koryta_name_by_id,
    _person_ids_by_url,
    _strip_and_date_fact,
)


def employment(person, org, role, **extra):
    fact = {
        "fact_type": "employment",
        "person": person,
        "organization": org,
        "role": role,
    }
    fact.update(extra)
    return fact


def party(person, party, **extra):
    fact = {"fact_type": "party_membership", "person": person, "party": party}
    fact.update(extra)
    return fact


# --- _canonical_party ----------------------------------------------------- #


def test_canonical_party_aliases_fold():
    assert _canonical_party("PiS") == "prawo i sprawiedliwosc"
    assert _canonical_party("Prawo i Sprawiedliwość") == "prawo i sprawiedliwosc"
    assert _canonical_party("prawo i sprawiedliwosc") == "prawo i sprawiedliwosc"
    assert _canonical_party("PSL-Koalicja Polska") == "polskie stronnictwo ludowe"
    assert _canonical_party("po") == "platforma obywatelska"
    assert _canonical_party("Platforma Obywatelska") == "platforma obywatelska"


def test_canonical_party_unknown_passes_through():
    # Diacritics are folded: "polska 2050" regardless of input spelling.
    assert _canonical_party("Polska 2050") == "polska 2050"
    assert _canonical_party("Polski 2050") == "polski 2050"


def test_canonical_party_empty():
    assert _canonical_party(None) == ""
    assert _canonical_party("") == ""


# --- _canonical_org -------------------------------------------------------- #


def test_canonical_org_folds_legal_suffix():
    assert _canonical_org("Warszawskie Zakłady Naprawcze S.A.") == (
        "warszawskie zaklady naprawcze"
    )
    assert _canonical_org("Tauron Polska Energia SA") == "tauron"


def test_canonical_org_folds_extended_legal_suffix():
    assert _canonical_org("Bayer Construct Zrt.") == "bayer construct"
    assert _canonical_org("KGHM Polska Miedź S.A.") == "kghm"
    assert _canonical_org("Lotos-Biopaliwa sp. z o.o.") == "lotos biopaliwa"
    assert _canonical_org("PZU S.A.") == "pzu"


def test_canonical_org_folds_rp_suffix():
    assert _canonical_org("Sejm RP") == "sejm"
    assert _canonical_org("Sejm Rzeczypospolitej Polskiej") == "sejm"
    assert _canonical_org("Senat") == "senat"


def test_canonical_org_folds_party_alias_in_org_slot():
    assert _canonical_org("PSL") == "polskie stronnictwo ludowe"
    assert _canonical_org("Polskie Stronnictwo Ludowe") == (
        "polskie stronnictwo ludowe"
    )


def test_canonical_org_folds_ministry_rename():
    assert _canonical_org("Ministerstwo Klimatu") == (
        "ministerstwo klimatu i srodowiska"
    )
    assert _canonical_org("Ministerstwo Środowiska") == (
        "ministerstwo klimatu i srodowiska"
    )


def test_canonical_org_folds_brand_variant():
    assert _canonical_org("PKN Orlen") == "orlen"
    assert _canonical_org("Orlen") == "orlen"
    assert _canonical_org("Grupa Orlen") == "orlen"
    assert _canonical_org("Polski Koncern Naftowy ORLEN S.A.") == "orlen"
    assert _canonical_org("Polskiego Koncernu Naftowego Orlen SA") == "orlen"
    assert _canonical_org("Rada Nadzorcza PKN Orlen") == "rada nadzorcza orlen"
    assert _canonical_org("Rada Nadzorcza Orlenu") == "rada nadzorcza orlen"


def test_canonical_org_folds_city_office():
    assert _canonical_org("Urząd Miasta Krakowa") == "urzad miasto krakow"
    assert _canonical_org("Urząd Miejski w Krakowie") == "urzad miasto krakow"
    assert _canonical_org("Urząd Prezydenta Miasta Krakowa") == "urzad miasto krakow"
    assert _canonical_org("Urząd Miejski w Pcimiu") == "urzad miasto pcim"
    assert _canonical_org("Urząd Gminy Pcim") == "urzad miasto pcim"
    assert _canonical_org("Urząd Gminy w Pcim") == "urzad miasto pcim"
    assert _canonical_org("Miejski Urząd Pracy w Lublinie") == "urzad pracy lublin"
    assert _canonical_org("Urząd Pracy w Lublinie") == "urzad pracy lublin"
    # Different towns stay separate even for the same role on one person.
    assert _canonical_org("Urząd Miejski w Świebodzinie") != _canonical_org(
        "Urząd Miejski w Braniewie"
    )


def test_canonical_org_folds_municipal_unit_spellings():
    # The commune as a unit and as its office are the same municipality and
    # fold to the same city-stamped canonical; the city stays in the key so a
    # person who served two towns keeps distinct facts.
    assert _canonical_org("Gmina Pokrzywnica") == "urzad miasto pokrzywnic"
    assert _canonical_org("Urząd Gminy Pokrzywnica") == "urzad miasto pokrzywnic"
    assert _canonical_org("Urząd Gminy w Pokrzywnicy") == "urzad miasto pokrzywnic"
    assert _canonical_org("Miasto i Gmina Halinów") == "urzad miasto halinow"
    assert _canonical_org("Gmina i Miasto Żnin") == "urzad miasto znin"
    assert _canonical_org("Gmina Halinów") == "urzad miasto halinow"
    assert _canonical_org("Urząd Miejski w Halinowie") == "urzad miasto halinow"
    assert _canonical_org("Miasto Żnin") == "urzad miasto znin"


def test_canonical_org_city_office_same_fact_all_spellings():
    # The exact case from the data: one wójt, three org spellings -> one key.
    keys = {
        _canonical_org(o)
        for o in (
            "Gmina Pokrzywnica",
            "Urząd Gminy Pokrzywnica",
            "Urząd Gminy w Pokrzywnicy",
        )
    }
    assert keys == {"urzad miasto pokrzywnic"}


def test_canonical_org_folds_warsaw():
    assert _canonical_org("Urząd m.st. Warszawy") == "urzad miasta stolecznego warszawy"
    assert _canonical_org("Urząd Miejski m.st. Warszawy") == (
        "urzad miasta stolecznego warszawy"
    )
    assert _canonical_org("Miasto Stołeczne Warszawa") == (
        "urzad miasta stolecznego warszawy"
    )
    assert _canonical_org("Rada Warszawy") == "rada miasta stolecznego warszawy"
    assert _canonical_org("Rada m.st. Warszawy") == "rada miasta stolecznego warszawy"


def test_canonical_org_folds_voivodeship_office():
    assert _canonical_org("Małopolski Urząd Wojewódzki w Krakowie") == (
        "urzad wojewodzki"
    )
    assert _canonical_org("Urząd Wojewódzki w Krakowie") == "urzad wojewodzki"
    assert _canonical_org("Urząd Wojewody Małopolskiego") == "urzad wojewodzki"
    assert _canonical_org("Małopolski Urząd Marszałkowski") == "urzad marszalkowski"
    assert _canonical_org("Urząd Marszałkowski Województwa Małopolskiego") == (
        "urzad marszalkowski"
    )


def test_canonical_org_folds_county_government():
    # County vs its office vs its board — one government, same person.
    assert _canonical_org("Powiat Gryfiński") == "starostwo powiatowe"
    assert _canonical_org("Starostwo Powiatowe w Gryfinie") == "starostwo powiatowe"
    assert _canonical_org("Starostwo Powiatu Gryfińskiego") == "starostwo powiatowe"
    assert _canonical_org("Zarząd Powiatu Wołomińskiego") == "starostwo powiatowe"
    assert _canonical_org("Starostwo Powiatowe w Wołominie") == "starostwo powiatowe"


def test_canonical_org_folds_housing_cooperative():
    # SM, Spółdzielnia Mieszkaniowa and Spółdzielnia forms of one co-op.
    assert _canonical_org("SM „Jaskółka”") == "spoldzielnia jaskolka"
    assert _canonical_org("Spółdzielnia Mieszkaniowa „Jaskółka”") == (
        "spoldzielnia jaskolka"
    )
    assert _canonical_org("Spółdzielnia Mieszkaniowa Jaskółka w Tarnowie") == (
        "spoldzielnia jaskolka"
    )
    assert _canonical_org("Spółdzielnia „Jaskółka”") == "spoldzielnia jaskolka"
    # An "S.M." dotted spelling folds too.
    assert _canonical_org("S.M. Jaskółka") == "spoldzielnia jaskolka"


def test_canonical_org_we_connective_and_bare_county_seat():
    # "we Wrocławiu" and a bare seat fold just like "w Gryfinie".
    assert _canonical_org("Starostwo Powiatowe we Wrocławiu") == "starostwo powiatowe"
    assert _canonical_org("Starostwo Powiatowe Wrocław") == "starostwo powiatowe"
    assert _canonical_org("Starostwo Powiatu Gryfińskiego") == "starostwo powiatowe"


def test_canonical_org_folds_solectwo():
    assert _canonical_org("Sołectwo Laseczno") == "solectwo"
    assert _canonical_org("Urząd Sołectwa Laseczno") == "solectwo"
    assert _canonical_org("Rada Sołecka Laseczna") == "solectwo"


def test_canonical_org_folds_named_cultural_venue():
    assert _canonical_org("Teatr Nowy im. K. Dejmka w Łodzi") == "teatr nowy"
    assert _canonical_org("Teatr Nowy w Łodzi") == "teatr nowy"
    assert _canonical_org("Teatr Nowego im. K. Dejmka w Łodzi") == "teatr nowy"
    assert _canonical_org("Teatr Nowy") == "teatr nowy"


def test_canonical_org_folds_rzeczpospolitej_misspelling():
    assert _canonical_org("Sejm Rzeczpospolitej Polskiej") == "sejm"


def test_canonical_org_arimr_any_word_order():
    assert _canonical_org(
        "Agencja Modernizacji i Restrukturyzacji Rolnictwa"
    ) == "agencja restrukturyzacji i modernizacji rolnictwa"
    assert _canonical_org("Agencja Rozwoju i Modernizacji Rolnictwa") == (
        "agencja restrukturyzacji i modernizacji rolnictwa"
    )
    assert _canonical_org("Agencja Restrukturyzacji i Rolnictwa") == (
        "agencja restrukturyzacji i modernizacji rolnictwa"
    )
    assert _canonical_org("ARiMR") == (
        "agencja restrukturyzacji i modernizacji rolnictwa"
    )


def test_canonical_org_folds_company_forms_v2():
    assert _canonical_org("Energia SA") == "energa"
    assert _canonical_org("Energi SA") == "energa"
    assert _canonical_org("Globe Trade Centre") == "globe trade center"
    assert _canonical_org("GTC") == "globe trade center"
    assert _canonical_org("Europarlament") == "parlament europejski"
    assert _canonical_org("Europejski Parlament Europejski") == (
        "parlament europejski"
    )
    assert _canonical_org("Rada Nadzorcza Spółki Energa") == "rada nadzorcza energa"
    assert _canonical_org("Rada Nadzorcza Grupy Energa") == "rada nadzorcza energa"
    assert _canonical_org("Służby Kontrwywiadu Wojskowego") == (
        "sluzba kontrwywiadu wojskowego"
    )


def test_smolensk_committee_by_date_only():
    assert _canonical_org(
        "Podkomisja ds. ponownego zbadania wypadku lotniczego z dnia "
        "10 kwietnia 2010 r."
    ) == "podkomisja ds. katastrofy smolenskiej"


def test_bare_town_org_folds_for_municipal_head():
    # "burmistrz @ Kisielice" == "burmistrz @ Urząd Miejski w Kisielicach".
    a = _fact_key(
        {"fact_type": "employment", "organization": "Kisielice", "role": "burmistrz"},
        person_name="tomasz koprowiak",
    )
    b = _fact_key(
        {
            "fact_type": "employment",
            "organization": "Urząd Miejski w Kisielicach",
            "role": "burmistrz",
        },
        person_name="tomasz koprowiak",
    )
    assert a == b
    # A company with a non-municipal role is untouched.
    c = _fact_key(
        {"fact_type": "employment", "organization": "Orlen", "role": "prezes"},
        person_name="jan",
    )
    assert c[2] == "orlen"


def test_canonical_org_folds_resort_and_zak():
    assert _canonical_org("Resort Aktywów Państwowych") == (
        "ministerstwo aktywow panstwowych"
    )
    assert _canonical_org("Ministerstwo Aktywów Państwowych") == (
        "ministerstwo aktywow panstwowych"
    )
    assert _canonical_org("Grupa Azoty ZAK") == "zaklady azotowe kedzierzyn"
    assert _canonical_org("Zakłady Azotowe „Kędzierzyn”") == (
        "zaklady azotowe kedzierzyn"
    )
    assert _canonical_org("Grupa Azoty Zakłady Azotowe Kędzierzyn S.A.") == (
        "zaklady azotowe kedzierzyn"
    )
    assert _canonical_org("Polskie Radio PiK") == "radio pik"
    assert _canonical_org("Radio PiK") == "radio pik"


def test_canonical_role_folds_podsekretarz_and_resort_heads():
    assert _canonical_role("Podsekretarz Stanu") == "wiceminister"
    assert _canonical_role("podsekretarz") == "wiceminister"
    # "szef resortu" / "wiceszef resortu" are the minister / wiceminister.
    assert _canonical_role("szef", "ministerstwo aktywow panstwowych") == "minister"
    assert _canonical_role("wiceszef", "ministerstwo aktywow panstwowych") == (
        "wiceminister"
    )
    # Outside a ministry the loose role keeps its own canonical.
    assert _canonical_role("szef") == "szef"


def test_canonical_role_folds_senior_and_council_forms():
    assert _canonical_role("marszałek-senior") == "marszalek senior"
    assert _canonical_role("radna") == "radny"
    assert _canonical_role("radni") == "radny"
    assert _canonical_role("viceprzewodniczący") == "wiceprzewodniczacy"
    assert _canonical_role("współprowadzący program") == "wspolprowadzacy"


def test_canonical_org_folds_city_council():
    assert _canonical_org("Rada Miasta Krakowa") == "rada miasta krakow"
    assert _canonical_org("Rada Miejska w Szczecinie") == "rada miasta szczecin"
    assert _canonical_org("Rada Miasta") == "rada miasta"
    assert _canonical_org("Rada Gminna w Pcimiu") == "rada miasta pcim"
    assert _canonical_org("Rada Gminy w Pcimiu") == "rada miasta pcim"


def test_canonical_org_folds_sejmik():
    assert _canonical_org("Sejmik Małopolski") == "sejmik wojewodztwa malopolskiego"
    assert _canonical_org("Sejmik Województwa Małopolskiego") == (
        "sejmik wojewodztwa malopolskiego"
    )


def test_canonical_org_folds_designators_and_seats():
    assert _canonical_org("Spółka Dorzecze Białej") == "dorzecze bialej"
    assert _canonical_org("Grupa Azoty Puławy") == "azoty pulawy"
    assert _canonical_org("Koncern Energetyczny „Energa” SA") == "energa"
    assert _canonical_org("Miejski Ośrodek Sportu i Rekreacji w Radomiu") == (
        "osrodek sportu i rekreacji"
    )
    assert _canonical_org("Wojewódzki Fundusz Ochrony Środowiska i G.O. w Łodzi") == (
        "wojewodzki fundusz ochrony srodowiska i g.o."
    )
    # Non-municipal orgs keep their seat (they are distinct across cities).
    assert _canonical_org("Bank Spółdzielczy w Gnieźnie") == (
        "bank spoldzielczy w gnieznie"
    )


def test_canonical_org_folds_council_caucus():
    assert _canonical_org("Klub Radnych PiS") == "klub prawa i sprawiedliwosci"
    assert _canonical_org("Klub Parlamentarny PiS") == (
        "klub prawa i sprawiedliwosci"
    )
    assert _canonical_org("Klub Radnych Lewica") == "klub lewica"


def test_canonical_org_folds_smolensk_committee():
    assert _canonical_org(
        "Zespół Parlamentarny ds. Zbadania Przyczyn Katastrofy TU-154M"
    ) == "zespol ds. katastrofy smolenskiej"
    assert _canonical_org(
        "parlamentarny zespół ds. wyjaśnienia tragedii smoleńskiej"
    ) == "zespol ds. katastrofy smolenskiej"
    assert _canonical_org("Podkomisja Smoleńska") == (
        "podkomisja ds. katastrofy smolenskiej"
    )
    assert _canonical_org("Sejmowa Komisja Smoleńska") == (
        "komisja ds. katastrofy smolenskiej"
    )


def test_canonical_org_folds_hospital_variants():
    assert _canonical_org("Szpital Specjalistyczny im. S. Żeromskiego w Krakowie") == (
        "szpital im. zeromskiego"
    )
    assert _canonical_org("Szpital im. Stefana Żeromskiego SPZOZ") == (
        "szpital im. zeromskiego"
    )
    assert _canonical_org("szpital im. Żeromskiego w Krakowie") == (
        "szpital im. zeromskiego"
    )


def test_canonical_org_folds_company_forms():
    assert _canonical_org("Grupa PZU") == "pzu"
    assert _canonical_org("PZU SA") == "pzu"
    assert _canonical_org("Tauron Polska Energia") == "tauron"
    assert _canonical_org("PGE Polska Grupa Energetyczna") == "pge"
    assert _canonical_org("PKP Polskie Linie Kolejowe") == "pkp plk"
    assert _canonical_org("PKP PLK") == "pkp plk"
    assert _canonical_org("Bank PKO BP") == "pko bank polski"
    assert _canonical_org("Poczta Polska Spółka Akcyjna") == "poczta polska"


# --- _canonical_role ------------------------------------------------------- #


def test_canonical_role_folds_gender_and_form():
    assert _canonical_role("minister") == "minister"
    assert _canonical_role("ministra") == "minister"
    assert _canonical_role("poseł") == "posel"
    assert _canonical_role("posłanka") == "posel"
    assert _canonical_role("prezes zarządu") == "prezes"
    assert _canonical_role("szefowa") == "szef"


def test_canonical_role_folds_more_gender_variants():
    assert _canonical_role("dyrektorka") == "dyrektor"
    assert _canonical_role("prezeska") == "prezes"
    assert _canonical_role("wiceprzewodnicząca") == "wiceprzewodniczacy"
    assert _canonical_role("wiceprzewodniczący") == "wiceprzewodniczacy"


def test_canonical_role_folds_acting_and_genitive():
    assert _canonical_role("pełniący obowiązki prezesa") == "prezes"
    assert _canonical_role("p.o. prezydenta") == "prezydent"
    assert _canonical_role("prezesa") == "prezes"
    assert _canonical_role("dyrektora") == "dyrektor"
    assert _canonical_role("burmistrza") == "burmistrz"


def test_canonical_role_folds_ordinal_qualifiers():
    assert _canonical_role("I zastępca prezydenta") == "zastepca prezydenta"
    assert _canonical_role("pierwszy wicepremier") == "wicepremier"
    assert _canonical_role("drugi wicewojewoda") == "wicewojewoda"


def test_canonical_role_drops_org_scope_redundancy():
    # "komendant wojewódzki" in a wojewódzka komenda is the same as "komendant".
    assert _canonical_role(
        "komendant wojewódzki", "komenda wojewodzka panstwowej strazy pozarnej"
    ) == "komendant"
    # "zastępca prezydenta miasta" at an "urzad miasto" is "zastępca prezydenta".
    assert _canonical_role("zastępca prezydenta miasta", "urzad miasto") == (
        "zastepca prezydenta"
    )
    # "członek rady" at a supervisory board == "członek rady nadzorczej".
    assert _canonical_role("członek rady", "rada nadzorcza pzu") == (
        "czlonek rady nadzorczej"
    )
    # Roles without the org keep their full form.
    assert _canonical_role("komendant wojewódzki") == "komendant wojewodzki"


# --- _fact_key ------------------------------------------------------------ #


def test_fact_key_is_exact_on_entity_fields():
    a = _fact_key(employment("Jan Kowalski", "Orlen", "prezes"))
    b = _fact_key(employment("Jan Kowalski", "Orlen", "prezes"))
    assert a == b


def test_fact_key_ignores_justification_and_date():
    a = _fact_key(
        employment(
            "Jan Kowalski", "Orlen", "prezes", justification="x", date="2020-01-01"
        )
    )
    b = _fact_key(
        employment(
            "Jan Kowalski", "Orlen", "prezes", justification="y", date="2021-01-01"
        )
    )
    assert a == b


def test_fact_key_distinguishes_roles():
    a = _fact_key(employment("Jan Kowalski", "Orlen", "prezes"))
    b = _fact_key(employment("Jan Kowalski", "Orlen", "wiceprezes"))
    assert a != b


def test_fact_key_folds_party_aliases():
    a = _fact_key(party("Jan Kowalski", "PiS"))
    b = _fact_key(party("Jan Kowalski", "Prawo i Sprawiedliwość"))
    assert a == b


def test_fact_key_is_whitespace_and_case_insensitive():
    a = _fact_key(employment("  Jan Kowalski ", " Orlen ", "prezes"))
    b = _fact_key(employment("jan kowalski", "orlen", "prezes"))
    assert a == b


def test_fact_key_folds_org_aliases():
    a = _fact_key(employment("Jan Kowalski", "Sejm", "minister"))
    b = _fact_key(
        employment("Jan Kowalski", "Sejm Rzeczypospolitej Polskiej", "minister")
    )
    c = _fact_key(employment("Jan Kowalski", "PKN Orlen", "prezes"))
    d = _fact_key(employment("Jan Kowalski", "Orlen", "prezes"))
    assert a == b
    assert c == d


def test_fact_key_folds_role_gender():
    a = _fact_key(employment("Jan Kowalski", "Sejm", "posłanka"))
    b = _fact_key(employment("Jan Kowalski", "Sejm", "poseł"))
    assert a == b


def test_fact_key_splits_same_name_by_person_id():
    # Same literal name, different koryta ids -> different keys (two different
    # "Piotr Woźniak" people must not dedupe into one).
    a = _fact_key(
        employment("Piotr Woźniak", "Orlen", "prezes"),
        person_name="piotr woźniak",
        person_id="idA",
    )
    b = _fact_key(
        employment("Piotr Woźniak", "Orlen", "prezes"),
        person_name="piotr woźniak",
        person_id="idB",
    )
    assert a != b


def test_fact_key_same_name_same_id_matches():
    a = _fact_key(
        employment("Piotr Woźniak", "Orlen", "prezes"),
        person_name="piotr woźniak",
        person_id="idA",
    )
    b = _fact_key(
        employment("Piotr Woźniak", "Orlen", "prezes"),
        person_name="piotr woźniak",
        person_id="idA",
    )
    assert a == b


def test_fact_key_default_person_tuple_is_empty_id():
    key = _fact_key(employment("Jan Kowalski", "Orlen", "prezes"))
    assert key[1] == ("jan kowalski", "")


def test_dedup_facts_for_article_splits_same_name_by_resolved_ids():
    first_seen = {}
    evidence = {}
    facts = [
        employment("Piotr Woźniak", "Orlen", "prezes"),
        employment("Piotr Woźniak", "Orlen", "prezes"),
    ]
    # Both articles' facts are about the SAME person_id -> only one survives.
    triaged = _dedup_facts_for_article(
        "a.pl/x", facts, first_seen, evidence, person_ids={"piotr woźniak": "idA"}
    )
    assert len(triaged) == 1


def test_dedup_facts_for_article_keeps_different_ids_apart():
    first_seen = {}
    evidence = {}
    pw = employment("Piotr Woźniak", "Orlen", "prezes")
    t1 = _dedup_facts_for_article(
        "a.pl/1", [pw], first_seen, evidence, person_ids={"piotr woźniak": "idA"}
    )
    t2 = _dedup_facts_for_article(
        "b.pl/2", [pw], first_seen, evidence, person_ids={"piotr woźniak": "idB"}
    )
    out1 = _collapse_between_articles(
        "a.pl/1", t1, first_seen, evidence, keep_evidence=True
    )
    out2 = _collapse_between_articles(
        "b.pl/2", t2, first_seen, evidence, keep_evidence=True
    )
    assert len(out1) == 1
    assert len(out2) == 1


def test_hypothetical_same_name_two_people_id_split_end_to_end():
    """Two different koryta people with the SAME name and the SAME fact must
    stay separate, while each person's copies across articles still collapse.

    Simulates the pipeline flow over several articles (per-article mention
    resolution -> _dedup_facts_for_article -> _collapse_between_articles).
    """
    first_seen = {}
    evidence = {}
    pending = {}

    # As in process(): every article is triaged (mention-resolved + within-dup
    # collapsed) FIRST, then the between-article collapse runs over all of them
    # so each fact's evidence reflects the whole corpus.
    for url, person_ids in [
        ("a.pl/1", {"piotr woźniak": "idA"}),
        ("b.pl/2", {"piotr woźniak": "idB"}),
        ("c.pl/3", {"piotr woźniak": "idA"}),
    ]:
        triaged = _dedup_facts_for_article(
            url,
            [
                employment("Piotr Woźniak", "Orlen", "prezes"),
                employment("Piotr Woźniak", "Orlen", "prezes"),
            ],  # within-article dup
            first_seen,
            evidence,
            person_ids=person_ids,
        )
        pending[url] = triaged

    out_a1 = _collapse_between_articles(
        "a.pl/1", pending["a.pl/1"], first_seen, evidence, keep_evidence=True
    )
    out_b = _collapse_between_articles(
        "b.pl/2", pending["b.pl/2"], first_seen, evidence, keep_evidence=True
    )
    out_a2 = _collapse_between_articles(
        "c.pl/3", pending["c.pl/3"], first_seen, evidence, keep_evidence=True
    )

    # A and B are DIFFERENT people -> both facts survive (not merged).
    assert len(out_a1) == 1
    assert len(out_b) == 1
    # Person A's second article collapses into A's first (same id).
    assert out_a2 == []
    assert out_a1[0]["evidence"] == ["a.pl/1", "c.pl/3"]
    assert out_b[0]["evidence"] == ["b.pl/2"]


# --- _strip_and_date_fact ------------------------------------------------- #


def test_strip_and_date_fact_drops_verifier_fields():
    fact = _strip_and_date_fact(
        {
            "fact_type": "employment",
            "person": "Jan Kowalski",
            "verified": True,
            "verification_verdict": "correct",
            "verification_reason": "ok",
        },
        "2020-01-01",
    )
    assert "verified" not in fact
    assert "verification_verdict" not in fact
    assert "verification_reason" not in fact
    assert fact["date"] == "2020-01-01"


# --- _dedup_facts_for_article --------------------------------------------- #


def test_within_article_duplicates_kept_once():
    first_seen = {}
    evidence = {}
    facts = [
        employment("Jan Kowalski", "Orlen", "prezes"),
        employment("Jan Kowalski", "Orlen", "prezes"),
        employment("Jan Kowalski", "Orlen", "wiceprezes"),
    ]
    triaged = _dedup_facts_for_article("a.pl/x", facts, first_seen, evidence)
    assert len(triaged) == 2


def test_first_seen_and_evidence_recorded():
    first_seen = {}
    evidence = {}
    _dedup_facts_for_article(
        "a.pl/x",
        [employment("Jan Kowalski", "Orlen", "prezes")],
        first_seen,
        evidence,
    )
    key = _fact_key(employment("Jan Kowalski", "Orlen", "prezes"))
    assert first_seen[key] == "a.pl/x"
    assert evidence[key] == ["a.pl/x"]


# --- _collapse_between_articles -------------------------------------------- #


def test_between_articles_keeps_first_evidence():
    first_seen = {}
    evidence = {}
    t1 = _dedup_facts_for_article(
        "a.pl/1",
        [employment("Jan Kowalski", "Orlen", "prezes")],
        first_seen,
        evidence,
    )
    t2 = _dedup_facts_for_article(
        "b.pl/2",
        [employment("Jan Kowalski", "Orlen", "prezes")],
        first_seen,
        evidence,
    )

    out1 = _collapse_between_articles(
        "a.pl/1", t1, first_seen, evidence, keep_evidence=True
    )
    out2 = _collapse_between_articles(
        "b.pl/2", t2, first_seen, evidence, keep_evidence=True
    )

    assert len(out1) == 1
    assert out1[0]["evidence"] == ["a.pl/1", "b.pl/2"]
    assert out2 == []


def test_collapse_drops_evidence_by_default():
    first_seen = {}
    evidence = {}
    t1 = _dedup_facts_for_article(
        "a.pl/1", [employment("Jan Kowalski", "Orlen", "prezes")], first_seen, evidence
    )
    _dedup_facts_for_article(
        "b.pl/2", [employment("Jan Kowalski", "Orlen", "prezes")], first_seen, evidence
    )
    out1 = _collapse_between_articles("a.pl/1", t1, first_seen, evidence)
    assert len(out1) == 1
    assert "evidence" not in out1[0]


def test_distinct_facts_all_kept():
    first_seen = {}
    evidence = {}
    t1 = _dedup_facts_for_article(
        "a.pl/1",
        [
            employment("Jan Kowalski", "Orlen", "prezes"),
            employment("Anna Nowak", "Orlen", "prezes"),
        ],
        first_seen,
        evidence,
    )
    out1 = _collapse_between_articles(
        "a.pl/1", t1, first_seen, evidence, keep_evidence=True
    )
    assert len(out1) == 2
    assert all("evidence" in f for f in out1)


def test_collapse_drops_evidence_by_default_keeps_distinct():
    first_seen = {}
    evidence = {}
    t1 = _dedup_facts_for_article(
        "a.pl/1",
        [
            employment("Jan Kowalski", "Orlen", "prezes"),
            employment("Anna Nowak", "Orlen", "prezes"),
        ],
        first_seen,
        evidence,
    )
    out1 = _collapse_between_articles("a.pl/1", t1, first_seen, evidence)
    assert len(out1) == 2
    assert all("evidence" not in f for f in out1)


# --- _person_ids_by_url / _fact_person -------------------------------------- #

_MENTIONS_JSONL = """\
{"url": "a.pl/1", "person": "Piotr Woźniak", "person_id": "idA", "verdict": "yes"}
{"url": "a.pl/1", "person": "Jan Nowak", "person_id": "idJ", "verdict": "no"}
{"url": "b.pl/2", "person": "Piotr Woźniak", "person_id": "idB", "verdict": "yes"}
{"url": "b.pl/2", "person": "Anna Lis", "person_id": "idL", "verdict": "yes"}
{"url": "c.pl/3", "person": "Piotr Wozniak", "person_id": "idC", "verdict": "yes"}
"""


def test_person_ids_by_url_keeps_yes_only_and_normalizes(tmp_path):
    path = tmp_path / "mentions.jsonl"
    path.write_text(_MENTIONS_JSONL, encoding="utf-8")
    by_url = _person_ids_by_url(path)
    # 'no' verdicts drop; names are lowercased/whitespace-collapsed.
    assert by_url["a.pl/1"] == {"piotr woźniak": "idA"}
    assert by_url["b.pl/2"] == {"piotr woźniak": "idB", "anna lis": "idL"}
    # No diacritic folding: "Piotr Wozniak" normalizes to its own spelling.
    assert by_url["c.pl/3"] == {"piotr wozniak": "idC"}


def test_person_ids_by_url_missing_file(tmp_path):
    assert _person_ids_by_url(tmp_path / "missing.jsonl") == {}


def test_koryta_name_by_id_reads_person_koryta(tmp_path):
    path = tmp_path / "person_koryta.jsonl"
    path.write_text(
        '{"id": "idA", "full_name": "Piotr Woźniak"}\n'
        '{"id": "idB", "full_name": "Anna Nowak"}\n',
        encoding="utf-8",
    )
    assert _koryta_name_by_id(path) == {"idA": "Piotr Woźniak", "idB": "Anna Nowak"}


def test_koryta_name_by_id_missing_file(tmp_path):
    assert _koryta_name_by_id(tmp_path / "missing.jsonl") == {}


def test_fact_matches_koryta_by_name():
    names = {"idA": "Piotr Woźniak", "idB": "Jan Kowalski"}
    fact = employment("Piotr Woźniak", "Orlen", "prezes")
    assert _fact_matches_koryta(fact, "a.pl/1", ["idA"], names)
    assert not _fact_matches_koryta(fact, "a.pl/1", ["idB"], names)
    # Case/whitespace insensitive, diacritics folded.
    fact2 = employment(" PIOTR WOŹNIAK  ", "Orlen", "prezes")
    assert _fact_matches_koryta(fact2, "a.pl/1", ["idA"], names)


def test_fact_matches_koryta_subject_for_relation():
    names = {"idA": "Anna Nowak"}
    fact = {
        "fact_type": "personal_relation",
        "subject": "Anna Nowak",
        "object": "Jan Kowalski",
        "relation": "żona",
    }
    assert _fact_matches_koryta(fact, "a.pl/1", ["idA"], names)
    # No person/subject, or no ids -> not matched.
    assert not _fact_matches_koryta(
        {"fact_type": "employment"}, "a.pl/1", ["idA"], names
    )
    assert not _fact_matches_koryta(fact, "a.pl/1", [], names)


def test_fact_person_uses_person_then_subject():
    assert _fact_person(
        employment("Jan Kowalski", "Orlen", "prezes"), {"jan kowalski": "k1"}
    ) == ("jan kowalski", "k1")
    # personal_relation names the subject as `subject`.
    assert _fact_person(
        {"fact_type": "personal_relation", "subject": "Anna Nowak"},
        {"anna nowak": "k2"},
    ) == ("anna nowak", "k2")
    # Unconfirmed person -> literal name kept, empty id.
    assert _fact_person(employment("Jan Kowalski", "Orlen", "prezes"), {}) == (
        "jan kowalski",
        "",
    )
