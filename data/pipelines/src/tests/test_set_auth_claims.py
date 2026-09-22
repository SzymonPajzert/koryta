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
