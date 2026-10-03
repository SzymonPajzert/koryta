"""People only an odpis names have no rejestr.io entry: left out, not raised."""

from types import SimpleNamespace

import numpy as np
import pandas as pd

from analysis.payloads import PeoplePayloads
from scrapers.stores import Pipeline


def test_people_with_no_register_entry_are_left_out_not_raised(capsys):
    rows = pd.DataFrame(
        {
            "full_name": ["A", "B", "C", "D"],
            "rejestrio_id": [["123"], [], None, np.array(["456"])],
        }
    )
    pipeline = Pipeline.create(PeoplePayloads)
    pipeline.people = SimpleNamespace(read_or_process=lambda ctx: rows)  # type: ignore[assignment]

    kept = pipeline.registered_people(ctx=None)  # type: ignore[arg-type]

    assert list(kept["full_name"]) == ["A", "D"]
    assert "Leaving out 2 people only an odpis names" in capsys.readouterr().out
