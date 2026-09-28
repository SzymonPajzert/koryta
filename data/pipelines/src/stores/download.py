import argparse
import os
import re
import shutil
import tarfile
import urllib.request
from functools import cached_property
from pathlib import Path
from typing import Callable, Iterator

import google.cloud.storage as gcs_lib
import requests
from tqdm import tqdm

from entities.util import NormalizedParse
from scrapers.stores.file import DownloadableFile as FileSourceConfig
from scrapers.stores.file import NotInMirrorError
from stores.config import DOWNLOADED_DIR

base_dir = Path(DOWNLOADED_DIR)

downloads: dict[str, Callable] = dict()


class FileSource:
    """
    A class to represent a file that can be downloaded.

    It handles checking if the file is already downloaded and downloading it if not.
    It allows downloading from URL or a more complex actions.
    """

    downloader: Callable
    filename: str

    def __init__(self, config: FileSourceConfig) -> None:
        # Define the downloader or use the default download from the URL
        if config.complex_download is not None:
            self.downloader = downloads[config.complex_download]
        elif config.download_lambda is not None:
            self.downloader = config.download_lambda
        else:
            self.downloader = download_from_url(config.url)

        # Either save to the default path or pick it from the URL
        if config.filename is None:
            self.filename = config.url.split("/")[-1]
        else:
            self.filename = config.filename

    @cached_property
    def args(self):
        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--cache-only",
            action="store_true",
            help="Skip files not already cached locally; never download from GCS.",
        )
        return parser.parse_known_args()[0]

    @property
    def downloaded_path(self) -> Path:
        return base_dir / self.filename

    def downloaded(self) -> bool:
        return os.path.exists(base_dir / self.filename)

    def download(self) -> Path:
        if self.args.cache_only:
            raise FileNotFoundError(
                f"Cache miss (--cache-only): {self.filename} not in local cache"
            )
        destination_path = base_dir / self.filename

        try:
            return self.downloader(destination_path)

        except Exception as e:
            print(f"An error occurred during download: {e}")
            raise


# Wikimedia 403s the default Python-urllib agent outright, so downloads have to
# say who they are: https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy
USER_AGENT = "koryta.pl-pipeline/1.0 (https://github.com/SzymonPajzert/koryta)"

_CHUNK_BYTES = 1 << 20


def download_from_url(url):
    def method(destination_path):
        print(f"Downloading {url} to {destination_path}...")

        # Written aside and renamed on success. An interrupted multi-GB dump
        # left at the real path would look downloaded to every later run.
        partial_path = Path(f"{destination_path}.part")
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

        with urllib.request.urlopen(request) as response:
            total = response.headers.get("Content-Length")
            with (
                open(partial_path, "wb") as out,
                tqdm(
                    total=int(total) if total else None,
                    unit="B",
                    unit_scale=True,
                ) as p,
            ):
                while chunk := response.read(_CHUNK_BYTES):
                    out.write(chunk)
                    p.update(len(chunk))

        partial_path.replace(destination_path)
        print("Download complete!")
        return destination_path

    return method


def download_teryt(destination_path):
    """
    The data for TERYT is provided behind the ASPX script.
    We need to perform a more complex call for it, so it's provided as a lambda.
    """
    url = "https://eteryt.stat.gov.pl/eTeryt/rejestr_teryt/udostepnianie_danych/baza_teryt/uzytkownicy_indywidualni/pobieranie/pliki_pelne.aspx?contrast=default"
    accept = ",".join(
        [
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif",
            "image/webp,image/apng,*/*;q=0.8",
        ]
    )

    headers = {
        "Accept": accept,
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://eteryt.stat.gov.pl",
        "Pragma": "no-cache",
        "Referer": "https://eteryt.stat.gov.pl/eTeryt/rejestr_teryt/udostepnianie_danych/baza_teryt/uzytkownicy_indywidualni/pobieranie/pliki_pelne.aspx?contrast=default",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }
    data = (
        "__EVENTTARGET=ctl00%24body%24BTERCUrzedowyPobierz"
        "&__EVENTARGUMENT="
        "&__LASTFOCUS="
        "&ctl00%24body%24TBData=15+listopada+2025"
    )

    print("Sending POST request to download file...")

    response = requests.post(
        url,
        headers=headers,
        data=data,
    )

    # Check if the request was successful
    response.raise_for_status()  # Raises an HTTPError for bad responses (4xx or 5xx)

    # Try to get the filename from the Content-Disposition header
    disposition = response.headers.get("content-disposition")
    print(response.headers)
    if disposition:
        # Example: 'attachment; filename="TERC_Urzedowy_2025-11-15.zip"'
        matches = re.findall('filename="(.+?)"', disposition)
        if matches:
            filename = matches[0]
            print(f"Saving to {filename}")

    # Save the file. response.content holds the raw file bytes.
    with open(destination_path, "wb") as f:
        f.write(response.content)

    print(f"✅ Success! File saved as: {destination_path}")


downloads["download_teryt"] = download_teryt


