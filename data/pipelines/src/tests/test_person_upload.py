"""What the person uploader makes of a response that dropped a candidacy.

`/api/ingest/person` used to fail a whole person over one candidacy it could
not place - PKW filed it without a constituency, or the region has no node yet
- taking their node and their employments with it. It now accepts the person
and returns what it left out, so the uploader is what has to say so: a fix that
turns a visible 500 into a silent omission is not a fix.
"""

from unittest.mock import MagicMock

from uploader import PersonUploader


def uploader() -> PersonUploader:
    """A PersonUploader whose sign-in is never asked for: nothing here is sent."""
    return PersonUploader(
        MagicMock(endpoint="http://localhost:3000", type="person"),
        tokens=MagicMock(),
        session=MagicMock(),
    )


def response(status: int = 200, **body) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = body
    return resp


UNPLACED = {
    "election_type": "Samorząd",
    "election_year": "2010",
    "reason": "no-teryt",
    "expected": False,
}


def test_a_dropped_candidacy_is_counted():
    instance = uploader()

    instance.count_unplaced(response(unplacedElections=[UNPLACED]))

    assert instance.unplaced == {"Samorząd 2010 (no-teryt)": 1}


def test_an_election_nobody_published_a_constituency_for_is_told_apart():
    # The 1990s ones arrive without a code every time and are not worth
    # looking into; anything else is.
    instance = uploader()

    instance.count_unplaced(
        response(
            unplacedElections=[
                dict(
                    UNPLACED, election_type="Sejm", election_year="1993", expected=True
                )
            ]
        )
    )

    assert instance.unplaced == {"Sejm 1993 (expected)": 1}


def test_the_ordinary_response_says_nothing():
    instance = uploader()

    instance.count_unplaced(response(personId="p1", status="ok"))

    assert instance.unplaced == {}


def test_a_response_that_is_not_json_is_not_an_error_mid_upload():
    # A proxy's error page in the middle of several thousand people must not
    # stop the run.
    instance = uploader()
    resp = MagicMock()
    resp.status_code = 200
    resp.json.side_effect = ValueError("not json")

    instance.count_unplaced(resp)

    assert instance.unplaced == {}


def test_a_failed_request_is_left_to_the_failure_count():
    instance = uploader()

    instance.count_unplaced(response(500, unplacedElections=[UNPLACED]))

    assert instance.unplaced == {}


def test_the_report_is_silent_when_everything_was_placed(capsys):
    uploader().report()

    assert capsys.readouterr().err == ""


def test_the_report_names_what_was_dropped(capsys):
    instance = uploader()
    instance.count_unplaced(response(unplacedElections=[UNPLACED, UNPLACED]))

    instance.report()

    err = capsys.readouterr().err
    assert "2 candidacies were not placed" in err
    assert "Samorząd 2010 (no-teryt)" in err
