from typing import Any


def single_value_diff(prev, after):
    return f"  current: {prev}\n  new: {after}"


def something_removed(prev: dict, after: dict) -> list[tuple[str, str]]:
    def diff_pair(k, v):
        if k not in after:
            return [(k, "removed")]
        if isinstance(v, dict) and isinstance(after[k], dict):
            return [(k + "." + n, t) for n, t in something_removed(v, after[k])]
        elif v != after[k]:
            return [(k, f"changed\n{single_value_diff(v, after[k])}")]
        return []

    return [r for k, v in prev.items() for r in diff_pair(k, v)] + [
        (k, "added") for k in after.keys() if k not in prev
    ]


def diff_maybe_dict(prev: dict | Any, after: dict | Any) -> tuple[bool, str]:
    if isinstance(prev, dict) and isinstance(after, dict):
        diff = something_removed(prev, after)
        return len(diff) > 0, "\n".join([k + " " + v for (k, v) in diff])
    return prev != after, single_value_diff(prev, after)


def trim_object(source: dict, keys: list[str]):
    """
    Trim an object by selecting nested fields.

    Keeps only the fields that are listed in `keys`.
    Ignores missing fields.
    Nested fields can be specified using a forward slash, e.g., "a/b/c".
    """
    result: dict[str, Any] = {}
    if not isinstance(source, dict):
        # We're reading a nested value of a non-dict, skip
        return None

    for key in keys:
        if "/" in key:
            nested_keys = key.split("/", 2)
            if nested_keys[0] not in source:
                continue

            new_values = trim_object(source[nested_keys[0]], [nested_keys[1]])
            if not new_values:
                continue

            merged = {**new_values, **result.get(nested_keys[0], {})}

            if merged and len(merged) > 0:
                result[nested_keys[0]] = merged
        elif key in source:
            result[key] = source[key]
    return result
