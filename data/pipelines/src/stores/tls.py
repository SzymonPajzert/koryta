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
import re
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from curl_cffi import requests as cffi_requests
from curl_cffi.curl import DEFAULT_CACERT

from scrapers.common.fetch import HttpResult, http_get

#: The intermediates that chain to roots in Mozilla's programme, as Firefox
#: preloads them: a CSV with a PEM column, 1,755 of them and 4.5 MB on 10-29.
MOZILLA_INTERMEDIATES = (
    "https://ccadb.my.salesforce-sites.com/mozilla/MozillaIntermediateCertsCSVReport"
)
#: Intermediates older than this are fetched again: CCADB adds them weekly.
MAX_AGE_S = 7 * 86400
#: Past this without a refresh that worked, curl goes back to its roots alone
#: rather than trust a list nobody has looked at for a month.
STALE_AFTER_S = 30 * 86400
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
            # Written as cryptography reads it, not as the CSV spelt it.
            pems.append(
                certificate.public_bytes(serialization.Encoding.PEM).decode().strip()
            )
    return pems


def curl_loads(path: Path) -> str:
    """ "" when curl takes ``path`` for its CA file, else why not.

    BoringSSL, not cryptography, reads the bundle, and one certificate it
    refuses makes it refuse the whole file (curl 77): every HTTPS fetch would
    fail. Only that answer counts; a site that does not answer says nothing."""
    try:
        # A str is taken as the CA file (CURLOPT_CAINFO); the stub says bool.
        cffi_requests.head(MOZILLA_INTERMEDIATES, verify=str(path), timeout=20)  # type: ignore[arg-type]
    except Exception as exc:  # noqa: BLE001
        if re.search(r"curl: \(77\)", str(exc)):
            return str(exc)[:160]
    return ""


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f"{path.name}.{os.getpid()}.partial")
    partial.write_text(text)
    os.replace(partial, path)


def ca_bundle(
    path: Path,
    *,
    fetch: Callable[[str, float, str], HttpResult] = http_get,
    roots: str = DEFAULT_CACERT,
    clock: Callable[[], float] = time.time,
    loads: Callable[[Path], str] = curl_loads,
) -> tuple[Path | None, str]:
    """The bundle at ``path`` and a line saying how it was made.

    The intermediates are kept beside it (``<name>.intermediates``) and fetched
    again when a week old; the bundle itself is written anew from curl's live
    roots and them on every call, so a refresh that fails never freezes the
    roots. None when there are no intermediates fresher than `STALE_AFTER_S`:
    curl then verifies against its roots alone.
    """
    kept = path.with_name(path.name + ".intermediates")
    age = clock() - kept.stat().st_mtime if kept.exists() else None
    note = f"Mozilla's intermediates from {(age or 0) / 86400:.0f} days ago"
    if age is None or age >= MAX_AGE_S:
        result = fetch(MOZILLA_INTERMEDIATES, 120.0, USER_AGENT)
        now = datetime.fromtimestamp(clock(), timezone.utc)
        pems = (
            intermediates(result.content.decode("utf-8", "replace"), now)
            if result.ok
            else []
        )
        if pems:
            _write(kept, "\n".join(pems) + "\n")
            note = f"{len(pems):,} of Mozilla's intermediates, fetched now"
        else:
            reason = result.error[:80] or f"HTTP {result.status}"
            if result.ok:
                reason = "no certificates in the report"
            if age is None or age >= STALE_AFTER_S:
                return None, f"CCADB refresh failed ({reason}): curl's roots only"
            note = f"CCADB refresh failed ({reason}); {note}"
    _write(path, Path(roots).read_text().rstrip() + "\n" + kept.read_text())
    refused = loads(path)
    if refused:
        return None, f"curl refused the bundle ({refused}): curl's roots only"
    return path, note
