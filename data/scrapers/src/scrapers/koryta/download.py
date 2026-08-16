"""
This module contains pipelines for downloading and processing data from
Firestore, specifically focusing on 'nodes' and 'edges' collections
to extract and structure information about people and articles.

It defines two main pipelines:
- `process_people`: Extracts `Person` entities from Firestore's 'nodes' collection.
- `process_articles`: Extracts `Article` entities and identifies mentioned people
  within them by processing 'edges' data from Firestore.
"""

import dataclasses
import typing
from datetime import datetime

import pandas as pd
from leveldb_export import parse_leveldb_documents  # type: ignore
from memoized_property import memoized_property  # type:ignore
from tqdm import tqdm

from entities.company import KorytaCompany
from entities.person import Koryta as Person
from entities.person import PersonVote, is_pipeline_uid
from scrapers.stores import (
    CloudStorage,
    Context,
    Pipeline,
)
from scrapers.stores.file import DataRef, DownloadableFile

CURRENT_DATE = datetime.now().strftime("%Y-%m-%d")

#: How far back `latest_on_or_before` walks when the day it was asked for has
#: no export. The site dumps at least daily, so a gap wider than this means the
#: export job itself has stopped, and quietly scoring against a fortnight-old
#: snapshot of the site is worse than saying so.
MAX_EXPORT_LOOKBACK_DAYS = 14


KORYTA_DUMP = CloudStorage(
    prefix="hostname=koryta.pl", max_namespaces=["date"], binary=True
)


