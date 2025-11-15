import os
import requests
import re
from pathlib import Path

from typing import Callable
from tqdm import tqdm
import urllib.request

from util.config import DOWNLOADED_DIR

base_dir = Path(DOWNLOADED_DIR)


class FileSource:
    downloader: Callable
    filename: str

    def __init__(
        self,
        # Split into separate lines
        url: str,
        filename: str | None = None,
        downloader: Callable | None = None,
    ) -> None:

        # Define the downloader or use the default download from the URL
        if downloader is not None:
            self.downloader = downloader
        else:
            self.downloader = download_from_url(url)

        # Either save to the default path or
        if filename is None:
            self.filename = url.split("/")[-1]
        else:
            self.filename = filename

    @property
    def downloaded_path(self) -> Path:
        return base_dir / self.filename

    def downloaded(self) -> bool:
        return os.path.exists(base_dir / self.filename)

    def download(self) -> Path:
        destination_path = base_dir / self.filename

        try:
            return self.downloader(destination_path)

        except Exception as e:
            print(f"An error occurred during download: {e}")
            raise


def download_from_url(url):
    def method(destination_path):
        print(f"Downloading {url} to {destination_path}...")

        p = tqdm()

        def reporthook(_, read_size, total_file_size):
            p.total = total_file_size
            p.update(read_size)

        urllib.request.urlretrieve(url, destination_path, reporthook=reporthook)
        print("Download complete!")
        return destination_path

    return method


def download_teryt(destination_path):
    """
    This script replicates the provided cURL command to post data to an ASPX page
    and download the resulting file.
    """
    url = "https://eteryt.stat.gov.pl/eTeryt/rejestr_teryt/udostepnianie_danych/baza_teryt/uzytkownicy_indywidualni/pobieranie/pliki_pelne.aspx?contrast=default"

    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
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

    # Save the file. response.content holds the raw file bytes.
    with open(destination_path, "wb") as f:
        f.write(response.content)

    print(f"✅ Success! File saved as: {destination_path}")
