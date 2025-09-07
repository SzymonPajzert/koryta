def trim_object(source: dict, keys: list[str]):
    """
    Trim an object by selecting nested fields.

    Keeps only the fields that are listed in `keys`.
    Ignores missing fields.
    Nested fields can be specified using a forward slash, e.g., "a/b/c".
    """
    result = {}
    if not isinstance(source, dict):
        # We're reading a nested value of a non-dict, skip
        return None
    
    for key in keys:
        if "/" in key:
            nested_keys = key.split("/", 2)
            if nested_keys[0] not in source:
                continue
            
            new_values=trim_object(source[nested_keys[0]], nested_keys[1])
            if not new_values:
                continue
            
            merged = {
                **new_values,
                **result.get(nested_keys[0], {})}
            
            if merged and len(merged) > 0:
                result[nested_keys[0]] = merged
        else:
            if key in source:
                result[key] = source[key]
    return result