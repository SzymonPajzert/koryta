"""
This module contains pipelines for downloading and processing data from
Firestore, specifically focusing on 'nodes' and 'edges' collections
to extract and structure information about people and articles.

It defines two main pipelines:
- `process_people`: Extracts `Person` entities from Firestore's 'nodes' collection.
- `process_articles`: Extracts `Article` entities and identifies mentioned people
  within them by processing 'edges' data from Firestore.
"""

import shutil
import tempfile
import typing
from pathlib import Path

from leveldb_export import parse_leveldb_documents
from tqdm import tqdm

from entities.person import Koryta as Person
from scrapers.stores import CloudStorage, Context, Pipeline

KORYTA_DUMP = CloudStorage(prefix="hostname=koryta.pl", max_namespaces=["date"])


class KorytaDocuments:
    def process(self, ctx: Context) -> tuple[str, str]:
        """
        Downloads the LevelDB files for nodes and edges to a temporary directory.
        Returns the paths to the 'nodes' and 'edges' LevelDB directories.
        """

        # We need to find the specific blobs to download.
        # ctx.io.list_blobs will return generators of DownloadableFile.
        # We need to preserve the directory structure relative to the common root for LevelDB to work.

        blobs = list(ctx.io.list_blobs(KORYTA_DUMP))

        if not blobs:
            raise FileNotFoundError(f"No blobs found for {KORYTA_DUMP}")

        temp_dir = Path(tempfile.mkdtemp(prefix="koryta_leveldb_"))
        print(f"Downloading LevelDB to {temp_dir}...")

        nodes_path = temp_dir / "nodes"
        edges_path = temp_dir / "edges"
        nodes_path.mkdir(parents=True, exist_ok=True)
        edges_path.mkdir(parents=True, exist_ok=True)

        for blob in tqdm(blobs):
            # Inspect the URL to determine if it belongs to nodes or edges
            if "/kind_nodes/" in blob.url:
                target_dir = nodes_path
                file_name = blob.url.split("/kind_nodes/")[-1]
            elif "/kind_edges/" in blob.url:
                target_dir = edges_path
                file_name = blob.url.split("/kind_edges/")[-1]
            else:
                continue

            target_file = target_dir / file_name
            target_file.parent.mkdir(parents=True, exist_ok=True)

            # Download file content to target location
            f = ctx.io.read_data(blob)
            with open(target_file, "wb") as out_f:
                if hasattr(f, "path"):
                    with open(f.path, "rb") as in_f:
                        shutil.copyfileobj(in_f, out_f)
                else:
                    out_f.write(f.read_content())

        return str(nodes_path), str(edges_path)


class KorytaPeople(Pipeline):
    filename = "person_koryta"
    koryta_docs: KorytaDocuments

    def process(self, ctx: Context):
        """
        Pipeline to process and output `Person` entities.
        """
        print("Downloading raw LevelDB data...")
        downloader = KorytaDocuments()
        nodes_path, _ = downloader.process(ctx)

        print(f"Processing people from LevelDB files at {nodes_path}...")

        files = list(Path(nodes_path).rglob("*"))
        for file_path in tqdm(files):
            if not file_path.is_file():
                continue

            try:
                for data in parse_leveldb_documents(str(file_path)):
                    key_info = data.get("_key", {})
                    # Try to get ID from standard fields or _key metadata
                    person_id = str(data.get("id", "") or key_info.get("name", ""))

                    if not person_id and "_key" in data:
                        person_id = str(data["_key"].get("name", ""))

                    if data.get("type") == "person":
                        ctx.io.output_entity(
                            Person(
                                full_name=data.get("name", ""),
                                party=data.get("parties", [None])[0],
                                id=person_id,
                            )
                        )
            except Exception:
                # Likely not a valid LevelDB data file (e.g. metadata)
                # print(f"Skipping {file_path}: {e}")
                pass

        print("Finished processing people.")


def list_people(ctx: Context) -> typing.Generator[Person, None, None]:
    """
    Lists and yields `Person` entities from the Firestore 'nodes' collection.

    Args:
        ctx: The scraper context, providing I/O access to Firestore.

    Yields:
        `Person` objects, representing individuals with their full name, party, and ID.
    """
    for person_doc in tqdm(ctx.io.read_data(KORYTA_DUMP).read_iterable()):
        id = person_doc.id
        person_data = person_doc.to_dict()
        assert person_data is not None
        yield Person(
            full_name=person_data.get("name", ""),
            party=person_data.get("parties", [None])[0],
            id=id,
        )
