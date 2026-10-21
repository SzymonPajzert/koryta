from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Iterable

from scraper.models import AgreementDetails, AgreementSearchResult



class AgreementRepository(ABC):
    @abstractmethod
    def save_search_result(self, result: AgreementSearchResult) -> None:
        pass

    def save_search_results(self, results: Iterable[AgreementSearchResult]) -> None:
        for result in results:
            self.save_search_result(result)

    @abstractmethod
    def exists_search_result(self, id_umowy: str) -> bool:
        pass

    @abstractmethod
    def save_details(self, details: AgreementDetails) -> None:
        pass

    def save_details_many(self, items: Iterable[AgreementDetails]) -> None:

        for details in items:
            self.save_details(details)

    @abstractmethod
    def exists_details(self, id_umowy: str) -> bool:
        pass

    @abstractmethod
    def mark_details_failed(self, id_umowy: str, error: str | None = None) -> None:
        pass

    @abstractmethod
    def iter_search_ids(self) -> Iterable[str]:
        pass

    @abstractmethod
    def iter_pending_ids(self) -> Iterable[str]:
        pass

    def close(self) -> None:
        pass

    def __enter__(self) -> "AgreementRepository":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()
