import os
import requests
import re
import sys
from pathlib import Path

from tqdm import tqdm
import urllib.request

from util.config import DOWNLOADED_DIR

base_dir = Path(DOWNLOADED_DIR)


class FileSource:
    url: str
    _filename: str | None

    def __init__(self, url: str, filename: str | None = None) -> None:
        self.url = url
        self._filename = filename

    @property
    def filename(self) -> str:
        if self._filename is None:
            return self.url.split("/")[-1]
        return self._filename

    @property
    def downloaded_path(self) -> Path:
        return base_dir / self.filename

    def downloaded(self) -> bool:
        return os.path.exists(base_dir / self.filename)

    def download(self) -> Path:
        destination_path = base_dir / self.filename
        print(f"Downloading {self.url} to {destination_path}...")

        p = tqdm()

        def reporthook(_block_number, read_size, total_file_size):
            p.total = total_file_size
            p.update(read_size)

        try:
            # 4. Download the file and save it to the destination path
            urllib.request.urlretrieve(
                self.url, destination_path, reporthook=reporthook
            )
            print("Download complete!")
            return destination_path
        except Exception as e:
            print(f"An error occurred during download: {e}")
            raise
