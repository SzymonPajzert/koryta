from typing import Any

import pytest

from scrapers.article.postgres_queue import PostgresClient, PostgresCrawlQueue

pg_factories: Any
try:
    from pytest_postgresql import factories as pg_factories  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - local env without test deps
    pg_factories = None

if pg_factories:
    postgresql_proc = pg_factories.postgresql_proc()
    postgresql = pg_factories.postgresql("postgresql_proc")

    @pytest.fixture
    def crawl_queue(postgresql):
        params = postgresql.info.get_parameters()
        pg = PostgresClient(
            params.get("host", "localhost"),
            params.get("dbname", "postgres"),
            params.get("user", "postgres"),
            params.get("password"),
            port=int(params.get("port", 5432)),
        )
        queue = PostgresCrawlQueue(pg)
        queue.init_tables([], reset=True)
        return queue
else:

    @pytest.fixture
    def crawl_queue():
        pytest.skip("pytest-postgresql not installed")
