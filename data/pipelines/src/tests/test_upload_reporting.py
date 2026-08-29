"""What an upload says about the candidacies it did not store.

A 200 from `/api/ingest/person` used to mean "everything landed", because the
alternative was a 500 - an unplaceable electoral district aborted the whole
request and the person kept their party and lost every candidacy. The endpoint
now stores what it can and names the rest, and this is the half that puts the
names in front of whoever is running the upload.
"""

from uploader import skipped_election_lines


class FakeResponse:
    def __init__(self, body):
        self._body = body

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


def test_names_the_election_and_why_it_was_skipped():
    lines = skipped_election_lines(
        FakeResponse(
            {
                "status": "ok",
                "skippedElections": [
                    {
                        "election": {
                            "election_type": "Sejm",
                            "election_year": "2023",
                            "teryt": "1431",
                        },
                        "reason": "Region not found: 1431",
                    }
                ],
            }
        )
    )

    assert lines == ["Sejm 2023 (1431): Region not found: 1431"]


def test_an_election_with_no_district_says_so():
    lines = skipped_election_lines(
        FakeResponse(
            {
                "skippedElections": [
                    {
                        "election": {
                            "election_type": "Sejmik",
                            "election_year": "2018",
                        },
                        "reason": "Election without teryt: Sejmik 2018",
                    }
                ]
            }
        )
    )

    assert lines == ["Sejmik 2018 (brak TERYT): Election without teryt: Sejmik 2018"]


def test_endpoints_without_the_field_report_nothing():
    # Company, region and score uploads go through the same call.
    assert skipped_election_lines(FakeResponse({"status": "ok"})) == []


def test_a_response_that_is_not_json_is_not_an_upload_failure():
    # This only feeds a log line. Raising here would turn a successful upload
    # into an exception over the shape of a field nothing depends on.
    assert skipped_election_lines(FakeResponse(ValueError("no json"))) == []
    assert skipped_election_lines(FakeResponse(["not", "a", "dict"])) == []
    assert skipped_election_lines(FakeResponse({"skippedElections": ["junk"]})) == []
