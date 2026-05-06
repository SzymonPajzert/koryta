# Article Crawler

Distributed web crawler for discovering and downloading news articles.

## Module structure

- `crawler.py` - Crawl business logic: HTTP requests, link extraction, rate limiting, main loop
- `postgres_queue.py` - Implementation of CrawlQueue backed by Postgres
- `scoring.py` - URL priority scoring based on keyword relevance
- `parse.py` - HTML article content extraction (title, date, body text)

## PostgreSQL setup

Postgres stores locally queue of URLs to crawl.

```bash
# Ubuntu/Debian
sudo apt install postgresql

# Create user and database (run once)
sudo -u postgres psql -c "CREATE USER crawler_user WITH PASSWORD 'crawler_password';"
sudo -u postgres psql -c "CREATE DATABASE crawler_db OWNER crawler_user;"
```

Use env vars to override the defaults shown above:

```bash
export POSTGRES_HOST='localhost'
export POSTGRES_DB='crawler_db'
export POSTGRES_USER='crawler_user'
export POSTGRES_PASSWORD='crawler_password'
```
 
## CLI

The top-level entrypoint is `src/crawl_cli.py` (registered as `koryta_crawl`). 
There are two files needed to start the crawl.

### seed.csv

Contains list of 'seed' URLs with which we start crawling.

Required column: `Domena` (the domain to crawl). Extra columns (e.g. `Kategoria`) are allowed and ignored.

```
Domena,Kategoria
trojmiasto.pl,mid
torun.naszemiasto.pl,naszemiasto
```

### blocked.csv

Contains list of blocked domains that we skip during crawling.

Required columns exactly: `Domena` and `Powód` (domain and reason for blocking).

```
Domena,Powód
facebook.com,pomijamy fb
```


### Running a crawl

Start one or more workers (run in parallel, the same command can run in multiple terminals):

```bash
# Saving html locally
koryta_crawl \
  --worker-threads 4 \
  --per-domain-rate-limit-qpm 20 \
  --storage-type local \
  --local-output crawler_output \
  --seed files/seed.csv \
  --append-blocked files/blocked.csv
  
# Uploading to GCS
koryta_crawl \
  --worker-threads 4 \
  --per-domain-rate-limit-qpm 20 \
  --storage-type gcs \
  --seed files/seed.csv \
  --append-blocked files/blocked.csv

```

Each worker picks URLs from the shared Postgres queue, so running multiple terminals increases throughput without any extra coordination.


To clear the postgress queue locally run this command (you will be prompted for confirmation).
```bash
# Reset the db
koryta_crawl --reset
```





