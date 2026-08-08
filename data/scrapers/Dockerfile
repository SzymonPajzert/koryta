# The capture extractor (src/service), for Cloud Run.
#
# Installs the scrapers package's base dependencies rather than a hand-picked
# subset: `oneshot.py` drives the pipeline modules directly, so it inherits
# their imports, and a trimmed list would break the next time one of them grew
# an import. The `ml` group — torch, spacy and the nvidia runtimes, 4.5 GB of
# the tree — is left out, which is where nearly all of the weight was.
FROM ghcr.io/astral-sh/uv:0.11.33-python3.13-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/usr/local \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src

WORKDIR /app

# Dependencies first, so a change to the source does not refetch them.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-default-groups --group service --no-install-project

COPY src ./src
RUN uv sync --frozen --no-default-groups --group service

# Cloud Run sets $PORT; the default matches the `direct` dispatch mode the
# frontend uses in development.
ENV PORT=8081
CMD exec uvicorn service.app:app --host 0.0.0.0 --port ${PORT} --workers 1
