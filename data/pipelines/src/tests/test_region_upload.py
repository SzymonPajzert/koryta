"""What `koryta_uploader --type region` sends to `/api/ingest/region`.

The site works out which of the table's rows each region node carries - a
powiat its gminy's as well - so what matters here is that the table goes up
whole, as the pipeline wrote it, or not at all.
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


def uploader(
    limit: int | None = None, offset: int = 0, status: int = 200
) -> RegionUploader:
    """A region uploader whose requests never leave: `post` answers `status`."""
    instance = Uploader.create(
        MagicMock(
            endpoint="http://localhost:3000",
            type="region",
            limit=limit,
            offset=offset,
        ),
        tokens=MagicMock(),
        session=MagicMock(),
    )
    assert isinstance(instance, RegionUploader)
    response = MagicMock(status_code=status, text="refused")
    response.json.return_value = {"regions": 2, "updated": 2, "unchanged": 0}
    instance.post = MagicMock(return_value=response)  # type: ignore[method-assign]
    return instance


def sent(instance: RegionUploader) -> tuple[str, dict]:
    url, data = instance.post.call_args[0][:2]  # type: ignore[attr-defined]
    return url, json.loads(data)


def test_the_whole_table_goes_in_one_request():
    instance = uploader()
    instance.submit_results([WEJHEROWO, MOKOTOW])

    assert instance.post.call_count == 1  # type: ignore[attr-defined]
    url, body = sent(instance)
    assert url == "http://localhost:3000/api/ingest/region"
    assert body == {"offices": [WEJHEROWO, MOKOTOW]}


def test_only_a_rows_fields_go_and_a_line_that_is_no_row_stays_behind():
    # The pipeline's stderr carries its own messages beside the rows.
    instance = uploader()
    instance.submit_results([{**WEJHEROWO, "index": 3}, {"message": "Finished"}])

    _, body = sent(instance)
    assert body == {"offices": [WEJHEROWO]}


@pytest.mark.parametrize("cut", [{"limit": 10}, {"offset": 5}])
def test_a_table_cut_short_is_not_sent(cut):
    # A powiat carries its gminy's urzędy, so part of the table would leave
    # some of them off its list.
    instance = uploader(**cut)

    with pytest.raises(SystemExit):
        instance.submit_results([WEJHEROWO])
    instance.post.assert_not_called()  # type: ignore[attr-defined]


def test_a_refused_upload_fails_the_run():
    instance = uploader(status=400)

    with pytest.raises(IngestRefused):
        instance.submit_results([WEJHEROWO])
