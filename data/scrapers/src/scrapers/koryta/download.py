"""
This module contains pipelines for downloading and processing data from
Firestore, specifically focusing on 'nodes' and 'edges' collections
to extract and structure information about people and articles.

It defines two main pipelines:
- `process_people`: Extracts `Person` entities from Firestore's 'nodes' collection.
- `process_articles`: Extracts `Article` entities and identifies mentioned people
  within them by processing 'edges' data from Firestore.
"""

from matplotlib import category
import pandas as pd
from leveldb_export import parse_leveldb_documents  # type: ignore
from memoized_property import memoized_property  # type:ignore
from regex import P
from tqdm import tqdm

from entities.person import Koryta as Person
from entities.person import PersonVote
from scrapers.stores import (
    CloudStorage,
    Context,
    DownloadableFile,
    Pipeline,
)

CURRENT_DATE = "2026-05-14"

KORYTA_DUMP = CloudStorage(
    prefix="hostname=koryta.pl", max_namespaces=["date"], binary=True
)


class FirestoreCollection(Pipeline):
    """
    Base class for Firestore collection pipelines.
    """

    collection_name: str
    type_name: str | None = None
    date: str | None = None

    def __init__(
        self,
        collection_name: str,
        type_name: str | None = None,
        date: str | None = None,
    ) -> None:
        super().__init__()
        self.collection_name = collection_name
        self.type_name = type_name
        self.date = date

    @property
    def pipeline_name(self) -> str:
        base = f"FirestoreCollection_{self.collection_name}"
        if self.type_name:
            base += f"_{self.type_name}"
        return base

    @memoized_property
    def filename(self) -> str:
        base = f"firestore_{self.collection_name}"
        if self.type_name:
            base += f"_{self.type_name}"
        if self.date:
            base += f"_{self.date}"
        return base

    def process(self, ctx: Context):
        """
        List the objects from the specified Firestore collection and output entities.
        """
        output = []
        blobs = list(
            ctx.io.list_files(CloudStorage(prefix="hostname=koryta.pl", binary=True))
        )
        for blob_ref in tqdm(blobs):
            assert isinstance(blob_ref, DownloadableFile)

            date: str | None = None
            for fields in blob_ref.url.split("/"):
                if fields.startswith("date="):
                    date = fields.split("=")[1]
                    break

            if "output" not in blob_ref.filename:
                # Process only outputs that contain exported documents
                continue
            if self.date and f"date={self.date}" not in blob_ref.filename:
                # If a specific date is set, skip other dates
                continue
            if self.collection_name not in blob_ref.filename:
                # Skip files that do not belong to the specified collection
                continue

            content = ctx.io.read_data(blob_ref).read_file()

            for data in parse_leveldb_documents(content):
                key_info = data.get("_key", {})
                # Try to get ID from standard fields or _key metadata
                document_id = str(data.get("id", "") or key_info.get("name", ""))
                if not document_id and "_key" in data:
                    document_id = str(data["_key"].get("name", ""))

                del data["_key"]
                if self.type_name and data.get("type") != self.type_name:
                    continue
                data["id"] = document_id
                data["date"] = date
                output.append(data)

        print(f"Finished processing collection: {self.collection_name}.")
        return pd.DataFrame.from_records(output)


class KorytaPeople(Pipeline[Person]):
    date: str | None = None

    def __init__(self, date: str | None = None) -> None:
        super().__init__()
        self.date = date or CURRENT_DATE

    @memoized_property
    def filename(self) -> str:
        if self.date:
            return f"person_koryta_{self.date}"
        return "person_koryta"

    def process(self, ctx: Context):
        """
        Pipeline to process and output `Person` entities.
        """
        input_documents = FirestoreCollection("nodes", "person", self.date)
        df = input_documents.process(ctx)

        for data in tqdm(df.to_dict(orient="records")):
            votes_interesting = (
                data.get("stats", {}).get("votes", {}).get("interesting", None)
            )
            ctx.io.output_entity(
                Person(
                    full_name=data.get("name", ""),
                    parties=data.get("parties", []),
                    id=data["id"],
                    data=data,
                    is_public=data.get("stats", {}).get("isApproved", False),
                    votes_interesting=votes_interesting,
                )
            )

        print("Finished processing people.")


class KorytaVotes(Pipeline[PersonVote]):
    date: str | None = None

    def __init__(self, date: str | None = None) -> None:
        # TODO this should be argument, passed as a flag or constructor argument
        super().__init__()
        self.date = date or CURRENT_DATE

    @memoized_property
    def filename(self) -> str:
        if self.date:
            return f"person_votes_{self.date}"
        return "person_votes"

    def process(self, ctx: Context):
        """
        Pipeline to process and output `Person` entities.
        """
        input_documents = FirestoreCollection("votes", date=self.date)
        df = input_documents.process(ctx)

        for data in tqdm(df.to_dict(orient="records")):
            if data["userUid"] == "pipeline":
                # Skip pipeline's own votes
                continue
            category_votes = data.get("categoryVotes", {})
            if isinstance(category_votes, float):
                # The vote is not matching the format
                continue
            person_koryta_id = data["nodeId"]
            if not person_koryta_id or person_koryta_id == "":
                continue
            ctx.io.output_entity(
                PersonVote(
                    person_koryta_id=data["nodeId"],
                    interesting=category_votes.get("interesting", None),
                )
            )
