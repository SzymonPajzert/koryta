"""The crawlers' certificate bundle: curl's roots and Mozilla's intermediates."""

import csv
import io
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from scrapers.common.fetch import HttpResult
from stores.tls import MAX_AGE_S, ca_bundle, intermediates

NOW = datetime(2026, 10, 29, tzinfo=timezone.utc)


def certificate(name: str, until: datetime) -> str:
    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    built = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(until - timedelta(days=3650))
        .not_valid_after(until)
        .sign(key, hashes.SHA256())
    )
    return built.public_bytes(serialization.Encoding.PEM).decode().strip()


def report(*pems: str) -> bytes:
    """Mozilla's CSV report, columns as CCADB serves them."""
    out = io.StringIO()
    writer = csv.writer(out, quoting=csv.QUOTE_ALL)
    writer.writerow(
        ["Subject", "Issuer", "SHA256", "Full CRL Issued By This CA", "PEM"]
        + ["JSON Array of Partitioned CRLs"]
    )
    for pem in pems:
        writer.writerow(["CN=x", "CN=y", "AB01", "", pem, "[]"])
    return out.getvalue().encode()


def test_expired_and_broken_rows_are_left_out() -> None:
    live = certificate("live", NOW + timedelta(days=30))
    dead = certificate("dead", NOW - timedelta(days=1))
    rows = report(live, dead, "not a certificate").decode()
    assert intermediates(rows, NOW) == [live]


def test_the_bundle_holds_the_roots_then_the_intermediates(tmp_path: Path) -> None:
    roots = tmp_path / "roots.pem"
    roots.write_text("ROOTS\n")
    live = certificate("live", NOW + timedelta(days=30))
    asked: list[str] = []

    def fetch(url: str, timeout: float, user_agent: str) -> HttpResult:
        asked.append(url)
        return HttpResult(url, 200, "text/csv", report(live))

    path = tmp_path / "tls" / "ca-bundle.pem"
    assert ca_bundle(path, fetch=fetch, roots=str(roots), clock=NOW.timestamp) == path
    assert path.read_text() == f"ROOTS\n{live}\n"

    # Fresh, it is used as it is; a week old, it is built again.
    assert ca_bundle(path, fetch=fetch, roots=str(roots), clock=NOW.timestamp) == path
    assert len(asked) == 1
    week_on = path.stat().st_mtime + MAX_AGE_S + 1
    assert ca_bundle(path, fetch=fetch, roots=str(roots), clock=lambda: week_on) == path
    assert len(asked) == 2


def test_a_failed_download_keeps_what_there_is(tmp_path: Path) -> None:
    roots = tmp_path / "roots.pem"
    roots.write_text("ROOTS\n")

    def down(url: str, timeout: float, user_agent: str) -> HttpResult:
        return HttpResult(url, 0, "", b"", "curl: (6) Could not resolve host")

    path = tmp_path / "ca-bundle.pem"
    assert ca_bundle(path, fetch=down, roots=str(roots), clock=NOW.timestamp) is None
    path.write_text("OLD\n")
    week_on = path.stat().st_mtime + MAX_AGE_S + 1
    assert ca_bundle(path, fetch=down, roots=str(roots), clock=lambda: week_on) == path
    assert path.read_text() == "OLD\n"
