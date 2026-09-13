"""Fetching a KRS *odpis pełny* from the ministry's public search service.

There are two ministry endpoints for the register and they do not hold the same
thing.

``api-krs.ms.gov.pl`` is the documented one and the rest of this package already
uses it (`scrapers.krs.scrape`). It answers with JSON, needs no key -- and masks
every personal field. A person arrives as ``{"nazwisko": {"nazwiskoICzlon":
"F*****"}, "imiona": {"imie": "K********"}, "identyfikator": {"pesel":
"7**********"}}``: first letter and asterisks. So it tells us a company has a
board and how many people sit on it, and it cannot tell us who they are. That
is what `scrapers.krs.censored` is named after.

``wyszukiwarka-krs-api.ms.gov.pl`` backs the public search page. It serves the
same register as a PDF, and that PDF is *not* masked -- it is the odpis a court
would issue, carrying full names and full PESELs, because the register is public
by statute (ustawa o KRS art. 8 ust. 1: "Rejestr jest jawny"). This module talks
to that endpoint.

**Why the request signing.** The search page is an Angular app that signs its
own requests, and the endpoint rejects anything unsigned. Both secrets are
shipped to every visitor in the bundle's ``env.js`` -- they are obfuscation, not
authentication, and there is no account, no quota and nothing to apply for. Two
things have to be right per request:

* ``krs`` in the body is AES-128-CBC encrypted with the bundle's ``secretKey``,
  which is used as both key *and* IV, then Base64'd.
* ``apiKey`` in the headers is a 512-digit string with the KRS, a UTC timestamp
  and a checksum scattered through it at fixed positions and the whole thing
  rotated -- a port of the bundle's ``TokenEncoderService``.

The encryption uses `cryptography`, which the project already depends on,
rather than pycryptodome, which it would otherwise have to add for one AES call.

Be gentle with it. This is a government service that nobody had to be asked for
access to, and `REQUEST_INTERVAL` is the delay every caller here observes --
the same courtesy `scrapers.krs.scrape` shows api-krs.
"""

import base64
import random
import typing
from datetime import datetime, timezone

import requests
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

SEARCH_API_URL = "https://wyszukiwarka-krs-api.ms.gov.pl/api/"

#: ``secretKey`` from the bundle's env.js, used as both the AES key and the IV.
SECRET_KEY = b"TopSecretApiKey1"

#: ``apiKey`` from the same file, sent as the ``x-api-key`` header. Not the
#: 512-digit token -- that goes in a header confusingly also called ``apiKey``.
API_KEY = "TopSecretApiKey"

#: Seconds between requests. The register is not paginated per person, so one
#: company is one request and this is the whole rate limit.
REQUEST_INTERVAL = 1.0

# Constants of the token generator, read off TokenEncoderService in the bundle.
# The positions are arbitrary and have no structure to recover -- they are a
# lookup table there and they are a lookup table here.
_KRS_POSITIONS = (193, 8, 327, 501, 112, 74, 409, 226, 16, 306)
_TIMESTAMP_POSITIONS = (492, 141, 364, 78, 259, 12, 430, 384, 97, 503, 67, 35, 471, 218)
_CHECKSUM_POSITIONS = (24, 46, 174, 345)
_SHIFT_MARKER_POSITION = 11
_TOKEN_LENGTH = 512
_TIMESTAMP_FORMAT = "%Y%m%d%H%M%S"

#: The KRS the token carries when the body's ``krs`` is encrypted rather than
#: plain. The app's interceptor does exactly this: it only reads a KRS out of
#: the body when the body holds bare digits, and every real request does not.
_NO_KRS = "0000000000"


class OdpisUnavailable(RuntimeError):
    """The service did not return a document for this KRS."""


def pad_krs(krs: str) -> str:
    """A KRS as the register writes it: ten digits, zero-filled from the left."""
    krs = str(krs).strip()
    if not krs.isdigit() or len(krs) > 10:
        raise ValueError(f"not a KRS number: {krs!r}")
    return krs.rjust(10, "0")


def encrypt_krs(krs: str) -> str:
    """The ``krs`` body field: AES-128-CBC, PKCS7, Base64.

    Key and IV are both `SECRET_KEY`, which is what the bundle does. Reusing
    the key as a fixed IV makes the ciphertext deterministic for a given KRS --
    a real weakness, and the reason this is worth a comment rather than a fix:
    matching the service is the whole requirement.
    """
    encryptor = Cipher(algorithms.AES(SECRET_KEY), modes.CBC(SECRET_KEY)).encryptor()
    padder = padding.PKCS7(algorithms.AES.block_size).padder()
    plaintext = padder.update(pad_krs(krs).encode("utf-8")) + padder.finalize()
    return base64.b64encode(encryptor.update(plaintext) + encryptor.finalize()).decode(
        "ascii"
    )


