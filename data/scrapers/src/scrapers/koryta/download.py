"""
This module contains pipelines for downloading and processing data from
Firestore, specifically focusing on 'nodes' and 'edges' collections
to extract and structure information about people and articles.

It defines two main pipelines:
- `process_people`: Extracts `Person` entities from Firestore's 'nodes' collection.
- `process_articles`: Extracts `Article` entities and identifies mentioned people
  within them by processing 'edges' data from Firestore.
"""

from leveldb_export import parse_leveldb_documents  # type: ignore
from tqdm import tqdm

from entities.person import Koryta as Person
from scrapers.stores import CloudStorage, Context, DownloadableFile, Pipeline

KORYTA_DUMP = CloudStorage(
    prefix="hostname=koryta.pl", max_namespaces=["date"], binary=True
)


class KorytaPeople(Pipeline):
    filename = "person_koryta"

    def process(self, ctx: Context):
        """
        Pipeline to process and output `Person` entities.
        """
        for blob_ref in tqdm(ctx.io.list_files(KORYTA_DUMP)):
            blob = ctx.io.read_data(blob_ref)
            assert isinstance(blob_ref, DownloadableFile)
            if "output" not in blob_ref.filename:
                continue
            content = blob.read_file()

            for data in parse_leveldb_documents(content):
                key_info = data.get("_key", {})
                # Try to get ID from standard fields or _key metadata
                person_id = str(data.get("id", "") or key_info.get("name", ""))

                if not person_id and "_key" in data:
                    person_id = str(data["_key"].get("name", ""))

                del data["_key"]
                if data.get("type") == "person":
                    ctx.io.output_entity(
                        Person(
                            full_name=data.get("name", ""),
                            party=data.get("parties", [None])[0],
                            id=person_id,
                            data=data,
                        )
                    )

        print("Finished processing people.")