def export_timestamp(blob_ref: DownloadableFile) -> str | None:
    """The `date=` namespace on a blob path, which is a full ISO timestamp.

    Read off `url` rather than `filename`, because `filename` is the blob name
    with every `/` turned into a `.` and the namespace is no longer a path
    segment there.
    """
    for field in blob_ref.url.split("/"):
        if field.startswith("date="):
            return field.split("=", 1)[1]
    return None


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

    @classmethod
    def latest_on_or_before(
        cls,
        ctx: Context,
        collection_name: str,
        type_name: str | None = None,
        date: str | None = None,
        max_lookback_days: int = MAX_EXPORT_LOOKBACK_DAYS,
    ) -> tuple[pd.DataFrame, str]:
        """The newest export on or before `date`, and the date it came from.

        The site dumps once or twice a day, so a pipeline that asks for today
        before that day's dump has landed finds nothing. Walking back a day at
        a time is what `KorytaPeople` has always done; it lives here so that
        every collection gets it rather than only the ones that spelled the
        loop out. `KorytaVotes` did not, and an unlucky run therefore read zero
        votes and said nothing - which reaches the scoring models as "no human
        has ever voted on anybody", seeding them on published pages alone.

        An empty result is read as "no export that day" rather than "the
        collection is empty", which is the same assumption the loop has always
        made and is safe for the collections here: a site with no people, no
        places or no votes at all is not a state worth optimising for.

        Bounded rather than `while True`: with no exports reachable at all - an
        empty bucket, or credentials that can see none of it - an unbounded
        walk lists the bucket once per simulated day forever instead of saying
        what is wrong.
        """
        asked_for = date or CURRENT_DATE
        date_read = asked_for
        for _ in range(max_lookback_days + 1):
            print(f"Reading {collection_name} for {date_read}")
            df = cls(collection_name, type_name, date_read).process(ctx)
            if len(df) > 0:
                return df, date_read

            print(
                f"Found no {collection_name} for date {date_read}. "
                "Going one day earlier"
            )
            date_read = (
                datetime.strptime(date_read, "%Y-%m-%d") - pd.Timedelta(days=1)
            ).strftime("%Y-%m-%d")

        raise FileNotFoundError(
            f"No {collection_name} export in the {max_lookback_days} days up to "
            f"{asked_for}. The nightly Firestore dump to "
            f"gs://koryta-pl-crawled/hostname=koryta.pl/ has probably stopped."
        )

    def wanted_blobs(self, blobs: typing.Iterable[DataRef]) -> list[DownloadableFile]:
        """This collection's blobs, from one export rather than a day's worth.

        `self.date` names a day, but the `date=` namespace on a blob holds a
        full timestamp - `date=2026-08-07T18:16:39.344Z` - so matching the day
        as a substring selects every export made that day and reads each
        document once per export. 2026-08-07 has two, and returned 12230 person
        nodes for a site with 6115 people; the same doubling reaches
        `KorytaVotes` as every human vote counted twice, which is somebody's
        opinion weighed double in `PeopleScoreModel.human_votes`.

        The newest export of the day wins, because a later dump supersedes the
        earlier one rather than adding to it. With no date set the caller wants
        everything it can see - `KorytaDiffer` compares one export against
        another - so nothing is dropped there.
        """
        selected = []
        for blob in blobs:
            assert isinstance(blob, DownloadableFile)
            if (
                # Only outputs hold exported documents.
                "output" in blob.filename
                and self.collection_name in blob.filename
                and (not self.date or f"date={self.date}" in blob.filename)
            ):
                selected.append(blob)

        if not self.date:
            return selected

        stamps = {
            stamp for blob in selected if (stamp := export_timestamp(blob)) is not None
        }
        if len(stamps) <= 1:
            return selected

        newest = max(stamps)
        print(
            f"{len(stamps)} exports on {self.date}; reading {newest} and "
            f"ignoring the {len(stamps) - 1} earlier"
        )
        return [blob for blob in selected if export_timestamp(blob) == newest]

    def process(self, ctx: Context):
        """
        List the objects from the specified Firestore collection and output entities.
        """
        output = []
        blobs = ctx.io.list_files(
            CloudStorage(prefix="hostname=koryta.pl", binary=True)
        )
        for blob_ref in tqdm(self.wanted_blobs(blobs)):
            date = export_timestamp(blob_ref)
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
    date: str

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
        df, _ = FirestoreCollection.latest_on_or_before(
            ctx, "nodes", "person", self.date
        )

        outputs = []
        for data in tqdm(df.to_dict(orient="records")):
            votes_interesting = (
                data.get("stats", {}).get("votes", {}).get("interesting", None)
            )
            # A node written before the field existed has no `rejestrIo` at
            # all, and one written alongside nodes that do have it gets NaN
            # from pandas rather than None. Both mean the same thing here.
            rejestr_io = data.get("rejestrIo")
            outputs.append(
                Person(
                    full_name=data.get("name", ""),
                    parties=data.get("parties", []),
                    id=data["id"],
                    data={},  # data,
                    is_public=data.get("stats", {}).get("isApproved", False),
                    votes_interesting=votes_interesting,
                    rejestr_io=rejestr_io if isinstance(rejestr_io, str) else None,
                )
            )

        print("Finished processing people.")
        return pd.DataFrame.from_records([dataclasses.asdict(o) for o in outputs])


class KorytaCompanies(Pipeline[KorytaCompany]):
    """Lists companies (place nodes) already submitted to koryta.pl.

    Mirrors `KorytaPeople`: it reads the latest Firestore export and yields the
    companies present on the site, so a migration can re-submit only companies
    that already exist rather than creating new ones.
    """

    date: str

    def __init__(self, date: str | None = None) -> None:
        super().__init__()
        self.date = date or CURRENT_DATE

    @memoized_property
    def filename(self) -> str:
        if self.date:
            return f"company_koryta_{self.date}"
        return "company_koryta"

    def process(self, ctx: Context):
        df, _ = FirestoreCollection.latest_on_or_before(
            ctx, "nodes", "place", self.date
        )

        outputs = []
        for data in tqdm(df.to_dict(orient="records")):
            krs = data.get("krsNumber")
            if not krs or pd.isna(krs):
                # Some place nodes (e.g. associations) have no KRS number.
                continue
            outputs.append(
                KorytaCompany(
                    id=data["id"],
                    krs=str(krs),
                    is_approved=bool(data.get("revision_id")),
                )
            )

        print("Finished processing companies.")
        return pd.DataFrame.from_records([dataclasses.asdict(o) for o in outputs])


