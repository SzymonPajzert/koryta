import os
import requests
import re
from pathlib import Path

from typing import Callable
from tqdm import tqdm
import urllib.request

from stores.config import DOWNLOADED_DIR
from scrapers.stores import DownloadableFile as FileSourceConfig

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
        else:
            self.downloader = download_from_url(config.url)

        # Either save to the default path or pick it from the URL
        if config.filename is None:
            self.filename = config.url.split("/")[-1]
        else:
            self.filename = config.filename

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
    The data for TERYT is provided behind the ASPX script.
    We need to perform a more complex call for it, so it's provided as a lambda.
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


downloads["download_teryt"] = download_teryt
