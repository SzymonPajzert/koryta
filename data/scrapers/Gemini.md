# Configuration

Always use the virtual environment at `.venv` for running python commands. The project is configured to use poetry.

Do not manually delete cache folders (like `versioned/`) to refresh pipelines. Use the CLI tool with the `--refresh` flag instead:
`.venv/bin/koryta <target_pipeline> --refresh <pipeline_to_refresh>`
