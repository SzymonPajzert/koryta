set -e
set -x

# One sync of the whole env up front -- mypy and pytest live in the `test`
# group, which a bare `uv run` would drop, taking the ml group with it. After
# that `--no-sync` keeps every step off the resolver.
uv sync --all-groups

uv run --no-sync mypy src --check-untyped-defs --exclude test
uv run --no-sync ruff check --fix
uv run --no-sync ruff check
uv run --no-sync lint-imports
uv run --no-sync mypy src
uv run --no-sync pytest --ignore src/tests

echo "I'll run all the tests now"
uv run --no-sync pytest
