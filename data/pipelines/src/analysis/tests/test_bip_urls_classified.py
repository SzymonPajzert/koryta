from __future__ import annotations

from analysis.bip_urls_classified import (
    best_anchor,
    load_model,
    predict,
    tag_names,
)


def test_tag_names_replaces_person_name_runs() -> None:
    assert "<NAME>" in tag_names("korekta Piotr Świerkosz.pdf")
    assert tag_names("umowa nr 5") == "umowa nr 5"


def test_best_anchor_drops_boilerplate_labels() -> None:
    assert best_anchor("Pobierz (PDF)") == ""
    assert best_anchor("Pobierz (PDF) | uchwała nr 5/2024") == "uchwała nr 5/2024"


def test_predict_uses_path_section_words() -> None:
    model = load_model()
    category, score, _runner = predict(
        model, "https://bip.x.pl/bip/oswiadczenia-majatkowe,16,0/plik.pdf", "", ""
    )
    assert category == "oswiadczenia"
    assert score > 0


def test_predict_uses_anchor_text_when_path_is_opaque() -> None:
    model = load_model()
    anchor = "Ogłoszenie o udzieleniu zamówienia"
    assert predict(model, "https://bip.x.pl/pobierz/1", anchor, "")[0] == "przetargi"
    anchor = "Nabór na wolne stanowisko urzędnicze"
    assert predict(model, "https://bip.x.pl/pobierz/2", anchor, "")[0] == "nabor"


def test_predict_person_name_anchor_is_a_declaration() -> None:
    model = load_model()
    category, _score, _runner = predict(
        model, "https://bip.x.pl/pobierz/9", "Jan Kowalski.pdf", ""
    )
    assert category == "oswiadczenia"


def test_predict_uses_the_full_click_trail() -> None:
    model = load_model()
    chain_nodes = (
        "https://bip.x.pl/",
        "https://bip.x.pl/oswiadczenia-majatkowe",
        "https://bip.x.pl/download/Jan-Kowalski,39592.pdf",
    )
    chain_anchors = ("", "Oświadczenia majątkowe", "Jan Kowalski.pdf")
    category, _score, _runner = predict(
        model, chain_nodes[-1], "", "", chain_nodes, chain_anchors
    )
    assert category == "oswiadczenia"


def test_predict_defaults_to_inne_without_features() -> None:
    model = load_model()
    category, _score, _runner = predict(model, "https://bip.x.pl/a", "", "")
    assert category == "inne"
