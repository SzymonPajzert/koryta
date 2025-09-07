import copy

import pytest

from util import trim_object


def test_trim_object_simple_keys():
    """Should trim to only specified simple keys."""
    source = {"a": 1, "b": 2, "c": 3}
    keys = ["a", "c"]
    expected = {"a": 1, "c": 3}
    assert trim_object(source, keys) == expected

def test_trim_object_simple_keys_missing():
    """Should ignore missing keys."""
    source = {"a": 1, "b": 2}
    keys = ["a", "c"]
    expected = {"a": 1}
    assert trim_object(source, keys) == expected
    
def test_trim_object_simple_keys_missing():
    """Should ignore missing keys."""
    source = {"a": 1, "b": {"c": 2}}
    keys = ["a", "b/c", "b/d"]
    expected = {"a": 1, "b": {"c": 2}}
    assert trim_object(source, keys) == expected


def test_trim_object_nested_key():
    """Should trim to a specified nested key."""
    source = {"a": {"b": 10, "c": 20}, "d": 30}
    keys = ["a/b"]
    expected = {"a": {"b": 10}}
    assert trim_object(source, keys) == expected


def test_trim_object_deeply_nested_key():
    """Should trim to a deeply nested key."""
    source = {"a": {"b": {"c": 100}}, "d": 200}
    keys = ["a/b/c"]
    expected = {"a": {"b": {"c": 100}}}
    assert trim_object(source, keys) == expected


def test_trim_object_mixed_keys():
    """Should handle a mix of simple and nested keys."""
    source = {"a": 1, "b": {"c": 2, "d": 3}, "e": 4}
    keys = ["a", "b/c"]
    expected = {"a": 1, "b": {"c": 2}}
    assert trim_object(source, keys) == expected


def test_trim_object_multiple_nested_keys_in_same_path():
    """Should correctly merge multiple keys under the same nested path."""
    source = {"a": {"b": 10, "c": 20, "d": 30}, "e": 40}
    keys = ["a/b", "a/d"]
    expected = {"a": {"b": 10, "d": 30}}
    assert trim_object(source, keys) == expected


def test_trim_object_empty_keys():
    """Should return an empty dictionary if keys list is empty."""
    source = {"a": 1, "b": 2}
    keys = []
    expected = {}
    assert trim_object(source, keys) == expected


def test_trim_object_empty_source():
    """Should work for empty source."""
    source = {}
    keys = ["a"]
    expected = {}
    assert trim_object(source, keys) == expected


def test_trim_object_missing_simple_key():
    """Should return empty for a missing simple key."""
    source = {"a": 1, "b": 2}
    keys = ["c"]
    expected = {}
    assert trim_object(source, keys) == expected


def test_trim_object_missing_nested_key_part():
    """Should return empty for a missing key part in a nested path."""
    source = {"a": {"b": 1}}
    keys = ["a/c"]
    expected = {}
    assert trim_object(source, keys) == expected


def test_trim_object_missing_intermediate_nested_key():
    """Should return empty when missing intermediate key in a nested path."""
    source = {"a": {"b": 1}}
    keys = ["x/y"]
    expected = {}
    assert trim_object(source, keys) == expected


def test_trim_object_traversing_non_dict():
    """Should return empty when traversing a non-dictionary value."""
    source = {"a": 1}
    keys = ["a/b"]
    expected = {}
    assert trim_object(source, keys) == expected


def test_trim_object_source_unmodified():
    """Should not modify the original source dictionary."""
    source = {"a": 1, "b": {"c": 2, "d": 3}}
    source_copy = copy.deepcopy(source)
    keys = ["a", "b/c"]
    trim_object(source, keys)
    assert source == source_copy

