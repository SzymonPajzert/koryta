"""That the request signing still matches the service's own.

`scrapers.krs.search` is a port of two things the ministry's search page does to
sign its requests, and a port that is subtly wrong fails in the least helpful
way available: every request comes back 400, with nothing to say whether the
cause is the cipher, the token, the timestamp or the endpoint. So the token
generator is checked against a transcription of the original here, and the
cipher against its own inverse.
"""

import base64
import random

import pytest
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from scrapers.krs import search
from scrapers.krs.search import (
    SECRET_KEY,
    auth_headers,
    encode_token,
    encrypt_krs,
    pad_krs,
)

# ---------------------------------------------------------------------------
# The original generator, transcribed from the working proof of concept so the
# port has an oracle. Deliberately left in its original shape -- single-letter
# names and all -- because its value here is being a faithful copy of what is
# known to work, not being readable.
# ---------------------------------------------------------------------------
_KRS_POSITIONS = [193, 8, 327, 501, 112, 74, 409, 226, 16, 306]
_TIMESTAMP_POSITIONS = [492, 141, 364, 78, 259, 12, 430, 384, 97, 503, 67, 35, 471, 218]
_CHECKSUM_POSITIONS = [24, 46, 174, 345]
_TOKEN_LEN = 512


def _original_encode_token(krs: str, ts: str) -> str:
    def shift_right(t, n):
        for i in range(len(t) - 1, n, -1):
            t[i] = t[i - 1]
        t[n] = "0"

    def circular_right(t, n):
        i = n % len(t)
        if i == 0:
            return
        a = list(t)
        for s in range(len(t)):
            t[(s + i) % len(t)] = a[s]

    krs = krs.rjust(10, "0")
    s = [str(random.randint(0, 9)) for _ in range(_TOKEN_LEN)]
    for i in range(508, 512):
        s[i] = "0"
    for y, pos in enumerate(_KRS_POSITIONS):
        s[pos] = krs[y]
    for y, pos in enumerate(_TIMESTAMP_POSITIONS):
        s[pos] = ts[y]
    shift = random.randint(1, 9)
    s[11] = str(shift)
    for pos in _CHECKSUM_POSITIONS:
        shift_right(s, pos)
        s[pos] = "0"
    checksum = str(sum(int(c) for c in s)).rjust(4, "0")
    for k in range(4):
        s[_CHECKSUM_POSITIONS[k]] = checksum[k]
    circular_right(s, shift)
    return "".join(s)


@pytest.mark.parametrize("seed", [0, 1, 42, 12345, 999999])
@pytest.mark.parametrize("krs", ["0001112290", "0000000004", "0000638407"])
def test_token_matches_the_original_generator(seed, krs):
    """Same RNG draw in, same 512 digits out."""
    timestamp = "20260913183000"

    random.seed(seed)
    expected = _original_encode_token(krs, timestamp)

    # The port draws from an injected Random in the same order, so seeding a
    # fresh one reproduces the draw exactly.
    actual = encode_token(krs, timestamp, rng=random.Random(seed))

    assert actual == expected


def test_token_is_512_digits():
    token = encode_token("0001112290", "20260913183000", rng=random.Random(7))
    assert len(token) == 512
    assert token.isdigit()


def test_token_rejects_a_timestamp_of_the_wrong_length():
    with pytest.raises(ValueError, match="14 characters"):
        encode_token("0001112290", "2026091318", rng=random.Random(7))


@pytest.mark.parametrize("krs", ["0001112290", "1112290", "4", "0000000000"])
def test_cipher_round_trips_the_padded_krs(krs):
    """Decrypting our own ciphertext gives back the ten-digit KRS.

    This is what pins the mode, the key/IV reuse and the padding scheme all at
    once: get any one of them wrong and the plaintext does not come back.
    """
    ciphertext = base64.b64decode(encrypt_krs(krs))

    decryptor = Cipher(algorithms.AES(SECRET_KEY), modes.CBC(SECRET_KEY)).decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()
    unpadder = padding.PKCS7(algorithms.AES.block_size).unpadder()
    plaintext = unpadder.update(padded) + unpadder.finalize()

    assert plaintext.decode() == pad_krs(krs)


