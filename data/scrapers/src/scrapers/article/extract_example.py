from entities.article import Mention
from scrapers.stores import CloudStorage, Context

# Welcome to koryta.pl data science team!
# Sorry for writing in English, but that's how I usually code and there's a chance
# this project will one day become open source, used by people outside of Poland.

# You can read this doc from top to bottom, to learn about current best practices
# to extract data about political corruption.
# What we use:
#  - Google Cloud Storage to store crawled HTMLs.
#  - DuckDB for readable JSONL dumps.
#  - ??? - for text analysis.
#  - poetry for managing the python libraries.


# To save the data and use it between the scripts, I'm using duckdb.
# It's probably slower, but I use it in other places for analysis
# and it comes with out-of-the box JSONL support, that can be sent to GCP Storage.
# This decorator instantiates insert_into() method,
# and sets the output table to versioned/articles_mentions.jsonl directory.


# Start by running poetry install.
# We need a function to register our binary in poetry - see pyproject.toml.
# You can run it in CLI with either:
#  - poetry run scrape_articles_example
#  - scrape_articles_example from a .venv
def extract(ctx: Context):
    for blob_name, content in ctx.io.read_data(
        CloudStorage(prefix="hostname=jawnylublin.pl")
    ).read_iterable():
        # We iterate blobs from the koryta-pl-crawled bucket.
        # The blob names are following the format:
        # gs://koryta-pl-crawled/hostname=/date=/path-to-the-article, e.g.:
        # gs://koryta-pl-crawled/hostname=jawnylublin.pl/date=2025-09-19/afera-pkol-cba-szuka-w-lubelskim-dowodow-w-sledztwie-dotyczacym-radoslawa-piesiewicza

        # You should be able to view them yourself in gcloud
        # https://console.cloud.google.com/storage/browser/_details/koryta-pl-crawled/hostname%3Djawnylublin.pl/date%3D2025-09-19/afera-pkol-cba-szuka-w-lubelskim-dowodow-w-sledztwie-dotyczacym-radoslawa-piesiewicza;tab=live_object?pageState=(%22StorageObjectListTable%22:(%22f%22:%22%255B%255D%22))&authuser=0&hl=en-GB&project=koryta-pl
        # you can see the running HTML easily by clicking "Authenticated URL"
        # on the page to see the blob in the browser.

        if "afera-pkol-cba-szuka-w-lubelskim-dowodow" in blob_name:
            print(blob_name)  # There are multiple files for each page
            # Each fetched file is saved locally in the downloaded/ directory.
            # The next time you'll run this script,
            # the data will be fetched from the local storage.

        # We'd like to iterate some of the high quality pages
        # to find their evidence of corruption.
        # Then integrate data about them into our database.
        # Currently, Jarosław Stawiarski (PiS) and Radosław Piesiewicz are not in the DB
        # But jawnylublin.pl has an article about them.
        # We can find them in one of the articles:

        for keyword in ["Jarosław Stawiarski", "Radosławem Piesiewiczem"]:
            if keyword in content:
                ctx.io.output_entity(
                    Mention(text=keyword, url=f"https://jawnylublin.pl/{blob_name}")
                )

    # Save the data of all registered in-memory tables to the disk
    # Usually it's in a finally clause, to make sure we don't lose data.
    # You can find all the matches there.
    # dump_dbs() # Handled by pipeline wrapper
