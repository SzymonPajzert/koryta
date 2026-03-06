set -e

poetry run lint-imports
poetry run mypy src
poetry run pytest --ignore src/tests
poetry run ruff check --fix
poetry run ruff check

echo "I'll run all the tests now"
poetry run pytest
