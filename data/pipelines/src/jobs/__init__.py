"""Jobs: the code that changes the world the pipelines read.

A `Pipeline` is a function. Its output lives in `versioned/`, and running it
again on the same inputs gives the same output, so it can always be thrown away
and rebuilt. A job is the other half: it calls an upstream API, buys data,
uploads, and leaves the result somewhere the pipelines then read - the crawl
bucket, the shared cache, koryta.pl. Running it twice is not the same as
running it once.

The split follows `ScrapeRejestrIO` and the scrape it feeds. The pipeline works
out what is worth asking for; the job asks, and writes the answers down. A job
may read any pipeline's output. No pipeline may import a job - the import-linter
layers contract puts `jobs` on top, and `jobs/tests/test_jobs_boundary.py`
checks the two top-level modules the linter cannot see, `pipelines` and
`koryta`.

A job's state is what it wrote, never a copy of a pipeline's output kept up to
date by hand. `krs_register_owners` appends what the register answered to a log
of write-once parts, and the pipeline `KRSRegisterEntries` folds that log into
the ledger: the ledger can be rebuilt from the log at any time, and the log is
never rewritten.
"""
