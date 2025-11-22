# Analysis of TODOs in the Codebase

This document provides a categorized list of all the `TODO` comments found in the `src` directory.

## 1. Data Quality & Parsing

### TERYT

- This should become some kind of Pipeline object, so it can be initialized and integrated nicely.
- **[`src/scrapers/teryt.py`](src/scrapers/teryt.py)**: The date is hardcoded and needs to be updated dynamically to avoid stale data.
- There are type error issues

### Wikipedia

- Add some tests firsts, to make sure the processing works
- Add parallel processing of the XML, because it's currently slow
- We removed writing to tests, we should probably restore it
- There are global counters that need to be refactored
- Check data urodzenia is set for interesting people
- about_person has a weird format, this should be cleaned up as well

### KRS

- Remove `data.from_source` method and its usage - **[`src/scrapers/krs/data.py`](src/scrapers/krs/data.py)**
- Move **[`src/scrapers/krs/companies.py`](src/scrapers/krs/companies.py)** to tests and make sure they're set
- Be able to query for KRS by the specified location.

### PKW

- **[`src/scrapers/pkw/okregi.py`](src/scrapers/pkw/okregi.py)** - we need to add missing okregi
- Missing teryt for some of them
- Who won - capture that information
  - Handle second turn information for the info about the wins
- **[`src/scrapers/pkw/sources.py`](src/scrapers/pkw/sources.py)**
  - Missing sources
    - add missing 2002_sejmik_kandydaci.zip
    - add missing 2002_powiat_kandydaci.xls
    - add missing 1998_powiat_kandydaci.zip
    - add missing 1998_sejmik_mazowieckie.xls

### Merge

- Make sure, that people's TERYT is close to their location

### Main - conductor

- **[`src/main.py`](src/main.py)**: General architectural concern about dependency injection or registration of components.
- Implement output order writing
- **[`src/scrapers/stores.py`](src/scrapers/stores.py)**:
  - Pipeline set up should use the abstracted logic of io
  - Check output order when writing the pipeline
- **[`src/stores/file.py`](src/stores/file.py)**: A hardcoded fix should be removed.
- **[`src/analysis/utils/names.py`](src/analysis/utils/names.py)**: Refactor to read dataframes directly.
- **[`src/analysis/utils/__init__.py`](src/analysis/utils/__init__.py)**: A dependency should be removed.

## 3. Bug Fixes

- **[`src/scrapers/pkw/process.py`](src/scrapers/pkw/process.py)**: A bug related to the name "Agnieszka" needs to be fixed.
- **[`src/analysis/people_wiki_merged.py`](src/analysis/people_wiki_merged.py)**: The name parsing logic for Wikipedia data is incorrect.
- **[`src/analysis/utils/__init__.py`](src/analysis/utils/__init__.py)**: There is an issue with a probability calculation.

## 4. Feature Enhancements

- **[`src/scrapers/wiki/process_articles.py`](src/scrapers/wiki/process_articles.py)**: A feature to print links to train a model.
- **[`src/scrapers/krs/data.py`](src/scrapers/krs/data.py)**: Several TODOs about scraping more data from government websites.
- **[`src/util/lists.py`](src/util/lists.py)**: Several TODOs about reenabling code and implementing new features.

## 5. Database & Migrations

- **[`src/stores/firestore.py`](src/stores/firestore.py)**: A TODO to update Firestore key matching.

## 6. Configuration & CI/CD

- **[`src/analysis/people_koryta_merged.py`](src/analysis/people_koryta_merged.py)**: Mark file as an output of a script.
- **[`src/analysis/people_pkw_merged.py`](src/analysis/people_pkw_merged.py)**: Mark file as an output of a script.
- **[`src/analysis/people_krs_merged.py`](src/analysis/people_krs_merged.py)**: Mark file as an output of a script.

## 7. Vague or Uncategorized

- **[`src/scrapers/teryt.py`](src/scrapers/teryt.py)**: "Extend this as well." - Needs more context.
- **[`src/scrapers/wiki/process_articles.py`](src/scrapers/wiki/process_articles.py)**: "raise e" - Incomplete error handling.
- **[`src/scrapers/wiki/process_articles.py`](src/scrapers/wiki/process_articles.py)**: "maybe reenable" - Commented-out code.
- **[`src/scrapers/stores.py`](src/scrapers/stores.py)**: "implement it" - Vague.
- **[`src/scrapers/stores.py`](src/scrapers/stores.py)**: "check if name is set" - A validation check.
- **[`src/scrapers/krs/scrape.py-127`](src/scrapers/krs/scrape.py-127)**: A block of `todo` comments that look like they are part of an algorithm.
- **[`src/scrapers/krs/process.py`](src/scrapers/krs/process.py)**: "handle failures better" - Vague.
- **[`src/tests/test_analysis.py`](src/tests/test_analysis.py)**: Several TODOs related to reenabling tests and adding more assertions.