class CompressedMirror:
    def __init__(self) -> None:
        self._extracted: set[str] = set()  # hosts already extracted

    @cached_property
    def args(self):
        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--compressed-mirror-bucket",
            default="gs://koryta-pl-compressed",
            help="GCS bucket URL or local path for the compressed HTML mirror.",
        )
        parser.add_argument(
            "--no-mirror",
            action="store_true",
            help="Read whole prefixes object by object from the source bucket "
            "instead of from the compressed mirror. Sees the same objects -- "
            "the mirror path fetches whatever its archive lacks from the "
            "bucket -- only slower; for a mirror you suspect is wrong.",
        )
        return parser.parse_known_args()[0]

    @property
    def bulk_reads_enabled(self) -> bool:
        """Whether read_many may serve a whole prefix from an archive.

        Bulk reads only: the article path resolves single URLs through this
        same mirror with nothing to fall back on, so --no-mirror must not
        reach ensure_extracted or get.
        """
        return not self.args.no_mirror

    def _extract_dir(self, host: str) -> Path:
        return base_dir / "compressed" / host

    @staticmethod
    def _pick_archives(names: list[str]) -> list[str]:
        """Which of a host's archives together hold all of its data.

        The compressor writes two shapes. `total/` is a full snapshot, so the
        newest one on its own is everything. `from=X/date=Y` is a delta, and
        the whole chain is needed -- taking only the last would silently drop
        everything before the most recent run, which is what a host with no
        `total/` (rejestr.io) used to get.
        """
        totals = sorted(n for n in names if "/total/" in n)
        if totals:
            return [totals[-1]]
        return sorted(names)

    def _download_blob(self, bucket_name: str, blob_name: str) -> Path:
        df = FileSourceConfig(
            url=f"gs://{bucket_name}/{blob_name}",
            filename_fallback=blob_name.replace("/", "."),
            download_lambda=lambda path: (
                gcs_lib.Client()
                .bucket(bucket_name)
                .blob(blob_name)
                .download_to_filename(str(path))
            ),
            binary=True,
        )
        fs = FileSource(df)
        if not fs.downloaded():
            fs.download()
        return fs.downloaded_path

    def _resolve_tar_paths(self, host: str) -> list[Path]:
        bucket = self.args.compressed_mirror_bucket
        if bucket.startswith("gs://"):
            bucket_name = bucket.removeprefix("gs://")
            blobs = [
                b.name
                for b in gcs_lib.Client()
                .bucket(bucket_name)
                .list_blobs(prefix=f"hostname={host}/")
                if b.name.endswith(".tar.gz")
            ]
            if not blobs:
                raise NotInMirrorError(f"{host} has no snapshot in mirror")
            return [
                self._download_blob(bucket_name, name)
                for name in self._pick_archives(blobs)
            ]

        candidates = [
            str(p) for p in Path(bucket).glob(f"hostname={host}/**/date=*.tar.gz")
        ]
        if not candidates:
            raise NotInMirrorError(f"{host} has no snapshot in mirror")
        return [Path(p) for p in self._pick_archives(candidates)]

    def _resolve_tar_path(self, host: str) -> Path:
        return self._resolve_tar_paths(host)[-1]

    def iter_objects(self, host: str) -> Iterator[tuple[str, bytes]]:
        """Every object the mirror holds for a host, as (GCS name, contents).

        Names are rebuilt to match the source bucket, so callers that parse the
        object path -- which most of the KRS code does -- see what they would
        have seen listing the bucket directly. Deliberately not routed through
        ensure_extracted: that flattens `/` to `.` in filenames, and there is no
        way back from that to the original path.
        """
        for tar_path in self._resolve_tar_paths(host):
            with tarfile.open(tar_path) as tf:
                for member in tf:
                    if not member.isfile() or member.name == "index.txt":
                        continue
                    handle = tf.extractfile(member)
                    if handle is None:
                        continue
                    rel = member.name
                    prefix = f"{host}/"
                    if rel.startswith(prefix):
                        rel = rel[len(prefix) :]
                    yield f"hostname={host}/{rel}", handle.read()

    def ensure_extracted(self, host: str) -> Path:
        extract_dir = self._extract_dir(host)
        if host in self._extracted or extract_dir.exists():
            self._extracted.add(host)
            return extract_dir
        tar_path = self._resolve_tar_path(host)
        extract_dir.mkdir(parents=True, exist_ok=True)
        with tarfile.open(tar_path) as tf:
            for member in tf.getmembers():
                if not member.isfile() or member.name == "index.txt":
                    continue
                rel = member.name[len(host) + 1 :]  # strip "host/"
                filename = rel.replace("/", ".")
                f = tf.extractfile(member)
                if f is not None:
                    (extract_dir / filename).write_bytes(f.read())
        self._extracted.add(host)
        return extract_dir

    def delete_extracted(self, host: str) -> None:
        extract_dir = self._extract_dir(host)
        if extract_dir.exists():
            shutil.rmtree(extract_dir)
        self._extracted.discard(host)

    def get(self, url: str) -> bytes:
        parsed = NormalizedParse.parse(url)
        host = parsed.hostname_normalized
        path = (parsed.path.strip("/") or "index").replace("/", ".")

        extract_dir = self.ensure_extracted(host)
        candidates = sorted(extract_dir.glob(f"{path}.date=*"))
        if not candidates:
            raise NotInMirrorError(f"URL not found in mirror: {url}")
        return candidates[-1].read_bytes()
