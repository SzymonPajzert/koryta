import set_auth_claims
from set_auth_claims import Level, get_claims, get_custom_claims_dict


def test_levels_accumulate():
    assert get_custom_claims_dict(Level.NORMAL) == {}
    assert get_custom_claims_dict(Level.ADMIN) == {
        "trusted": True,
        "datascience": True,
        "admin": True,
    }


def test_new_admin_is_marked(monkeypatch):
    monkeypatch.setattr(set_auth_claims, "NEW_ADMINS", {"trial"})
    assert get_claims("trial", Level.ADMIN) == {
        "trusted": True,
        "datascience": True,
        "admin": True,
        "newAdmin": True,
    }
    assert "newAdmin" not in get_claims("established", Level.ADMIN)


def test_new_admin_flag_needs_admin(monkeypatch, capsys):
    # Demoting a trial admin to NORMAL must yield no claims at all, not a stray
    # `newAdmin` with nothing to qualify.
    monkeypatch.setattr(set_auth_claims, "NEW_ADMINS", {"trial"})
    assert get_claims("trial", Level.NORMAL) == {}
    assert "Warning" in capsys.readouterr().out


def test_owner_is_marked_only_as_admin(monkeypatch, capsys):
    monkeypatch.setattr(set_auth_claims, "OWNERS", {"boss"})
    assert get_claims("boss", Level.ADMIN)["owner"] is True
    assert "owner" not in get_claims("other", Level.ADMIN)
    # An owner demoted below admin keeps no `owner` to open the task list with.
    assert "owner" not in get_claims("boss", Level.TRUSTED)
    assert "Warning" in capsys.readouterr().out


def test_the_owner_is_an_admin():
    assert set_auth_claims.OWNERS <= {
        uid
        for uid, level in set_auth_claims.ROLE_LEVELS.items()
        if level == Level.ADMIN
    }
