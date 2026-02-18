# Article Crawler

Distributed PostgreSQL-backed web crawler for discovering and downloading news articles.

## Module structure

- `crawler.py` - Crawl business logic: HTTP requests, link extraction, rate limiting, main loop
- `db.py` - `CrawlerDB` class encapsulating all PostgreSQL operations
- `scoring.py` - URL priority scoring based on keyword relevance
- `parse.py` - HTML article content extraction (title, date, body text)

## CLI

The top-level entrypoint is `src/crawl.py` (registered as `koryta_crawl`):

```bash
# Initialize the database with seed URLs
koryta_crawl --init-db seed_crawling_urls.txt --storage local

# Load blocked domains from CSV
koryta_crawl --load-blocked blocked.csv

# Start crawling
koryta_crawl --worker-id worker-1 --storage local

# View database statistics
koryta_crawl --stats

# Parse crawled articles
koryta_crawl --parse 100
koryta_crawl --parse 10 --view  # opens in Firefox for validation
```

## Environment variables

- `POSTGRES_HOST` (default: `localhost`)
- `POSTGRES_DB` (default: `crawler_db`)
- `POSTGRES_USER` (default: `crawler_user`)
- `POSTGRES_PASSWORD` (default: `crawler_password`)
