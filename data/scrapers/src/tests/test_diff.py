from util.dict import diff_maybe_dict, single_value_diff, something_removed

def test_single_value_diff():
    assert single_value_diff("a", "b") == "  current: a\n  new: b"


def test_something_removed_no_change():
    prev = {"a": 1, "b": {"c": 2}}
    after = {"a": 1, "b": {"c": 2}}
    assert something_removed(prev, after) == []


def test_something_removed_added():
    prev = {"a": 1}
    after = {"a": 1, "b": 2}
    assert something_removed(prev, after) == [("b", "added")]


def test_something_removed_removed():
    prev = {"a": 1, "b": 2}
    after = {"a": 1}
    assert something_removed(prev, after) == [("b", "removed")]


def test_something_removed_changed():
    prev = {"a": 1}
    after = {"a": 2}
    assert something_removed(prev, after) == [
        ("a", "changed\n  current: 1\n  new: 2")
    ]


def test_something_removed_nested_added():
    prev = {"a": {"b": 1}}
    after = {"a": {"b": 1, "c": 2}}
    assert something_removed(prev, after) == [("a.c", "added")]


def test_something_removed_nested_removed():
    prev = {"a": {"b": 1, "c": 2}}
    after = {"a": {"b": 1}}
    assert something_removed(prev, after) == [("a.c", "removed")]


def test_something_removed_nested_changed():
    prev = {"a": {"b": 1}}
    after = {"a": {"b": 2}}
    assert something_removed(prev, after) == [
        ("a.b", "changed\n  current: 1\n  new: 2")
    ]


def test_diff_maybe_dict_no_change():
    prev = {"a": 1}
    after = {"a": 1}
    changed, diff = diff_maybe_dict(prev, after)
    assert not changed
    assert diff == ""


def test_diff_maybe_dict_changed():
    prev = {"a": 1}
    after = {"a": 2}
    changed, diff = diff_maybe_dict(prev, after)
    assert changed
    assert diff == "a changed\n  current: 1\n  new: 2"


def test_diff_maybe_dict_not_dict():
    prev = 1
    after = 2
    changed, diff = diff_maybe_dict(prev, after)
    assert changed
    assert diff == "  current: 1\n  new: 2"


def test_diff_maybe_dict_not_dict_no_change():
    prev = 1
    after = 1
    changed, diff = diff_maybe_dict(prev, after)
    assert not changed
    assert diff == "  current: 1\n  new: 1"