def test_cipher_is_deterministic():
    """A fixed IV means one KRS has exactly one ciphertext.

    Worth a test rather than a comment: if this ever stops holding, the service
    has started sending a real IV and the whole signing scheme has changed.
    """
    assert encrypt_krs("0001112290") == encrypt_krs("0001112290")
    assert encrypt_krs("0001112290") != encrypt_krs("0001112291")


def test_ciphertext_is_one_aes_block():
    """Ten digits plus PKCS7 padding is 16 bytes, so one block."""
    assert len(base64.b64decode(encrypt_krs("0001112290"))) == 16


@pytest.mark.parametrize(
    "value", ["", "abc", "12345678901", "000111229a", "  ", "-1"]
)
def test_pad_krs_rejects_things_that_are_not_krs_numbers(value):
    with pytest.raises(ValueError):
        pad_krs(value)


def test_pad_krs_keeps_significant_leading_zeros():
    assert pad_krs("4") == "0000000004"
    assert pad_krs("0000000004") == "0000000004"


def test_auth_headers_uses_the_placeholder_krs_for_an_encrypted_body():
    """The token's KRS is only read from the body when the body holds digits.

    Every real request sends the encrypted (Base64) form, so the token always
    carries the placeholder -- reproducing the app's interceptor, which is what
    the service validates against.
    """
    encrypted = encrypt_krs("0001112290")
    assert not encrypted.isdigit()

    headers = auth_headers(encrypted)
    assert set(headers) == {"x-api-key", "apiKey"}
    assert len(headers["apiKey"]) == 512


# ---------------------------------------------------------------------------
# The NIP search -- the channel that turns a NIP into a KRS number.
# ---------------------------------------------------------------------------


def test_a_subject_in_both_registers_is_one_hit_not_two():
    """`rejestr: ["P","S"]` returns a row per register, not per subject.

    KRS 0000907937 (Fundacja "Bez Granic") comes back twice, same `numer`,
    different `typRejestru`. Reading the row count as a subject count rejects
    exactly the entities that are in both registers -- which was the bug that
    made this search look like it could not find the very foundation it was
    written for.
    """
    payload = {
        "liczbaPodmiotow": 2,
        "listaPodmiotow": [
            {
                "numer": "907937",
                "nazwa": 'FUNDACJA "BEZ GRANIC"',
                "miejscowosc": "SOCZEWKA",
                "typRejestru": "P",
            },
            {
                "numer": "907937",
                "nazwa": 'FUNDACJA "BEZ GRANIC"',
                "miejscowosc": "SOCZEWKA",
                "typRejestru": "S",
            },
        ],
    }
    hits = search.parse_search(payload)
    assert len(hits) == 1
    assert hits[0].krs == "0000907937"
    # The first register seen wins; both are the same subject either way.
    assert hits[0].register == "P"


def test_the_krs_number_is_padded_back_to_ten_digits():
    """The service returns `numer` unpadded -- 597986, not 0000597986."""
    payload = {"listaPodmiotow": [{"numer": "597986", "typRejestru": "S"}]}
    assert search.parse_search(payload)[0].krs == "0000597986"


def test_two_genuinely_different_subjects_stay_two_hits():
    payload = {
        "listaPodmiotow": [
            {"numer": "907937", "typRejestru": "S"},
            {"numer": "159572", "typRejestru": "S"},
        ]
    }
    assert len(search.parse_search(payload)) == 2


def test_a_search_with_no_results_is_empty_not_an_error():
    assert search.parse_search({"liczbaPodmiotow": 0, "listaPodmiotow": []}) == []
    assert search.parse_search({}) == []


def test_the_search_body_puts_the_nip_where_the_app_puts_it():
    """The app sends every field; the service rejects a body it does not know."""
    body = search._search_body(nip="7743261776")
    assert body["podmiot"]["nip"] == "7743261776"
    assert body["podmiot"]["krs"] is None
    # Both registers, or a fundacja in S is missed.
    assert body["rejestr"] == ["P", "S"]
    assert set(body) == {"rejestr", "podmiot", "status", "paginacja"}


def test_the_search_token_uses_the_placeholder_krs():
    """The body carries no top-level `krs`, so the interceptor's placeholder
    applies -- the same path an encrypted `krs` takes."""
    headers = auth_headers("")
    assert set(headers) == {"x-api-key", "apiKey"}
    assert len(headers["apiKey"]) == 512
