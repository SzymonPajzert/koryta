To install the project:

```
gcloud auth login      # this is needed for buckets - https://docs.google.com/document/d/1bGrtID-mIFFitvfR_cEmmbV8hvTLDIWFQhnRiSwDlyY
python3.13 -m venv ./.venv
. ./.venv/bin/activate
pip install poetry
poetry install

# Then run in order
scrape_koryta_people    # works out of the box
scrape_krs_people       # needs access to koryta-pl-crawled
                        # downloads it for 10 minutes, works out of the box
scrape_krs_companies    # same for this one
scrape_pkw              # needs manual download of a few files TODO put them in the crawled
                        # downloads PKW files - TODO copy them to crawled as well
scrape_wiki             # downloads wiki dump - hardcoded date
analyze_people
```
