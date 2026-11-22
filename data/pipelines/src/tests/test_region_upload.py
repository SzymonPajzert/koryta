"""What `koryta_uploader --type region` sends to `/api/ingest/region`.

The site creates the regions it lacks and works out which of the urzędy
table's rows each region node carries, so what matters here is that both go up
whole, as the pipelines wrote them, or not at all, and that a cap on what it
creates reaches it.
"""

import json
from unittest.mock import MagicMock

import pytest

from uploader import IngestRefused, RegionUploader, Uploader

WEJHEROWO = {
    "teryt": "2215031",
    "region": "Wejherowo",
    "name": "Urząd Miejski w Wejherowie",
    "regon": "000526251",
    "nip": "5882155172",
}
MOKOTOW = {
    "teryt": "1465058",
    "region": "Mokotów",
    "name": "Urząd Dzielnicy Mokotów Miasta Stołecznego Warszawy",
    "regon": "01525966300050",
    "nip": None,
}
GMINA = {
    "node_id": "teryt2215031",
    "type": "region",
    "name": "Gmina miejska Wejherowo",
    "teryt": "2215031",
    "edge": {
        "edge_id": "edge_teryt2215_teryt2215031_owns",
        "source": "teryt2215",
        "target": "teryt2215031",
        "type": "owns",
    },
    "replaces": ["Gmina Wejherowo"],
}


def wrapped(payload: dict) -> dict:
    """A line of `RegionPayloads` as `--output stderr` prints it."""
    return {
        "entity_id": payload["teryt"],
        "krs": None,
        "teryt_powiat": [],
        "payload": json.dumps(payload),
    }


def uploader(
    limit: int | None = None,
    offset: int = 0,
    status: int = 200,
    max_new: int | None = None,
    waiting: int = 0,
) -> RegionUploader:
    """A region uploader whose requests never leave: `post` answers `status`,
    with `waiting` regions left for a later run."""
    instance = Uploader.create(
        MagicMock(
            endpoint="http://localhost:3000",
            type="region",
            limit=limit,
            offset=offset,
            max_new=max_new,
        ),
        tokens=MagicMock(),
        session=MagicMock(),
    )
    assert isinstance(instance, RegionUploader)
    response = MagicMock(status_code=status, text="refused")
    response.json.return_value = {
        "regions": {
            "sent": 1,
            "unchanged": 0,
            "edges": 1,
            "waiting": {"count": waiting, "named": ["1406113 Gmina Warka"][:waiting]},
        },
        "offices": {"regions": 2, "updated": 2, "unchanged": 0},
    }
    instance.post = MagicMock(return_value=response)  # type: ignore[method-assign]
    return instance


def sent(instance: RegionUploader) -> tuple[str, dict]:
    url, data = instance.post.call_args[0][:2]  # type: ignore[attr-defined]
    return url, json.loads(data)


def test_the_regions_and_the_whole_table_go_in_one_request():
    instance = uploader()
    instance.submit_results([wrapped(GMINA), WEJHEROWO, MOKOTOW])

    assert instance.post.call_count == 1  # type: ignore[attr-defined]
    url, body = sent(instance)
    assert url == "http://localhost:3000/api/ingest/region"
    assert body == {"regions": [GMINA], "offices": [WEJHEROWO, MOKOTOW]}


def test_either_part_goes_alone():
    regions_only, offices_only = uploader(), uploader()
    regions_only.submit_results([wrapped(GMINA)])
    offices_only.submit_results([WEJHEROWO])

    assert sent(regions_only)[1] == {"regions": [GMINA], "offices": []}
    assert sent(offices_only)[1] == {"regions": [], "offices": [WEJHEROWO]}


def test_only_the_fields_the_site_takes_go_and_other_lines_stay_behind():
    # The pipelines' stderr carries their own messages beside the rows, and a
    # payload of any other type is not a region.
    instance = uploader()
    instance.submit_results(
        [
            {**WEJHEROWO, "index": 3},
            {**wrapped(GMINA), "teryt_powiat": ["2215"]},
            {"message": "Finished"},
            wrapped({**GMINA, "type": "place"}),
            {"payload": "not json"},
        ]
    )

    _, body = sent(instance)
    assert body == {"regions": [GMINA], "offices": [WEJHEROWO]}


@pytest.mark.parametrize("cut", [{"limit": 10}, {"offset": 5}])
def test_a_table_cut_short_is_not_sent(cut):
    # The lines are the regions and the urzędy table run together, so a cut
    # by lines could leave a województwo with one of its two urzędy.
    instance = uploader(**cut)

    with pytest.raises(SystemExit):
        instance.submit_results([WEJHEROWO])
    instance.post.assert_not_called()  # type: ignore[attr-defined]


def test_max_new_caps_what_the_site_creates(capsys):
    instance = uploader(max_new=100, waiting=1)
    instance.submit_results([wrapped(GMINA), WEJHEROWO])

    _, body = sent(instance)
    assert body["maxCreated"] == 100
    assert instance.answer is not None
    assert instance.answer["regions"]["waiting"]["count"] == 1
    assert (
        "1 regions left for a later run, past --max-new: 1406113 Gmina Warka"
        in capsys.readouterr().err
    )


def test_without_max_new_the_site_creates_every_one():
    instance = uploader()
    instance.submit_results([wrapped(GMINA)])

    assert "maxCreated" not in sent(instance)[1]


def test_a_refused_upload_fails_the_run():
    instance = uploader(status=400)

    with pytest.raises(IngestRefused):
        instance.submit_results([WEJHEROWO])
