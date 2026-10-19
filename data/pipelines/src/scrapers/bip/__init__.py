"""BIP crawler: URL classification and registry parsing.

The Postgres frontier now lives in `stores.bip_queue`; the coordinator and CLI
are the `jobs.bip_crawler` job.
"""

from scrapers.bip.registry import RegistryEntry

__all__ = ["RegistryEntry"]
