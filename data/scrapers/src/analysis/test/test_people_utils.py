from analysis.people import unique_probability


def test_unique_probability_defaults():
    # p1=None, p2=None, second_name_match=False, n=None
    # p1 -> 1.0, p2 -> 1.0, p_combined -> 1.0
    # n -> 50000 / 40 = 1250
    # p_combined == 1 -> returns 0
    assert unique_probability(None, None, False, None) == 0

def test_unique_probability_no_collision():
    # p1=0.001, p2=0.001, match=True, n=4000
    # p_combined = 1e-6
    # n = 100
    # exp(-100 * 1e-6) = exp(-0.0001) ~ 0.9999
    prob = unique_probability(0.001, 0.001, True, 4000)
    assert 0.99 < prob < 1.0

def test_unique_probability_small_n():
    # n < 50 branch
    # n=40 -> n_adj = 1
    # p1=0.5, p2=1.0
    # pow(1 - 0.5, 1) = 0.5
    prob = unique_probability(0.5, None, False, 40)
    assert prob == 0.5

def test_unique_probability_second_name_mismatch():
    # second_name_match=False -> p2 becomes 1.0
    # p1=0.1, p2=0.001 (ignored)
    # n=400 -> n_adj = 10
    # exp(-10 * 0.1) = exp(-1) ~ 0.3678
    # But for n < 50, we use pow(1-p, n)
    # pow(0.9, 10) = 0.348678
    prob = unique_probability(0.1, 0.001, False, 400)
    assert 0.34 < prob < 0.35
