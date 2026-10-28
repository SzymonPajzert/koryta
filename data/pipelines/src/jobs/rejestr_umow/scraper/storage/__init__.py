from jobs.rejestr_umow.scraper.storage.base import AgreementRepository
from jobs.rejestr_umow.scraper.storage.json_repo import JsonAgreementRepository
from jobs.rejestr_umow.scraper.storage.sql_repo import SqlAgreementRepository

__all__ = [
    "AgreementRepository",
    "JsonAgreementRepository",
    "SqlAgreementRepository",
]
