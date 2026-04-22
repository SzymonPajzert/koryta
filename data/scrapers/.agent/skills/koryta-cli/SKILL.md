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
