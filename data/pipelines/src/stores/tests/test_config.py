"""That the PESEL key is found, and never invented by accident.

The first key lived in `data/pipelines/.env`, which is per-worktree. The
workspace holding it was deleted, and with it the only thing that could
reproduce the fingerprints of 6,188 already-published people. So two
properties matter here: the key is looked for outside any checkout, and a run
that cannot find one stops instead of minting a replacement that would produce
fingerprints indistinguishable from the lost ones.
"""

import os
import stat

import pytest

from stores import config


@pytest.fixture
def key_file(tmp_path, monkeypatch):
    monkeypatch.delenv("KORYTA_PESEL_SALT", raising=False)
    monkeypatch.setattr(config, "load_dotenv", lambda *a, **k: None)
    path = tmp_path / "koryta" / "pesel-salt"
    monkeypatch.setattr(config, "PESEL_SALT_FILE", str(path))
    return path


def test_no_key_and_no_permission_to_make_one_reads_as_absent(key_file):
    assert config.pesel_salt() is None
    assert not key_file.exists()


def test_the_file_is_read_and_stripped(key_file):
    key_file.parent.mkdir(parents=True)
    key_file.write_text("  abc123  \n", encoding="utf-8")
    assert config.pesel_salt() == "abc123"


def test_an_empty_file_is_not_a_key(key_file):
    key_file.parent.mkdir(parents=True)
    key_file.write_text("\n", encoding="utf-8")
    assert config.pesel_salt() is None


def test_the_environment_wins_over_the_file(key_file, monkeypatch):
    key_file.parent.mkdir(parents=True)
    key_file.write_text("from-file\n", encoding="utf-8")
    monkeypatch.setenv("KORYTA_PESEL_SALT", "from-env")
    assert config.pesel_salt() == "from-env"


def test_creating_one_is_opt_in_and_the_file_is_private(key_file):
    salt = config.pesel_salt(create=True)
    assert salt and len(salt) == 64
    assert key_file.read_text(encoding="utf-8").strip() == salt
    mode = stat.S_IMODE(os.stat(key_file).st_mode)
    assert mode == 0o600, f"key is readable by somebody else: {oct(mode)}"
    assert stat.S_IMODE(os.stat(key_file.parent).st_mode) == 0o700


def test_a_second_create_does_not_replace_an_existing_key(key_file):
    """`create=True` must be idempotent, or a rerun renumbers everybody."""
    first = config.pesel_salt(create=True)
    assert config.pesel_salt(create=True) == first


def test_the_default_location_is_outside_every_checkout():
    """The whole point: a worktree teardown must not take the key with it."""
    assert "worktree" not in config.PESEL_SALT_FILE
    assert not config.PESEL_SALT_FILE.startswith(config.PROJECT_ROOT)
    assert config.PESEL_SALT_FILE.endswith(os.path.join("koryta", "pesel-salt"))