def _shift_right(digits: list[str], start: int) -> None:
    """Shift everything after `start` one place right, leaving a 0 at `start`."""
    for i in range(len(digits) - 1, start, -1):
        digits[i] = digits[i - 1]
    digits[start] = "0"


def _rotate_right(digits: list[str], by: int) -> None:
    if by % len(digits) == 0:
        return
    original = list(digits)
    for index, digit in enumerate(original):
        digits[(index + by) % len(digits)] = digit


def encode_token(krs: str, timestamp: str, rng: random.Random | None = None) -> str:
    """Port of the bundle's ``TokenEncoderService.encodeToken``.

    `rng` is injectable only so the port can be tested against a fixed seed;
    the service does not care what the filler digits are, and every caller in
    this module leaves it as the default.

    :param krs: up to ten digits, zero-filled here.
    :param timestamp: ``YYYYMMDDHHMMSS``, 14 characters, UTC.
    """
    draw = rng if rng is not None else random.Random()
    krs = pad_krs(krs)
    if len(timestamp) != len(_TIMESTAMP_POSITIONS):
        raise ValueError(
            f"timestamp must be {len(_TIMESTAMP_POSITIONS)} characters: {timestamp!r}"
        )

    digits = [str(draw.randint(0, 9)) for _ in range(_TOKEN_LENGTH)]
    # The last four are zeroed before the checksum is computed over the whole
    # string, which is what keeps the checksum from depending on itself.
    for i in range(_TOKEN_LENGTH - 4, _TOKEN_LENGTH):
        digits[i] = "0"
    for index, position in enumerate(_KRS_POSITIONS):
        digits[position] = krs[index]
    for index, position in enumerate(_TIMESTAMP_POSITIONS):
        digits[position] = timestamp[index]

    # How far the finished token is rotated, recorded inside it so the service
    # can undo the rotation. randomInt(1, 10) in the bundle, i.e. 1..9.
    rotation = draw.randint(1, 9)
    digits[_SHIFT_MARKER_POSITION] = str(rotation)

    for position in _CHECKSUM_POSITIONS:
        _shift_right(digits, position)
        digits[position] = "0"

    checksum = str(sum(int(d) for d in digits)).rjust(4, "0")
    for index, position in enumerate(_CHECKSUM_POSITIONS):
        digits[position] = checksum[index]

    _rotate_right(digits, rotation)
    return "".join(digits)


def auth_headers(body_krs: str, now: datetime | None = None) -> dict[str, str]:
    """The two headers the service checks, for a request carrying `body_krs`."""
    token_krs = body_krs if body_krs.isdigit() else _NO_KRS
    now = now or datetime.now(timezone.utc)
    return {
        "x-api-key": API_KEY,
        "apiKey": encode_token(token_krs, now.strftime(_TIMESTAMP_FORMAT)),
    }


def fetch_odpis_pdf(
    krs: str,
    register: str = "P",
    full: bool = True,
    session: typing.Any | None = None,
    timeout: float = 60.0,
) -> bytes | None:
    """The odpis as a PDF, or None when this KRS is not in this register.

    :param register: ``"P"`` for przedsiębiorcy, ``"S"`` for stowarzyszenia.
        A subject sits in exactly one, and asking the wrong one is how you find
        out which -- see `fetch_odpis_pdf_either`.
    :param full: ``True`` for the *odpis pełny*, which keeps struck-through
        entries and so carries everybody who has ever sat on the board;
        ``False`` for the *odpis aktualny*, which carries only those sitting
        now.
    """
    endpoint = "OdpisPelny/pdf" if full else "OdpisAktualny/pdf"
    encrypted = encrypt_krs(krs)
    response = (session or requests).post(
        f"{SEARCH_API_URL}wyszukiwarka/{endpoint}",
        json={"krs": encrypted, "register": register, "format": "PDF"},
        headers=auth_headers(encrypted),
        timeout=timeout,
    )
    if response.status_code == 200:
        return response.content
    if response.status_code in (400, 404):
        return None
    raise OdpisUnavailable(
        f"KRS {krs} register {register}: HTTP {response.status_code}"
    )


def fetch_odpis_pdf_either(
    krs: str, full: bool = True, session: typing.Any | None = None
) -> tuple[str, bytes] | None:
    """The odpis from whichever register holds this subject.

    P first because it is much the larger of the two, then S -- which is the
    only one carrying SPZOZ hospitals, stowarzyszenia, fundacje, cechy and
    izby, exactly the bodies this pipeline cares most about.
    """
    for register in ("P", "S"):
        content = fetch_odpis_pdf(krs, register=register, full=full, session=session)
        if content:
            return register, content
    return None
