# Analysis of TODOs in the Codebase

This document provides a categorized list of all the `TODO` comments found in the `src` directory.

## Busy work

- Remove set_content and get_content from scrapers.stores
  - Need to make Teryt actual PipelineModel
  - Use it in the pkw.headers and allow initialization with ctx later

## Split by package

- **./src/analysis/utils/\_\_init\_\_.py** should be a pipline and company_names as well.

### TERYT

- This should become some kind of Pipeline object, so it can be initialized and integrated nicely.
- **[`src/scrapers/teryt.py`](src/scrapers/teryt.py)**: The date is hardcoded and needs to be updated dynamically to avoid stale data.
- There are type error issues

### Wikipedia

- Read index of multiprocess in wikipedia. Then we'll be able to read partially the zip file in each multiprocess, leading to a bigger speed up.
- Add some tests firsts, to make sure the processing works
- Add parallel processing of the XML, because it's currently slow
- We removed writing to tests, we should probably restore it
- There are global counters that need to be refactored
- Check data urodzenia is set for interesting people
- about_person has a weird format, this should be cleaned up as well
- print links, so we can train an algorithm which page is a political person
- **[`src/analysis/people_wiki_merged.py`](src/analysis/people_wiki_merged.py)**: The name parsing logic for Wikipedia data is incorrect.

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
- **[`src/scrapers/pkw/process.py`](src/scrapers/pkw/process.py)**: A bug related to the name "Agnieszka" needs to be fixed.

### Merge

- Make sure, that people's TERYT is close to their location
- **[`src/analysis/utils/__init__.py`](src/analysis/utils/__init__.py)**: There is an issue with a probability calculation.

### Main - conductor

- Write progress to a browser using streamlit - useful for many output paths.
- Pipeline inputs should be marked as inputs
  - Ask to reprocess inputs if needed
  - e.g. person_koryta.jsonl in koryta_merged should run it if it's not there
- **[`src/main.py`](src/main.py)**: General architectural concern about dependency injection or registration of components.
- Implement output order writing
- **[`src/scrapers/stores.py`](src/scrapers/stores.py)**:
  - Pipeline set up should use the abstracted logic of io
  - Check output order when writing the pipeline
- **[`src/stores/file.py`](src/stores/file.py)**: A hardcoded fix should be removed.
- **[`src/analysis/utils/names.py`](src/analysis/utils/names.py)**: Refactor to read dataframes directly.
- **[`src/analysis/utils/__init__.py`](src/analysis/utils/__init__.py)**: A dependency should be removed.

### Testing

- **[`src/tests/test_analysis.py`](src/tests/test_analysis.py)**:
  - Reenable ignored cases
  - Tests are running slow
- **[`src/util/lists.py`](src/util/lists.py)**: Several TODOs about reenabling code and implementing new features.
- Ban imports of setup_context in unit tests. Reading any file should be a failure automatically or it should read a mocked output.
