"""Postgres client factory.

This stays minimal until we define a richer interface.
"""

import os

from scrapers.stores import Postgres


class PostgresClient(Postgres):
    def __init__(self, host: str, database: str, user: str, password: str):
        self.host = host
        self.database = database
        self.user = user
        self.password = password

    @classmethod
    def from_env(cls) -> "PostgresClient":
        return cls(
            host=os.getenv("POSTGRES_HOST", "localhost"),
            database=os.getenv("POSTGRES_DB", "crawler_db"),
            user=os.getenv("POSTGRES_USER", "crawler_user"),
            password=os.getenv("POSTGRES_PASSWORD", "crawler_password"),
        )

    def connect(self):
        try:
            import psycopg2  # type: ignore  # noqa: PLC0415
        except ImportError as exc:
            raise RuntimeError(
                "psycopg2 is required to create Postgres connections. "
                "Install psycopg2-binary to use this feature."
            ) from exc

        return psycopg2.connect(
            host=self.host,
            database=self.database,
            user=self.user,
            password=self.password,
        )
