"""Fetch one odpis pełny and dump its text, to develop the parser against.

The odpis's layout is what `scrapers.krs.odpis_pdf` has to read, and guessing
it is how you get a parser that finds nobody and says nothing. So this prints
the real thing:

    uv run python src/scripts/krs_odpis_probe.py 0000028860
    uv run python src/scripts/krs_odpis_probe.py 0000028860 --save /tmp/x.pdf

Personal data is *redacted on the way out* -- names are shown initialled and
PESELs as their decoded birth date and sex -- because what the parser needs
from this is the layout, not the people. Pass --raw when you genuinely need to
see a person's block verbatim to fix a regex.
"""

import argparse
import io
import re
import sys

from pypdf import PdfReader

from scrapers.krs import search
from util import pesel as pesel_util

#: Every PESEL-shaped run of digits, so output can be scrubbed by default.
_PESEL_RE = re.compile(r"\b\d{11}\b")


def redact(text: str) -> str:
    """Replace each PESEL with what it decodes to."""

    def replace(match: re.Match) -> str:
        facts = pesel_util.facts(match.group(0))
        if facts is None:
            return "<11-digits-not-a-valid-pesel>"
        return f"<PESEL {facts.birth_date} {facts.sex}>"

    return _PESEL_RE.sub(replace, text)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("krs", help="KRS number, zero-filled or not")
    parser.add_argument(
        "--aktualny",
        action="store_true",
        help="fetch the odpis aktualny instead of the odpis pelny",
    )
    parser.add_argument("--save", help="also write the PDF here")
    parser.add_argument(
        "--raw",
        action="store_true",
        help="print PESELs verbatim instead of their decoded birth date",
    )
    parser.add_argument(
        "--lines", type=int, default=0, help="print only the first N lines"
    )
    parser.add_argument(
        "--from", dest="start", help="print from the first line containing this"
    )
    parser.add_argument(
        "--to", dest="stop", help="stop at the next line containing this"
    )
    parser.add_argument(
        "--pdf", help="read this PDF instead of fetching (no network)"
    )
    parser.add_argument(
        "--outline",
        action="store_true",
        help="print only the Dzial/Rubryka/Podrubryka structure",
    )
    args = parser.parse_args()

    krs = search.pad_krs(args.krs)

    fetched: tuple[str, bytes] | None
    if args.pdf:
        with open(args.pdf, "rb") as handle:
            fetched = ("?", handle.read())
    else:
        fetched = search.fetch_odpis_pdf_either(args.krs, full=not args.aktualny)
    if fetched is None:
        sys.exit(f"No odpis for KRS {krs} in either register")
    register, content = fetched

    if args.save:
        with open(args.save, "wb") as handle:
            handle.write(content)

    reader = PdfReader(io.BytesIO(content))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)

    print(f"# KRS {krs}  register={register}  "
          f"{'aktualny' if args.aktualny else 'pelny'}  "
          f"{len(content):,} bytes  {len(reader.pages)} pages")
    print(f"# extracted {len(text):,} characters, "
          f"{len(_PESEL_RE.findall(text))} PESEL-shaped runs")
    print("#" + "-" * 70)

    out = text if args.raw else redact(text)
    lines = out.splitlines()

    if args.outline:
        for line in lines:
            stripped = line.strip()
            if re.match(r"^(Dzia[łl]\s+\d+|Rubryka\s+\d+|Podrubryka\s+\d+)", stripped):
                indent = "  " if stripped.startswith("Rubryka") else ""
                indent = "    " if stripped.startswith("Podrubryka") else indent
                print(f"{indent}{stripped}")
        return

    if args.start:
        begin = next(
            (i for i, line in enumerate(lines) if args.start in line), None
        )
        if begin is None:
            sys.exit(f"--from {args.start!r} matched no line")
        lines = lines[begin:]
    if args.stop:
        end = next(
            (i for i, line in enumerate(lines[1:], 1) if args.stop in line), None
        )
        if end is not None:
            lines = lines[:end]
    if args.lines:
        lines = lines[: args.lines]
    print("\n".join(lines))


if __name__ == "__main__":
    main()
