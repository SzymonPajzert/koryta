"""What a run on the public CI may keep: no artifact, and a cache of the open web.

The repo is public. Anybody with a GitHub account can download what a run
uploads, and any pull request's run, a fork's too, can restore a cache that
main saved. `downloaded/` holds a run's copies of the private buckets and
`versioned/` the people built from them, so neither may leave the runner.
`.github/workflows/pipelines.yml` says why at more length.
"""

import fnmatch
from pathlib import Path

import pytest
import yaml

from conductor import Conductor
from scrapers.cru import config as cru_config
from scrapers.map.postal_codes import postal_codes_file
from scrapers.map.teryt import teryt_data
from scrapers.pkw.sources import sources as pkw_sources
from stores import config, download
from stores.storage import Client


def _workflows() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / ".github" / "workflows").is_dir():
            return parent / ".github" / "workflows"
    raise AssertionError("no .github/workflows above this checkout")


WORKFLOWS = _workflows()

#: What the download cache names, in the order both its steps must list it:
#: the cache's version is a hash of the patterns, so a restore listing them
#: otherwise finds nothing the save wrote.
OPEN_WEB_DOWNLOADS = [
    "data/pipelines/downloaded/*.csv",
    "data/pipelines/downloaded/*.txt",
    "data/pipelines/downloaded/*.xls",
    "data/pipelines/downloaded/*.xlsx",
    "data/pipelines/downloaded/*.zip",
    "data/pipelines/downloaded/.listing-ranges",
    "!data/pipelines/downloaded/hostname=*",
    "!data/pipelines/downloaded/bucket=*",
]

#: The dump's own cache, one file kept apart because it never turns over.
DUMP = "data/pipelines/downloaded/${{ env.DUMP_FILE }}"

#: Artifacts a workflow may upload from data/pipelines, by workflow and name.
#: None so far: one whose files name nobody would be the first.
ARTIFACTS_FROM_PIPELINES: dict[tuple[str, str], list[str]] = {}


def _steps(workflow: Path) -> list[dict]:
    jobs = yaml.safe_load(workflow.read_text(encoding="utf-8"))["jobs"]
    return [step for job in jobs.values() for step in job.get("steps", [])]


def _uses(step: dict, action: str) -> bool:
    return str(step.get("uses", "")).startswith(action)


def _paths(step: dict) -> list[str]:
    return [line.strip() for line in step["with"]["path"].splitlines() if line.strip()]


def _matches(pattern: str, path: str) -> bool:
    """@actions/glob's reading of these patterns: a `*` stays within one name."""
    wanted, got = pattern.split("/"), path.split("/")
    return len(wanted) == len(got) and all(map(fnmatch.fnmatchcase, got, wanted))


def _taken(patterns: list[str], name: str) -> bool:
    """Whether a cache over `patterns` holds downloaded/<name>.

    actions/cache hands tar every path whose last matching pattern is not an
    exclusion, and tar takes a folder whole - so a file is held when it or any
    folder above it is matched, whatever an exclusion says about the file.
    """
    parts = f"data/pipelines/downloaded/{name}".split("/")
    for depth in range(1, len(parts) + 1):
        path = "/".join(parts[:depth])
        kept = False
        for pattern in patterns:
            if _matches(pattern.removeprefix("!"), path):
                kept = not pattern.startswith("!")
        if kept:
            return True
    return False


def test_no_workflow_uploads_what_the_pipelines_wrote():
    uploads = {
        (workflow.name, step["with"]["name"]): _paths(step)
        for workflow in sorted(WORKFLOWS.glob("*.yml"))
        for step in _steps(workflow)
        if _uses(step, "actions/upload-artifact")
        and any(path.lstrip("!").startswith("data/pipelines") for path in _paths(step))
    }
    assert uploads == ARTIFACTS_FROM_PIPELINES


def test_the_downloads_are_cached_by_the_open_web_patterns_alone():
    caches = [
        (step["uses"].split("@")[0], _paths(step))
        for step in _steps(WORKFLOWS / "pipelines.yml")
        if _uses(step, "actions/cache")
    ]
    assert sorted(caches) == [
        ("actions/cache/restore", [DUMP]),
        ("actions/cache/restore", OPEN_WEB_DOWNLOADS),
        ("actions/cache/save", [DUMP]),
        ("actions/cache/save", OPEN_WEB_DOWNLOADS),
    ]


def test_a_folder_matched_whole_ignores_the_exclusions_below_it():
    """The model of tar the tests below judge by, on the patterns used until
    2026-10-14: they meant to leave the dump out, and they took everything."""
    before = ["data/pipelines/downloaded", "!data/pipelines/downloaded/*.bz2"]
    assert _taken(before, "plwiki-20260701-pages-articles-multistream.xml.bz2")
    assert _taken(before, "hostname=koryta.pl.date=2026-10-14.kind_notes.output-0")


SHARED = "koryta-pl-sharedcache"


@pytest.fixture
def client(tmp_path, monkeypatch) -> Client:
    monkeypatch.setattr(config, "DOWNLOADED_DIR", str(tmp_path))
    monkeypatch.setattr(download, "base_dir", tmp_path)
    return Client.__new__(Client)


@pytest.mark.parametrize(
    "blob_name, bucket",
    [
        ("hostname=koryta.pl/date=2026-10-14T02:00:00Z/kind_notes/output-0", None),
        ("hostname=koryta.pl/date=2026-10-14T02:00:00Z/kind_revisions/out-1", None),
        ("hostname=rejestr.io/api/v2/osoby/1/krs-powiazania/date=2026-10-14", None),
        ("hostname=api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000000029", None),
        ("hostname=rejestr.io/from=2026-09-01/date=2026-10-01.tar.gz", None),
        # A crawled file, or a shared one, that ends as the open web's do.
        ("hostname=bip.example.gov.pl/files/date=2026-10-14/list.xlsx", None),
        ("jobs/krs_register_owners/responses/sweep-1.jsonl.gz", SHARED),
        ("filename=people_merged/user=main/datetime=2026-10-14", SHARED),
        ("filename=people_export/user=main/people.csv", SHARED),
    ],
)
def test_no_copy_of_a_private_bucket_is_cached(client, blob_name, bucket):
    ref = client.cached_storage(blob_name, binary=True, bucket=bucket)
    assert not _taken(OPEN_WEB_DOWNLOADS, download.FileSource(ref).filename)


def test_nothing_read_out_of_the_private_buckets_is_cached(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DOWNLOADED_DIR", str(tmp_path))
    monkeypatch.setattr(download, "base_dir", tmp_path)
    extracted = download.CompressedMirror()._extract_dir("rejestr.io") / "a.json"
    memo = Conductor._memo_path(None, "odpis-seats", "0123abcd")  # type: ignore[arg-type]
    for path in (extracted, Path(memo)):
        assert not _taken(OPEN_WEB_DOWNLOADS, str(path.relative_to(tmp_path)))
    # The CRU dump names the private individuals among the contracts' parties.
    assert not _taken(OPEN_WEB_DOWNLOADS, cru_config.ARTIFACT_FILENAME)


def test_every_open_web_download_is_cached():
    files = [source.source for source in pkw_sources]
    files += [download.FileSource(teryt_data), download.FileSource(postal_codes_file)]
    names = {f.filename for f in files}
    assert {name for name in names if not _taken(OPEN_WEB_DOWNLOADS, name)} == set()
