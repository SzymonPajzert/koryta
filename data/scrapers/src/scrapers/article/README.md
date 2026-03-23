# Article Crawler

Distributed web crawler for discovering and downloading news articles.

## Module structure

- `crawler.py` - Crawl business logic: HTTP requests, link extraction, rate limiting, main loop
- `postgress_queue.py` - Implementation of CrawlerQueue backed by postgress
- `scoring.py` - URL priority scoring based on keyword relevance
- `parse.py` - HTML article content extraction (title, date, body text)

## DB setup

You need postgress locally, you also need to setup a user. Default credentials are as below. 
If your credentials are different, you should put use following env vars:

```bash
export POSTGRES_HOST='localhost'
export POSTGRES_DB='crawler_db'
export POSTGRES_USER='crawler_user'
export POSTGRES_PASSWORD='crawler_password'
```
 
## CLI

The top-level entrypoint is `src/crawl_cli.py` (registered as `koryta_crawl`):

```bash
# Initialize the database with seed URLs, blocked sites and run crawler
koryta_crawl --seed files/seed.csv --append-blocked files/blocked.csv

# Reset the db
koryta_crawl --reset
```





