import pandas as pd

from external.url_store_client import UrlStoreClient
from scrapers.article.postgres_queue import PostgresClient, PostgresCrawlQueue
from scrapers.stores import Context, DoneUrl, Pipeline


def _fetch_url_store() -> list[DoneUrl]:
    client = UrlStoreClient.from_env()
    results, offset = [], 0
    while True:
        page = client.list_urls(status="fetched", limit=500, offset=offset)
        for url in page:
            if url.storage_path:
                results.append(
                    DoneUrl(
                        url=url.url,
                        uid=str(url.id),
                        storage_path=url.storage_path,
                        media_type="text/html",
                    )
                )
        if len(page) < 500:
            break
        offset += 500
    return results


def _fetch_postgres() -> list[DoneUrl]:
    pg_client = PostgresClient.from_env(max_size=1)
    try:
        return PostgresCrawlQueue(pg_client).get_done_urls()
    finally:
        pg_client.close()


class ArticleDoneUrls(Pipeline[DoneUrl]):
    filename = "article_done_urls"

    @property
    def output_class(self):
        return DoneUrl

    def process(self, ctx: Context):
        if ctx.crawl_queue is not None:
            pg_urls = ctx.crawl_queue.get_done_urls()
        else:
            pg_urls = _fetch_postgres()

        url_store_urls = _fetch_url_store()

        total = len(pg_urls) + len(url_store_urls)
        print(
            f"Done URLs — postgres: {len(pg_urls):,}, "
            f"url_store: {len(url_store_urls):,}, total: {total:,}"
        )

        all_urls = pg_urls + url_store_urls
        return pd.DataFrame.from_records(
            [
                {
                    "uid": done.uid,
                    "url": done.url,
                    "storage_path": done.storage_path,
                    "media_type": getattr(done, "media_type", None),
                    "source": "postgres" if i < len(pg_urls) else "url_store",
                }
                for i, done in enumerate(all_urls)
            ]
        )
