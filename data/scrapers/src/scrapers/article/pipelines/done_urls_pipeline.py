import pandas as pd

from scrapers.article.postgres_queue import PostgresClient, PostgresCrawlQueue
from scrapers.stores import Context, DoneUrl, Pipeline


class ArticleDoneUrls(Pipeline[DoneUrl]):
    filename = "article_done_urls"

    @property
    def output_class(self):
        return DoneUrl

    def process(self, ctx: Context):
        if ctx.crawl_queue is None:
            pg_client = PostgresClient.from_env(max_size=1)
            try:
                queue = PostgresCrawlQueue(pg_client)
                done_urls = queue.get_done_urls()
            finally:
                pg_client.close()
        else:
            done_urls = ctx.crawl_queue.get_done_urls()

        return pd.DataFrame.from_records(
            [
                {
                    "uid": done.uid,
                    "url": done.url,
                    "storage_path": done.storage_path,
                    "media_type": done.media_type,
                }
                for done in done_urls
            ]
        )
