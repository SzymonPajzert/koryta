from typing import TYPE_CHECKING

from scraper.storage.base import AgreementRepository
from scraper.storage.json_repo import JsonAgreementRepository

if TYPE_CHECKING:
    from scraper.storage.sql_repo import SqlAgreementRepository

__all__ = [
    "AgreementRepository",
    "JsonAgreementRepository",
    "SqlAgreementRepository",
]


def __getattr__(name: str):
    if name == "SqlAgreementRepository":
        from scraper.storage.sql_repo import SqlAgreementRepository

        return SqlAgreementRepository
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
