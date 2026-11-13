"""`koryta_scrape_bip signers`: whose declaration each file a walk credited is.

A credited file is only good if it is that seeker's asset declaration. On
11-13 walks credited Lwówek's "rodo.pdf" to a councillor, and Łukasz Kogut's
declaration, which Głogów's BIP filed on Mariusz Kędziora's page, to Kędziora;
the report said "named" for both. The form itself says whose it is: "Ja,
niżej podpisany(a), Mariusz Kamil Kędziora". This reads that line from each
file a walk kept, from its text or, for a scan, from its first page read by
OCR as the night's parse reads it (`bip_documents_parsed.extract_document`),
and puts it beside the candidacy the file went to:

    koryta_scrape_bip walk 020301 --out /tmp/w020301 --json /tmp/w020301.json
    koryta_scrape_bip signers /tmp/w020301.json --root /tmp/w020301

"theirs" when the line holds the candidacy's surname; "check" when it names
somebody else, or OCR garbled a handwritten name; "no line" when the file does
not say (no declaration, or a form older than the line).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import tarfile
from collections import Counter
from pathlib import Path
from typing import Any

from scrapers.bip.people import fold, stem

#: "podpisany(a)", folded, the "(a)" with it: OCR glues the words of a scan's
#: line together, "Ja,nizejpodpisany，Rufin,Roman Majchrzyk" (Lubliniec).
_SIGNED = re.compile(r"podpisan[ya](?: ?a(?= ))?")
#: Words of the form after the declarant's names.
_AFTER_NAMES = ("imion", "nazwisk", "urodzon", "zamieszk")
#: Words of a name the line is cut to at most.
_NAME_WORDS = 8


def signer(text: str) -> str:
    """The names after "Ja, niżej podpisany(a)" in a declaration's text,
    folded; "" when it has no such line."""
    folded = fold(text)
    for found in _SIGNED.finditer(folded):
        names: list[str] = []
        for word in folded[found.end() :].split()[:_NAME_WORDS]:
            if word.startswith(_AFTER_NAMES):
                break
            names.append(word)
        if names:
            return " ".join(names)
    return ""


def verdict(name: str, signed: str) -> str:
    """Whose the signed names say a file is: "theirs" when they hold the
    surname of ``name`` (a candidacy's "Mariusz KĘDZIORA"), "check" when they
    do not, "no line" when there are none."""
    if not signed:
        return "no line"
    surname = name.rsplit(maxsplit=1)[-1] if name.strip() else ""
    parts = [stem(p) for p in surname.split("-") if p]
    joined = signed.replace(" ", "")
    return "theirs" if parts and any(p in joined for p in parts) else "check"


def blob(root: Path, bundle: str, sha256: str) -> bytes | None:
    """A file's bytes from the bundle a walk kept it in, told by its hash:
    members are named after their address's file name, which files share."""
    path = root / bundle
    if not bundle or not path.is_file():
        return None
    with tarfile.open(path, "r:gz") as tar:
        for member in tar:
            if not member.isfile() or member.name == "index.txt":
                continue
            handle = tar.extractfile(member)
            data = handle.read() if handle else b""
            if hashlib.sha256(data).hexdigest() == sha256:
                return data
    return None


def signers(report: dict[str, Any], root: Path, read: Any) -> list[dict[str, str]]:
    """Each file a walk downloaded for a candidacy, with whose it says it is;
    ``read`` turns a file's bytes into its text (each file read once)."""
    texts: dict[str, str] = {}
    out: list[dict[str, str]] = []
    for candidacy in report.get("candidacies") or []:
        for doc in candidacy.get("docs") or []:
            if doc.get("status") != "ok":
                continue
            sha = str(doc.get("sha256") or "")
            if sha not in texts:
                data = blob(root, str(doc.get("bundle") or ""), sha)
                texts[sha] = "" if data is None else signer(read(data))
            signed = texts[sha]
            out.append(
                {
                    "verdict": verdict(str(candidacy.get("name") or ""), signed),
                    "name": str(candidacy.get("name") or ""),
                    "year": str(candidacy.get("election_year") or ""),
                    "signed": signed,
                    "url": str(doc.get("url") or ""),
                }
            )
    return out


def add_parser(sub: argparse._SubParsersAction) -> None:
    cmd = sub.add_parser(
        "signers",
        help="say who signed each file a walk credited (walk --out, --json)",
    )
    cmd.add_argument("report", type=Path, help="the walk's --json report")
    cmd.add_argument("--root", type=Path, required=True, help="the walk's --out folder")
    cmd.set_defaults(func=cmd_signers)


def cmd_signers(args: argparse.Namespace) -> int:
    # pandas and the OCR models come in with it: only this command needs them.
    from analysis.bip_documents_parsed import extract_document  # noqa: PLC0415

    report = json.loads(args.report.read_text(encoding="utf-8"))
    rows = signers(report, args.root, lambda data: extract_document(data, 1).text)
    for row in rows:
        print(f"{row['verdict']:8s} {row['name']} ({row['year']}): {row['signed']!r}")
        print(f"         {row['url']}")
    counts = Counter(row["verdict"] for row in rows)
    print(", ".join(f"{k} {v}" for k, v in sorted(counts.items())) or "no files")
    return 0
