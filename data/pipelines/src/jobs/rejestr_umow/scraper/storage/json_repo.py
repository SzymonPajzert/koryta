
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

from jobs.rejestr_umow import config
from jobs.rejestr_umow.scraper.models import AgreementDetails, AgreementSearchResult
from jobs.rejestr_umow.scraper.storage.base import AgreementRepository

log = logging.getLogger(__name__)


class JsonAgreementRepository(AgreementRepository):
    def __init__(self, data_dir: Path = config.DATA_DIR) -> None:
        self.data_dir = Path(data_dir)
        self.details_dir = self.data_dir / "details"
        self.search_index_path = self.data_dir / "search_index.jsonl"
        self.details_failed_path = self.data_dir / "details_failed.jsonl"
        self.details_dir.mkdir(parents=True, exist_ok=True)

        self._known_search_ids: set[str] = set(self._load_search_ids())
        self._failed_details_ids: set[str] = set(self._load_failed_details_ids())

    # -- Wyszukiwanie ---------------------------------------------------------

    def save_search_result(self, result: AgreementSearchResult) -> None:
        if result.id_umowy in self._known_search_ids:
            return
        with self.search_index_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(result.to_dict(), ensure_ascii=False) + "\n")
        self._known_search_ids.add(result.id_umowy)

    def exists_search_result(self, id_umowy: str) -> bool:
        return id_umowy in self._known_search_ids

    def iter_search_ids(self) -> Iterable[str]:
        return iter(sorted(self._known_search_ids))


    def save_details(self, details: AgreementDetails) -> None:
        path = self._details_path(details.id_umowy)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(details.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp.replace(path)

    def exists_details(self, id_umowy: str) -> bool:
        return self._details_path(id_umowy).exists()

    def mark_details_failed(self, id_umowy: str, error: Optional[str] = None) -> None:
        if id_umowy in self._failed_details_ids:
            return
        record = {
            "idUmowy": id_umowy,
            "blad": error,
            "kiedy": datetime.now(timezone.utc).isoformat(),
        }
        with self.details_failed_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        self._failed_details_ids.add(id_umowy)

    def iter_pending_ids(self) -> Iterable[str]:
        for id_umowy in self.iter_search_ids():
            if id_umowy in self._failed_details_ids:
                continue
            if not self.exists_details(id_umowy):
                yield id_umowy

    def _details_path(self, id_umowy: str) -> Path:
        return self.details_dir / f"{id_umowy}.json"

    def _load_search_ids(self) -> Iterable[str]:
        if not self.search_index_path.exists():
            return
        with self.search_index_path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)["idUmowy"]
                except (json.JSONDecodeError, KeyError):
                    log.warning(
                        "Pominięto uszkodzoną linię w %s", self.search_index_path
                    )

    def _load_failed_details_ids(self) -> Iterable[str]:
        if not self.details_failed_path.exists():
            return
        with self.details_failed_path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)["idUmowy"]
                except (json.JSONDecodeError, KeyError):
                    log.warning(
                        "Pominięto uszkodzoną linię w %s", self.details_failed_path
                    )
