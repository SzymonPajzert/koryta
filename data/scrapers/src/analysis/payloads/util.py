from typing import Any

import numpy as np


def strip_none(d: dict | list | Any) -> dict | list:
    if isinstance(d, dict):
        return {
            k: strip_none(v)
            for k, v in d.items()
            if v is not None and (not isinstance(v, float) or not np.isnan(v))
        }
    elif isinstance(d, list):
        return [strip_none(v) for v in d if v is not None]
    return d
