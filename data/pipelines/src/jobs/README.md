# List of currently defined jobs

## krs_scrape_bulletin
1. Reads KRS bulletin for updates on dates we haven't scraped yet

## krs_scrape_free
1. Runs krs_scrape_bulletin
1. Reprocesses pipelines, reads `ScrapeRejestrIO`, which lists what is worth asking about
1. Asks api-krs for each free URLs that we defined for the given KRS
1. Writes every answer to the crawl bucket - an empty object where there was none

## krs_scrape_paid
1. Reads which KRS numbers need to be updated
1. Performs paid queries to rejestr.io

TODO: to be used only for people queries, since we've found free KRS scraping alternatives

## krs_register_owners
1. Reads output of `KRSRegisterEntries` pipeline
1. Continues crawl of the api-krs endpoint to find owners of the companies
1. Writes on failure or partial flushes to RESPONSE_LOG (sharedcache bucket, job output)