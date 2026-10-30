"""The crawlers' certificate bundle: curl's roots and Mozilla's intermediates."""

import csv
import io
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from scrapers.common.fetch import HttpResult
from stores.tls import MAX_AGE_S, STALE_AFTER_S, ca_bundle, intermediates

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


LIVE = certificate("live", NOW + timedelta(days=365))


def serving(*pems: str):
    asked: list[str] = []

    def fetch(url: str, timeout: float, user_agent: str) -> HttpResult:
        asked.append(url)
        return HttpResult(url, 200, "text/csv", report(*pems))

    return fetch, asked


def down(url: str, timeout: float, user_agent: str) -> HttpResult:
    return HttpResult(url, 0, "", b"", "curl: (6) Could not resolve host")


def age(path: Path, seconds: float) -> None:
    """Make ``path`` look ``seconds`` older than NOW."""
    then = NOW.timestamp() - seconds
    os.utime(path, (then, then))


def test_expired_and_broken_rows_are_left_out() -> None:
    dead = certificate("dead", NOW - timedelta(days=1))
    rows = report(LIVE, dead, "not a certificate").decode()
    assert intermediates(rows, NOW) == [LIVE]


def test_the_bundle_is_the_live_roots_then_the_intermediates(tmp_path: Path) -> None:
    roots = tmp_path / "roots.pem"
    roots.write_text("ROOTS\n")
    fetch, asked = serving(LIVE)
    path = tmp_path / "tls" / "ca-bundle.pem"

    bundle, how = ca_bundle(
        path, fetch=fetch, roots=str(roots), clock=NOW.timestamp, loads=lambda p: ""
    )
    assert bundle == path and path.read_text() == f"ROOTS\n{LIVE}\n"
    assert "fetched now" in how and len(asked) == 1

    # A week-fresh list is not fetched again, yet the roots are read anew.
    roots.write_text("NEW ROOTS\n")
    age(path.with_name("ca-bundle.pem.intermediates"), MAX_AGE_S - 60)
    bundle, _ = ca_bundle(
        path, fetch=fetch, roots=str(roots), clock=NOW.timestamp, loads=lambda p: ""
    )
    assert path.read_text() == f"NEW ROOTS\n{LIVE}\n" and len(asked) == 1

    age(path.with_name("ca-bundle.pem.intermediates"), MAX_AGE_S + 60)
    ca_bundle(
        path, fetch=fetch, roots=str(roots), clock=NOW.timestamp, loads=lambda p: ""
    )
    assert len(asked) == 2


def test_a_failed_refresh_says_so_and_ends_after_a_month(tmp_path: Path) -> None:
    roots = tmp_path / "roots.pem"
    roots.write_text("ROOTS\n")
    path = tmp_path / "ca-bundle.pem"
    kept = path.with_name("ca-bundle.pem.intermediates")

    assert ca_bundle(
        path, fetch=down, roots=str(roots), clock=NOW.timestamp, loads=lambda p: ""
    ) == (
        None,
        "CCADB refresh failed (curl: (6) Could not resolve host): curl's roots only",
    )

    kept.write_text(f"{LIVE}\n")
    age(kept, MAX_AGE_S + 60)
    bundle, how = ca_bundle(
        path, fetch=down, roots=str(roots), clock=NOW.timestamp, loads=lambda p: ""
    )
    assert bundle == path and how.startswith("CCADB refresh failed")
    assert path.read_text() == f"ROOTS\n{LIVE}\n"

    age(kept, STALE_AFTER_S + 60)
    bundle, how = ca_bundle(
        path, fetch=down, roots=str(roots), clock=NOW.timestamp, loads=lambda p: ""
    )
    assert bundle is None and how.endswith("curl's roots only")


def test_a_bundle_curl_refuses_falls_back_to_the_roots(tmp_path: Path) -> None:
    roots = tmp_path / "roots.pem"
    roots.write_text("ROOTS\n")
    fetch, _ = serving(LIVE)
    bundle, how = ca_bundle(
        tmp_path / "ca-bundle.pem",
        fetch=fetch,
        roots=str(roots),
        clock=NOW.timestamp,
        loads=lambda p: "curl: (77) error setting certificate verify locations",
    )
    assert bundle is None and "curl refused the bundle" in how


def test_intermediates_are_written_as_read() -> None:
    crlf = LIVE.replace("\n", "\r\n") + "\r\n"
    assert intermediates(report(crlf).decode(), NOW) == [LIVE]
