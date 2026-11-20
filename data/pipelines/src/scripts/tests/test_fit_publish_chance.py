import numpy as np

from scripts.fit_publish_chance import auc, fit_logistic, predict


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