#: What a node has to carry for `analysis.payloads.site` to answer the four
#: lookups the person ingest makes - a person by name, a company by KRS, a
#: region by TERYT, an article by URL - and to tell whether a person node would
#: learn anything. Everything else an export holds (the search chunks, the
#: stats, the `meta` of an article) is dropped: it is most of the bytes and
#: none of the answer.
NODE_FIELDS = [
    "id",
    "type",
    "name",
    "parties",
    "content",
    "wikipedia",
    "rejestrIo",
    "krsNumber",
    "sourceURL",
    "teryt",
]

#: What an edge has to carry to be compared with one the pipeline is about to
#: send: the pair and type it is looked up by, and every discriminator any edge
#: type declares in `frontend/server/utils/edges.ts`.
EDGE_FIELDS = [
    "id",
    "type",
    "source",
    "target",
    "name",
    "content",
    "start_date",
    "end_date",
    "position",
    "party",
    "committee",
    "term",
]


class KorytaExport(Pipeline):
    """One collection of the latest export, narrowed to the fields we compare.

    `KorytaPeople` reads the same dumps but keeps only what scoring needs. This
    keeps what *ingest* needs, which is a different set and includes the edges:
    telling an upload that would change something from one that would not means
    replaying the ingest's own matching, and that is all edges.
    """

    collection_name: str
    fields: list[str]
    date: str

    def __init__(self, date: str | None = None) -> None:
        super().__init__()
        self.date = date or CURRENT_DATE

    @memoized_property
    def filename(self) -> str:
        return f"koryta_{self.collection_name}_{self.date}"

    def process(self, ctx: Context):
        df, date_read = FirestoreCollection.latest_on_or_before(
            ctx, self.collection_name, None, self.date
        )
        print(f"Read {len(df)} {self.collection_name} from the {date_read} export")
        # A column no document of the export fills is still one the comparison
        # asks about, so it has to exist and be empty rather than be missing.
        return df.reindex(columns=self.fields)


class KorytaNodes(KorytaExport):
    """Every node on koryta.pl: the people, companies, regions and articles.

    Every field here is looked up by its exact stored value, and a column of
    digits is what `read_json` most likes to guess wrong: a KRS comes back as
    349305.0 and a wojewodztwo's TERYT as 2.0, neither of which any payload
    would ever match. `parties` is the one column that is not a string.
    """

    collection_name = "nodes"
    fields = NODE_FIELDS
    dtype = {name: str for name in NODE_FIELDS if name != "parties"}


class KorytaEdges(KorytaExport):
    """Every edge on koryta.pl: who worked where, who stood where, who is named."""

    collection_name = "edges"
    dtype = {name: str for name in EDGE_FIELDS}
    fields = EDGE_FIELDS


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
        Pipeline to process and output `PersonVote` entities.
        """
        df, _ = FirestoreCollection.latest_on_or_before(ctx, "votes", date=self.date)

        outputs = []
        for data in tqdm(df.to_dict(orient="records")):
            if is_pipeline_uid(data["userUid"]):
                # Skip the pipeline's own votes, whichever model cast them.
                continue
            category_votes = data.get("categoryVotes", {})
            if isinstance(category_votes, float):
                # The vote is not matching the format
                continue
            # A vote on an extracted fact carries `extractionId` and no
            # `nodeId`, which pandas turns into a NaN rather than a blank. NaN
            # is truthy and equals nothing, so testing it the obvious two ways
            # lets it through, and `str(nan)` then reaches the consumers as a
            # person id of "nan" that no person has.
            person_koryta_id = data.get("nodeId")
            if pd.isna(person_koryta_id) or not str(person_koryta_id).strip():
                continue
            outputs.append(
                PersonVote(
                    person_koryta_id=str(person_koryta_id),
                    interesting=category_votes.get("interesting", None),
                )
            )

        return pd.DataFrame.from_records([dataclasses.asdict(o) for o in outputs])
