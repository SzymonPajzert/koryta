"""Who the payloads are built for: everybody the ingest can tell apart.

People only an odpis names have no rejestr.io entry. They used to be left out
of every build; the ingest now finds them by their name and full birth date.
"""

from types import SimpleNamespace

import numpy as np
import pandas as pd

from analysis.payloads import PeoplePayloads
from scrapers.stores import Pipeline


def test_people_only_an_odpis_names_go_by_their_name_and_birth_date(capsys):
    rows = pd.DataFrame(
        {
            "full_name": ["A", "B", "C", "D", "E"],
            "rejestrio_id": [["123"], [], None, np.array(["456"]), []],
            "birth_date": ["1970-01-01", "1971-02-02", None, None, "nie wiadomo"],
        }
    )
    pipeline = Pipeline.create(PeoplePayloads)
    pipeline.people = SimpleNamespace(read_or_process=lambda ctx: rows)  # type: ignore[assignment]

    kept = pipeline.registered_people(ctx=None)  # type: ignore[arg-type]

    assert list(kept["full_name"]) == ["A", "B", "D"]
    out = capsys.readouterr().out
    assert "1 people only an odpis names go by their name and birth date" in out
    assert "leaving out 2 with neither a rejestr.io entry nor a birth date" in out
