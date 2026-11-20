import numpy as np
import pandas as pd

from scripts.fit_publish_chance import (
    auc,
    bip_negatives,
    different_kind,
    fit_logistic,
    predict,
)


def test_recovers_the_weights_it_was_drawn_from():
    rng = np.random.default_rng(1)
    x = np.column_stack([rng.integers(0, 2, 20000), rng.normal(10, 3, 20000)])
    truth, intercept = np.array([2.0, -0.5]), 1.0
    y = (rng.random(20000) < predict(x, truth, intercept)).astype(float)

    weights, fitted = fit_logistic(x, y, c=1e6)

    assert np.allclose(weights, truth, atol=0.1)
    assert abs(fitted - intercept) < 0.3


def test_auc_counts_ordered_pairs():
    assert auc(np.array([0, 0, 1, 1]), np.array([0.1, 0.2, 0.3, 0.4])) == 1.0
    assert auc(np.array([0, 1, 0, 1]), np.array([0.1, 0.2, 0.3, 0.4])) == 0.75


def test_a_date_far_from_the_pages_is_a_misreading_and_a_near_one_a_namesake():
    # The site's differentKind: same year with a slip or two is a misreading.
    assert different_kind("1977-07-16", "1977-07-17", 2026) == "mismatched"
    assert different_kind("1977-07-16", "1975-02-03", 2026) == "namesake"
    assert different_kind("1950-07-16", "1975-02-03", 2026) == "mismatched"
    assert different_kind("1975", "1975-02-03", 2026) == "namesake"
    # Nobody under 18 files a declaration.
    assert different_kind("2015-01-01", "1975-02-03", 2026) == "mismatched"


def frames(publications=(), extracts=(), candidacies=()):
    return (
        pd.DataFrame(list(publications), columns=["personId", "status", "reason"]),
        pd.DataFrame(
            list(extracts),
            columns=["status", "agreed", "pageOutcomes", "personIds", "candidacyKeys"],
        ),
        pd.DataFrame(list(candidacies), columns=["key", "status", "personIds"]),
    )


def test_a_hold_for_no_public_post_is_a_negative_and_a_doubt_is_not():
    publications, extracts, candidacies = frames(
        publications=[
            ("anna", "held", "no_public_post"),
            ("beata", "held", "two_places"),
            ("celina", "held", "no_public_post"),
            ("celina", "queued", None),
        ]
    )

    verdicts = bip_negatives(publications, extracts, candidacies, {}, 2026)

    assert verdicts == {"anna": "no_public_post"}


def test_a_namesake_counts_only_once_nothing_of_theirs_waits():
    agreed = {"value": "1960-01-01"}
    namesake = ("agreed", agreed, {"anna": "different"}, ["anna"], ["k1"])
    publications, extracts, candidacies = frames(
        extracts=[
            namesake,
            ("agreed", agreed, {"beata": "different"}, ["beata"], ["k2"]),
            ("open", None, {}, ["beata"], ["k3"]),
            ("agreed", agreed, {"celina": "different"}, ["celina"], ["k4"]),
        ],
        candidacies=[("k5", "found", ["celina"])],
    )
    births = {"anna": "1965-05-05", "beata": "1965-05-05", "celina": "1965-05-05"}

    verdicts = bip_negatives(publications, extracts, candidacies, births, 2026)

    # Beata has a crop still being read; Celina a found candidacy with no crop.
    assert verdicts == {"anna": "namesake"}
