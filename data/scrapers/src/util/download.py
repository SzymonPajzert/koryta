import urllib.request
from pathlib import Path
from util.config import VERSIONED_DIR
import os

base_dir = Path(VERSIONED_DIR)


class FileSource:
    url: str

    def __init__(self, url: str) -> None:
        self.url = url

    @property
    def filename(self) -> str:
        return self.url.split("/")[-1]

    @property
    def downloaded_path(self) -> Path:
        return base_dir / self.filename

    def downloaded(self) -> bool:
        return os.path.exists(base_dir / self.filename)

    def download(self) -> Path:
        destination_path = base_dir / self.filename
        print(f"Downloading {self.url} to {destination_path}...")

        try:
            # 4. Download the file and save it to the destination path
            urllib.request.urlretrieve(self.url, destination_path)
            print("Download complete!")
            return destination_path
        except Exception as e:
            print(f"An error occurred during download: {e}")
            raise
