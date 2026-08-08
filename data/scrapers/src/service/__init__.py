"""The fast extractor for browser-captured articles.

A separate root package from `scrapers`/`stores` on purpose: this is the only
part of the tree that is a long-lived server rather than a batch run, and it is
the only part allowed to reach for GCS, Firestore and the koryta API in the same
breath. The actual parsing and prompting is `scrapers.article.oneshot`, which
stays pure.
"""
