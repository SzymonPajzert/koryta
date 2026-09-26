import glob
import json
import os
import pathlib
import sys

import pandas as pd
from dotenv import load_dotenv


def backup_disabled() -> bool:
    """Whether uploading versioned backups to shared GCS is disabled.

    Controlled by the ``DISABLE_BACKUP`` variable (read from the environment or
    a ``.env`` file), which the ``koryta --no-backup`` flag also sets. Handy for
    local runs against the emulator / prod-data where we don't want to write to
    shared cloud storage.
    """
    load_dotenv()
    return os.getenv("DISABLE_BACKUP", "").strip().lower() in {"1", "true", "yes"}

#: Where the PESEL key lives when the environment does not carry it.
#: **Outside every checkout, deliberately.** The first one was kept in
#: ``data/pipelines/.env``, which is per-worktree -- so when the agent
#: workspace that held it was torn down the key went with it, and with it the
#: only thing that could reproduce the fingerprints of 6,188 already-published
#: people. ``~/.config`` survives every worktree teardown and every `jj
#: workspace forget`.
PESEL_SALT_FILE = os.path.join(
    os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")),
    "koryta",
    "pesel-salt",
)


def pesel_salt(create: bool = False) -> str | None:
    """The key for `util.pesel.fingerprint`, or None if this machine has none.

    ``KORYTA_PESEL_SALT`` wins, so a one-off run can be keyed without touching
    the file; otherwise `PESEL_SALT_FILE` is read.

    `create` mints one and is never the default. A run that silently generated
    a key would produce fingerprints that look exactly like the previous run's
    and join to nothing -- which is the failure this whole arrangement exists
    to make impossible. The caller asks for it explicitly and says so out loud;
    `util.pesel.salt_id` is then what proves on every row which key was used.
    """
    load_dotenv()
    from_env = os.getenv("KORYTA_PESEL_SALT", "").strip()
    if from_env:
        return from_env
    if os.path.exists(PESEL_SALT_FILE):
        salt = open(PESEL_SALT_FILE, encoding="utf-8").read().strip()
        if salt:
            return salt
    if not create:
        return None
    import secrets  # noqa: PLC0415 - only needed on the one run that mints

    salt = secrets.token_hex(32)
    os.makedirs(os.path.dirname(PESEL_SALT_FILE), mode=0o700, exist_ok=True)
    # Written 0600 before anything goes in it, so it is never briefly readable.
    handle = os.open(PESEL_SALT_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(handle, "w", encoding="utf-8") as out:
        out.write(salt + "\n")
    return salt


_current_dir = os.path.dirname(os.path.abspath(__file__))

PROJECT_ROOT = os.path.dirname(os.path.dirname(_current_dir))
VERSIONED_DIR = os.path.join(PROJECT_ROOT, "versioned")
DOWNLOADED_DIR = os.path.join(PROJECT_ROOT, "downloaded")
TESTS_DIR = os.path.join(PROJECT_ROOT, "tests")

if not os.path.exists(VERSIONED_DIR):
    os.makedirs(VERSIONED_DIR)
if not os.path.exists(DOWNLOADED_DIR):
    os.makedirs(DOWNLOADED_DIR)


def artifact_path(name: str) -> pathlib.Path:
    """``versioned/<name>/<name>.jsonl`` -- the layout every `Pipeline` writes.

    Spelled once here because the scripts that read pipeline output are not
    pipelines themselves, so they cannot reach it through `Pipeline.read` and
    were each building the path by hand.
    """
    return pathlib.Path(VERSIONED_DIR) / name / f"{name}.jsonl"


def require_artifact(name: str, built_by: str, needed_for: str) -> pathlib.Path:
    """The artifact, or exit saying which pipeline builds it.

    For an input the caller cannot do without. The alternative is a
    `FileNotFoundError` naming a path, which tells a reader that something is
    missing but not that it is a pipeline output or how to get one.
    """
    path = artifact_path(name)
    if not path.is_file():
        raise SystemExit(
            f"{path} is missing, and {needed_for} needs it.\n"
            f"Build it with:  uv run koryta {built_by}"
        )
    return path


def optional_artifact(name: str, built_by: str, without_it: str) -> pathlib.Path | None:
    """The artifact if it is there, or None after saying what its absence costs.

    For an input that is an optimisation rather than a requirement. Degrading
    is correct; degrading quietly is not, because the cost lands somewhere
    else -- as a slower run, a bigger bill, or a weaker answer -- with nothing
    in the output connecting it back to a file nobody built.
    """
    path = artifact_path(name)
    if path.is_file():
        return path
    print(
        f"  [note] no {name} at {path}, so {without_it}.\n"
        f"         Build it with:  uv run koryta {built_by}",
        file=sys.stderr,
    )
    return None


class Accessor:
    path: str

    def __init__(self, path):
        self.path = path

    def get_path(self, filename):
        return os.path.join(self.path, filename)

    def assert_path(self, filename):
        p = self.get_path(filename)
        if os.path.exists(p):
            return p
        else:
            print(f"{p} is missing.")
            sys.exit(1)

    def exists(self, filename):
        return len(glob.glob(os.path.join(self.path, filename))) > 0

    def read_jsonl(self, filename):
        with open(self.assert_path(filename), "r") as f:
            for line in f:
                yield json.loads(line)

    def read_parquet(self, filename):
        return pd.read_parquet(self.assert_path(filename))


versioned = Accessor(VERSIONED_DIR)
tests = Accessor(TESTS_DIR)
downloaded = Accessor(DOWNLOADED_DIR)
