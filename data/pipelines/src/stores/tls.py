"""The crawlers' certificate bundle: curl's own roots and Mozilla's intermediates.

Plenty of BIP servers send their certificate without the intermediate that
links it to a root. Browsers fill the gap - Firefox ships every intermediate
Mozilla's roots have issued, Chrome fetches the missing one - and curl does
not: on 2026-10-29 seven units of the people mode (311 candidacies:
bip.miastozabrze.pl, bip.powiatbrzozow.pl, bip.strzegom.pl ...) failed with
"unable to get local issuer certificate". With Mozilla's published list of
intermediates (CCADB) beside the roots their chains verify as in a browser.
Certificate checks stay on; Szymon agreed to the bundle on 10-29.
"""

import csv
import io
import os
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from cryptography import x509
from curl_cffi.curl import DEFAULT_CACERT

from scrapers.common.fetch import HttpResult, http_get

#: The intermediates that chain to roots in Mozilla's programme, as Firefox
#: preloads them: a CSV with a PEM column, 1,755 of them and 4.5 MB on 10-29.
MOZILLA_INTERMEDIATES = (
    "https://ccadb.my.salesforce-sites.com/mozilla/MozillaIntermediateCertsCSVReport"
)
#: A bundle older than this is built again: CCADB adds intermediates weekly.
MAX_AGE_S = 7 * 86400
USER_AGENT = "KorytaBIPCrawler/0.1 (+http://koryta.pl/crawler)"


def intermediates(report: str, now: datetime) -> list[str]:
    """The PEMs in Mozilla's report of certificates that have not expired."""
    # The report's CRL column holds long JSON arrays.
    csv.field_size_limit(max(csv.field_size_limit(), 16_000_000))
    pems = []
    for row in csv.DictReader(io.StringIO(report)):
        pem = (row.get("PEM") or "").strip().strip("'")
        if not pem.startswith("-----BEGIN CERTIFICATE-----"):
            continue
        try:
            certificate = x509.load_pem_x509_certificate(pem.encode())
        except ValueError:
            continue
        if certificate.not_valid_after_utc > now:
            pems.append(pem)
    return pems


def ca_bundle(
    path: Path,
    *,
    fetch: Callable[[str, float, str], HttpResult] = http_get,
    roots: str = DEFAULT_CACERT,
    clock: Callable[[], float] = time.time,
) -> Path | None:
    """The bundle at ``path``: curl's roots and Mozilla's intermediates, built
    again when missing or a week old.

    A download that fails keeps the bundle there is; with none, None, and curl
    verifies against its roots alone, as before.
    """
    if path.exists() and clock() - path.stat().st_mtime < MAX_AGE_S:
        return path
    result = fetch(MOZILLA_INTERMEDIATES, 120.0, USER_AGENT)
    now = datetime.fromtimestamp(clock(), timezone.utc)
    pems = (
        intermediates(result.content.decode("utf-8", "replace"), now)
        if result.ok
        else []
    )
    if not pems:
        return path if path.exists() else None
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    partial.write_text(Path(roots).read_text().rstrip() + "\n" + "\n".join(pems) + "\n")
    os.replace(partial, path)
    return path
