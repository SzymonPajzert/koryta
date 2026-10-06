-- BIP crawler schema (Postgres). Create once before the first run:
--   psql "$DATABASE_URL" -f src/scrapers/bip/schema.sql

CREATE TABLE bip_hosts (
  host          text PRIMARY KEY,
  name          text NOT NULL DEFAULT '',
  source_url    text NOT NULL DEFAULT '',
  teryt         text NOT NULL DEFAULT '',
  entry_count   int  NOT NULL DEFAULT 1,
  platform      text NOT NULL DEFAULT 'unknown',
  status        text NOT NULL DEFAULT 'new',   -- new|active|ok|partial|dead
  pages_fetched int  NOT NULL DEFAULT 0,       -- current attempt
  docs_fetched  int  NOT NULL DEFAULT 0,
  pending_urls  int  NOT NULL DEFAULT 0,       -- claimable or in flight
  cap_hit       bool NOT NULL DEFAULT false,
  crawl_id      text NOT NULL DEFAULT '',      -- current attempt id
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_crawled  timestamptz
);

CREATE TABLE bip_urls (
  url            text PRIMARY KEY,
  host           text NOT NULL,
  kind           text NOT NULL DEFAULT 'page',  -- page|doc
  discovered_from text NOT NULL DEFAULT '',
  depth          int  NOT NULL DEFAULT 0,
  section        text NOT NULL DEFAULT '',
  anchor_text    text NOT NULL DEFAULT '',  -- label of the link that discovered it
  content_type   text NOT NULL DEFAULT '',
  size           bigint NOT NULL DEFAULT 0,
  sha256         text NOT NULL DEFAULT '',
  title          text NOT NULL DEFAULT '',
  last_status    int  NOT NULL DEFAULT 0,
  state          text NOT NULL DEFAULT 'queued', -- queued|claimed|fetched|error|skipped
  skip_reason    text,                           -- robots|cap; NULL = not skipped / legacy
  attempts       int  NOT NULL DEFAULT 0,
  locked_by      text,
  locked_until   timestamptz,
  first_seen     timestamptz NOT NULL DEFAULT now(),
  last_checked   timestamptz,
  last_seen      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bip_urls_claim_idx ON bip_urls (state, depth, first_seen);
CREATE INDEX bip_urls_host_idx  ON bip_urls (host, state);

CREATE TABLE bip_docs (
  sha256       text PRIMARY KEY,
  url          text NOT NULL,
  host         text NOT NULL,
  kind         text NOT NULL DEFAULT 'pdf',
  content_type text NOT NULL DEFAULT '',
  size         bigint NOT NULL DEFAULT 0,
  filename     text NOT NULL DEFAULT '',
  title        text NOT NULL DEFAULT '',
  bundle       text NOT NULL DEFAULT '',
  chain        jsonb NOT NULL DEFAULT '[]',
  crawl_id     text NOT NULL DEFAULT '',
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bip_docs_host_idx ON bip_docs (host);

CREATE TABLE bip_runs (
  run_id   text PRIMARY KEY,
  started  timestamptz NOT NULL DEFAULT now(),
  finished timestamptz,
  hosts_done int NOT NULL DEFAULT 0,
  pages      int NOT NULL DEFAULT 0,
  docs_new   int NOT NULL DEFAULT 0,
  docs_seen  int NOT NULL DEFAULT 0,
  errors     int NOT NULL DEFAULT 0
);
