import json
import sys

from analysis.payloads import CompanyPayloads
from main import _setup_context
from scrapers.stores import ProcessPolicy


def test_pipeline_owner_teryt_presence():
    sys.argv.extend(["--region", "3061"])
    ctx, dumper = _setup_context(False, ProcessPolicy.with_default())

    # Ensure UploadPayloads yields dataframe for region 3061
    p_payloads = CompanyPayloads()
    df_payloads = p_payloads.read_or_process(ctx)

    assert df_payloads is not None, "Payloads Pipeline should return a DataFrame"

    # Filter for target entity KRS 0000144386
    target_row = df_payloads[
        (df_payloads["entity_type"] == "company")
        & (df_payloads["entity_id"] == "0000144386")
    ]

    # Normally Kalisz owns KLA, which yields TERYT 3061.
    # Let's ensure target exists and payload carries 'teryt' = 3061
    assert not target_row.empty, (
        "Target company KLA (0000144386) must exist in payloads."
    )

    payload = target_row.iloc[0]["payload"]
    if isinstance(payload, str):
        payload = json.loads(payload)

    teryt = payload.get("teryt")
    assert teryt is not None, "Payload must contain a teryt field assigned"
    assert "3061" in teryt, (
        f"Expected 3061 in teryt code representing Kalisz ownership, got {teryt}"
    )
