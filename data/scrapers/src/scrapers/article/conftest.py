import pytest
from pytest_postgresql import factories as pg_factories

from scrapers.article.postgres_queue import PostgresClient, PostgresCrawlQueue

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
    queue.reset()
    return queue
