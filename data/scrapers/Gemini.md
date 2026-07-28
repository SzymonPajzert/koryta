# Configuration

Always use the virtual environment at `.venv` for running python commands. The project is managed with uv (`uv sync --all-groups` to build `.venv`, `uv run <tool>` to use it).

Do not manually delete cache folders (like `versioned/`) to refresh pipelines. Use the CLI tool with the `--refresh` flag instead:
`.venv/bin/koryta <target_pipeline> --refresh <pipeline_to_refresh>`
