---
name: koryta-cli
description: Guidelines on how to evaluate pipeline outputs.
---

# Koryta CLI

To test and view the output of a data pipeline from the scrapers directory, use the `koryta` cli command.
The command is part of the package's virtual environment set up by Poetry.

Example:
`.venv/bin/koryta <pipeline_name> --output stdout`

Do not write custom Python scripts with `setup_context` to evaluate pipelines manually.

## Refreshing Caches
The pipelines use a caching mechanism (e.g., saving outputs to `data/versioned/`). If you modify pipeline code and need those changes to propagate, do NOT manually delete the cache files. Instead, use the `--refresh` flag to force the pipeline and its dependents to re-run.

Example:
`.venv/bin/koryta <target_pipeline> --refresh <pipeline_to_refresh>`

For example, if you updated `PeopleMerged` and want `PeoplePayloads` to rebuild using the new `PeopleMerged` output, run:
`poetry run koryta PeoplePayloads --refresh PeopleMerged`
