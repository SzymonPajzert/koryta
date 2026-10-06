"""The pages the people import created today, which the morning's export lacks.

`KorytaPeople` is the site as the 04:00 export left it. The night's people
import (`jobs.people_import`) creates its new hires' pages after that, so until
the next export nothing that reads the site knows those pages are there - and
the scoring models, which can only rate somebody with a page, would leave the
people the night has just added unrated for a day.

The import writes down what the site took in each run - the node it filed each
person under included - as write-once parts under `SENT_LOG`, one per run, in
`date=<Warsaw day>/<run>.jsonl.gz`. `KorytaPeopleCreated` folds the day's parts
into the pages they created. A page created before the export is in it as
well, and whoever reads both takes the export's: it knows whether anybody has
published the page or voted on it since.
"""

import gzip
import json
from dataclasses import asdict, dataclass

import pandas as pd

from scrapers.koryta.download import CURRENT_DATE
from scrapers.stores import CloudStorage, Context, Pipeline

#: Where `jobs.people_import` writes what each priority run took, one line per
#: person: `person` and `payload` (who, and a hash of what was sent - what a
#: later run leaves alone), `name`, `tier`, `outcome` (the site's answer:
#: created, updated or unchanged), `node` (the page) and `rejestrIo`.
SENT_LOG = CloudStorage(
    prefix="jobs/people_import/sent/",
    bucket="koryta-pl-sharedcache",
    binary=True,
)

COLUMNS = ["id", "full_name", "rejestrIo", "run"]


@dataclass
class CreatedPage:
    """A person page the people import created, as `KorytaPeople` names one."""

    #: The node id the site answered with.
    id: str
    full_name: str
    rejestrIo: str | None
    #: The import run that created it.
    run: str


def created_pages(run: str, part: bytes) -> list[CreatedPage]:
    """The pages one run's part says it created.

    Read by "\\n" alone, as every part of a job's log is: `splitlines` would
    also break a line at a separator a name carries raw. A line from before
    the import wrote the node down names no page, and is passed over.
    """
    pages = []
    for line in gzip.decompress(part).decode("utf-8").split("\n"):
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("outcome") != "created" or not row.get("node"):
            continue
        pages.append(
            CreatedPage(
                id=str(row["node"]),
                full_name=str(row.get("name") or ""),
                rejestrIo=row.get("rejestrIo") or None,
                run=run,
            )
        )
    return pages


class KorytaPeopleCreated(Pipeline[CreatedPage]):
    """The person pages the people import created on `date`, today's by default.

    Volatile - never stored, read afresh by every run that needs it - because
    the day's parts grow while the day lasts: the night's import writes its
    part minutes before the scores are made from this, and a copy on disk from
    any earlier run would not have it. Reading it is one listing of a day and a
    part or two.
    """

    volatile = True
    date: str

    def __init__(self, date: str | None = None) -> None:
        super().__init__()
        self.date = date or CURRENT_DATE

    @property
    def output_class(self):
        return CreatedPage

    def process(self, ctx: Context) -> pd.DataFrame:
        day = CloudStorage(
            prefix=f"{SENT_LOG.prefix}date={self.date}/",
            bucket=SENT_LOG.bucket,
            binary=True,
        )
        pages: list[CreatedPage] = []
        for ref in ctx.io.list_files(day):
            name = getattr(ref, "url", str(ref)).rsplit("/", 1)[-1]
            run = name.removesuffix(".jsonl.gz")
            pages += created_pages(run, ctx.io.read_data(ref).read_bytes())
        df = pd.DataFrame([asdict(page) for page in pages], columns=COLUMNS)
        # One row a page, however many parts name it.
        df = df.drop_duplicates("id", keep="first").reset_index(drop=True)
        print(f"Pages the people import created on {self.date}: {len(df)}")
        return df
