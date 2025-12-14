This directory contains projects that manage data shown on the website.

## Project description

### scrapers

Scrapers directory contains scrapers of articles, KRS, KPO, wiki and PKW data.

The data is always written to the versioned folder, so it's kept outside of jj/git repo, but is backed up in the cloud folder.

## Onboarding

### Setting up the Environment (One-time per project)

For each project (e.g. scrapers), create an isolated environment for development.

1.  Navigate to the project directory (e.g., ./koryta/data/scrapers).
1.  Create and activate a virtual environment as `.venv`
1.  Activate it with `source .venv/bin/activate`
1.  Install the project with `poetry install` - You can refer to the documentation in `./data/scrapers/README.md`.

### Day-to-day Development

We can now run the scripts in the scripts folder directly. Because the project is installed, imports like `from scrapers.util import ...` will work correctly without you having to worry about relative imports.

**Run tests**: Navigate to the project root (e.g. scrapers) and run your test runner with `pytest`.

**Adding a dependency**: If you need a new package, add it to the dependencies list in `pyproject.toml` file. Then, rerun `pip install -e .`
