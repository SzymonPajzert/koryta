set -e

poetry run ruff check --fix
poetry run ruff check
poetry run lint-imports
poetry run mypy src 
poetry run mypy src/analysis/interesting.py --check-untyped-defs 
poetry run pytest --ignore src/tests

echo "I'll run all the tests now"
poetry run pytest
