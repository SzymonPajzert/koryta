from __future__ import annotations

import json
from pathlib import Path


def _normalize_domain(domain: str) -> str:
    value = domain.strip().lower()
    if value.startswith("www."):
        value = value[4:]
    return value


def load_selector_map(path: str | Path) -> dict[str, str]:
    source = Path(path)
    if not source.exists():
        raise FileNotFoundError(source)

    selectors: dict[str, str] = {}
    suffix = source.suffix.lower()

    if suffix == ".jsonl":
        with source.open("r", encoding="utf-8") as handle:
            for line in handle:
                raw = line.strip()
                if not raw:
                    continue
                record = json.loads(raw)
                domain = record.get("domain")
                selector = record.get("selector")
                if (
                    isinstance(domain, str)
                    and isinstance(selector, str)
                    and selector.strip()
                ):
                    selectors[_normalize_domain(domain)] = selector.strip()
        return selectors

    if suffix == ".json":
        data = json.loads(source.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"{source} must contain a JSON object")
        for domain, selector in data.items():
            if (
                isinstance(domain, str)
                and isinstance(selector, str)
                and selector.strip()
            ):
                selectors[_normalize_domain(domain)] = selector.strip()
        return selectors

    raise ValueError(f"Unsupported selector map format: {source.suffix}")
