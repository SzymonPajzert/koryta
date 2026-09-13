"""Asking the ministry's public KRS search service for odpisy, and keeping them.

`search` is the signed client for the service behind the register's search
page, which serves the odpis pełny as an unmasked PDF; `store` files each one
in the crawl bucket before anything parses it. Both ask an upstream API, which
is a job's work (see `jobs`): the parser, `scrapers.krs.odpis_pdf`, reads what
they stored and asks nothing.
"""
