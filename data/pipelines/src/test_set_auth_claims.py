"""The claims script against an Auth and a Firestore that live in memory.

Next to the script rather than in src/tests, which CI skips
(`pytest --ignore src/tests` in .github/workflows/python.yml): this is the code
that decides who may publish without review, and its tests ran nowhere but on
the laptop of whoever remembered to run them. The seed and the table it reads
are tested in test_set_auth_claims_legacy.py.
"""

import json
from collections.abc import Sequence
from copy import deepcopy
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import firebase_admin
import pytest
from firebase_admin._user_mgt import UserRecord
from google.api_core.exceptions import AlreadyExists, PermissionDenied

import set_auth_claims
from set_auth_claims import (
    OWNERS,
    SERVER_TIMESTAMP,
    Account,
    Context,
    Level,
    Role,
    Write,
    describe_role,
    get_claims,
    get_custom_claims_dict,
    main,
    parse_args,
    render_role_changed,
    resolve_target,
    role_from_claims,
    run,
)

FRONTEND = Path(__file__).resolve().parents[3] / "frontend"

NOW = datetime(2026, 10, 5, 12, 34, 56, 789000, tzinfo=UTC)
NOW_ISO = "2026-10-05T12:34:56.789Z"

OWNER = next(iter(OWNERS))
NOMINATOR = "nominatorUid000000000000000"
SECOND_ADMIN = "secondAdminUid0000000000000"
TRIAL_NOMINATOR = "trialAdminUid00000000000000"
NOMINEE = "nomineeUid00000000000000000"
OTHER = "otherUid0000000000000000000"

ADMIN_CLAIMS = {"trusted": True, "datascience": True, "admin": True}


def account(uid: str, claims: dict | None = None, **overrides: Any) -> Account:
    values: dict[str, Any] = {
        "uid": uid,
        "display_name": f"Name of {uid[:6]}",
        "email": f"{uid[:6]}@example.com",
        "email_verified": True,
        "providers": ("google.com",),
        "created_at": datetime(2026, 9, 1, tzinfo=UTC),
        "claims": dict(claims or {}),
        "disabled": False,
    }
    values.update(overrides)
    return Account(**values)


def nomination(
    level: str,
    trial: bool = False,
    by: str = NOMINATOR,
    applied: dict | None = None,
    **extra: Any,
) -> dict:
    return {
        "desired": {
            "level": level,
            "trial": trial,
            "reason": "Robi dobrą robotę od miesiąca",
            "by": by,
            "at": "2026-10-04T10:00:00.000Z",
        },
        "applied": applied,
        "trialStartedAt": None,
        "applyError": None,
        **extra,
    }


def made_at(doc: dict, at: str) -> dict:
    """`doc` nominated at `at`, which is the order a run takes them in."""
    return {**doc, "desired": {**doc["desired"], "at": at}}


class FakeAccounts:
    def __init__(self, *accounts: Account):
        self.by_uid = {a.uid: a for a in accounts}
        self.claims_set: list[tuple[str, dict]] = []
        self.revoked: list[str] = []

    def get(self, uid: str) -> Account | None:
        return self.by_uid.get(uid)

    def all(self) -> list[Account]:
        return list(self.by_uid.values())

    def set_claims(self, uid: str, claims: dict[str, bool]) -> None:
        self.claims_set.append((uid, dict(claims)))
        self.by_uid[uid] = replace(self.by_uid[uid], claims=dict(claims))

    def revoke_refresh_tokens(self, uid: str) -> None:
        self.revoked.append(uid)


@dataclass
class FakeStore:
    docs: dict[str, dict[str, dict]] = field(default_factory=dict)
    commits: list[list[Write]] = field(default_factory=list)

    # Copies, as Firestore hands out: a test that changes a document while the
    # run is going must not change what the run has already read.
    def nominations(self) -> dict[str, dict]:
        return deepcopy(self.docs.get("roleNominations", {}))

    def nomination(self, uid: str) -> dict | None:
        return deepcopy(self.docs.get("roleNominations", {}).get(uid))

    def notification_preferences(self, uid: str) -> dict:
        user = self.docs.get("users", {}).get(uid, {})
        return dict(user.get("notifications") or {})

    def commit(self, writes: Sequence[Write]) -> bool:
        for write in writes:
            existing = self.docs.get(write.collection, {})
            if write.op == "create" and write.doc_id in existing:
                return False
        self.commits.append(list(writes))
        for n, write in enumerate(writes):
            collection = self.docs.setdefault(write.collection, {})
            doc_id = write.doc_id or f"auto{len(self.commits)}_{n}"
            if write.op in ("update", "merge"):
                collection.setdefault(doc_id, {}).update(write.data)
            else:
                collection[doc_id] = dict(write.data)
        return True

    def writes(self, collection: str) -> list[Write]:
        return [w for c in self.commits for w in c if w.collection == collection]


def context(
    accounts: FakeAccounts,
    store: FakeStore,
    answers: list[bool] | None = None,
    dry_run: bool = False,
) -> tuple[Context, list[str]]:
    prompts: list[str] = []
    pending_answers = list(answers or [])

    def confirm(prompt: str) -> bool:
        prompts.append(prompt)
        return pending_answers.pop(0) if pending_answers else False

    ctx = Context(
        accounts=accounts,
        store=store,
        confirm=confirm,
        now=lambda: NOW,
        site_url="https://koryta.pl",
        actor="script:set_auth_claims@test",
        dry_run=dry_run,
    )
    return ctx, prompts


def store_with(**nominations: dict) -> FakeStore:
    return FakeStore(docs={"roleNominations": dict(nominations)})


def people(*extra: Account) -> FakeAccounts:
    """The nominator - an established administrator - plus whoever else."""
    return FakeAccounts(account(NOMINATOR, ADMIN_CLAIMS), *extra)


# ---------------------------------------------------------------------------
# The ladder


def test_levels_accumulate():
    assert get_custom_claims_dict(Level.NORMAL) == {}
    assert get_custom_claims_dict(Level.TRUSTED) == {"trusted": True}
    assert get_custom_claims_dict(Level.ADMIN) == ADMIN_CLAIMS


def test_levels_match_the_site():
    # frontend/shared/roleClaims.json is the ladder the site reads; a level
    # that gave one claim more here than there would be a role the users page
    # cannot name.
    site = json.loads((FRONTEND / "shared" / "roleClaims.json").read_text())
    assert set(site) == {"normal", "trusted", "datascience", "admin"}
    for name, claims in site.items():
        level = set_auth_claims.level_from_name(name)
        assert level is not None
        assert get_custom_claims_dict(level) == claims


def test_trial_and_owner_only_count_with_admin():
    assert get_claims(NOMINEE, Level.ADMIN, trial=True) == {
        **ADMIN_CLAIMS,
        "newAdmin": True,
    }
    assert get_claims(NOMINEE, Level.DATASCIENCE, trial=True) == {
        "trusted": True,
        "datascience": True,
    }
    assert get_claims(OWNER, Level.ADMIN) == {**ADMIN_CLAIMS, "owner": True}
    assert "owner" not in get_claims(OWNER, Level.TRUSTED)
    assert "owner" not in get_claims(NOMINEE, Level.ADMIN)


def test_role_read_back_from_claims():
    assert role_from_claims({}) == Role(Level.NORMAL)
    assert role_from_claims({"admin": True}) == Role(Level.ADMIN)
    assert role_from_claims({**ADMIN_CLAIMS, "newAdmin": True}) == Role(
        Level.ADMIN, trial=True
    )
    # A stray `newAdmin` or `owner` without `admin` means nothing, as on the site.
    assert role_from_claims({"datascience": True, "newAdmin": True}) == Role(
        Level.DATASCIENCE
    )
    assert role_from_claims({"owner": True}) == Role(Level.NORMAL)


def test_role_labels_match_the_site():
    # The mail prints a role the way the users page does (`describeRole` in
    # frontend/shared/roles.ts); each label here has to be one there.
    roles_ts = (FRONTEND / "shared" / "roles.ts").read_text()
    for title in set_auth_claims.LEVEL_TITLES.values():
        assert f'"{title}"' in roles_ts
    assert f'"{set_auth_claims.TRIAL_CHIP}"' in roles_ts
    assert f'"{set_auth_claims.OWNER_LABEL}"' in roles_ts
    assert describe_role(Role(Level.ADMIN, trial=True)) == (
        "Administrator (okres próbny)"
    )
    assert describe_role(Role(Level.ADMIN, owner=True)) == "Właściciel serwisu"
    assert describe_role(Role(Level.NORMAL)) == "Uczestnik"


def test_collections_match_the_site():
    user_admin = (FRONTEND / "shared" / "userAdmin.ts").read_text()
    for name in (set_auth_claims.NOMINATIONS, set_auth_claims.USER_ACTIONS):
        assert f'{name}: "{name}"' in user_admin


# ---------------------------------------------------------------------------
# Applying a nomination


def test_promotion_to_a_trial_is_applied_after_yes():
    accounts = people(account(NOMINEE))
    store = store_with(**{NOMINEE: nomination("admin", trial=True)})
    ctx, prompts = context(accounts, store, answers=[True])

    assert run(parse_args([]), ctx) == 0

    assert len(prompts) == 1
    assert accounts.claims_set == [(NOMINEE, {**ADMIN_CLAIMS, "newAdmin": True})]
    # Nothing was taken away, so nobody is signed out.
    assert accounts.revoked == []

    doc = store.docs["roleNominations"][NOMINEE]
    assert doc["applied"] == {
        "level": "admin",
        "trial": True,
        "at": NOW_ISO,
        "by": "script:set_auth_claims@test",
    }
    assert doc["trialStartedAt"] == NOW_ISO
    assert doc["applyError"] is None


def test_an_applied_change_is_one_batch_with_the_hint_and_the_history():
    accounts = people(account(NOMINEE))
    store = store_with(**{NOMINEE: nomination("datascience")})
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    batch = store.commits[0]
    assert [(w.collection, w.op) for w in batch] == [
        ("roleNominations", "update"),
        ("users", "merge"),
        ("userActions", "set"),
    ]
    users = batch[1]
    assert users.doc_id == NOMINEE
    # The open tab's cue to fetch a fresh token: a server timestamp, so it can
    # be compared with the token's issue time without trusting this clock.
    assert users.data == {"claimsChangedAt": SERVER_TIMESTAMP}
    action = batch[2]
    assert action.doc_id is None
    assert action.data == {
        "kind": "apply",
        "target": NOMINEE,
        "by": "script:set_auth_claims@test",
        "at": NOW_ISO,
        "from": {"level": "normal", "trial": False, "owner": False},
        "to": {"level": "datascience", "trial": False},
    }


def test_demotion_revokes_refresh_tokens():
    accounts = people(account(NOMINEE, ADMIN_CLAIMS))
    store = store_with(**{NOMINEE: nomination("normal")})
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    assert accounts.claims_set == [(NOMINEE, {})]
    assert accounts.revoked == [NOMINEE]
    action = store.writes("userActions")[0].data
    assert action["detail"].startswith("Unieważniono sesje")


def test_losing_datascience_alone_revokes_too():
    # Not only `admin`: `datascience` opens the ingest, which publishes
    # without review, and a token that keeps it keeps that for an hour.
    accounts = people(account(NOMINEE, {"trusted": True, "datascience": True}))
    store = store_with(**{NOMINEE: nomination("trusted")})
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    assert accounts.claims_set == [(NOMINEE, {"trusted": True})]
    assert accounts.revoked == [NOMINEE]


def test_ending_a_trial_drops_new_admin_and_the_trial_start():
    accounts = people(account(NOMINEE, {**ADMIN_CLAIMS, "newAdmin": True}))
    store = store_with(
        **{NOMINEE: nomination("admin", trialStartedAt="2026-09-23T10:26:21.000Z")}
    )
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    assert accounts.claims_set == [(NOMINEE, ADMIN_CLAIMS)]
    # Ending a trial is a promotion: `newAdmin` closes pages rather than opening
    # them, and revoking would sign the graduate out of every open tab.
    assert accounts.revoked == []
    assert "detail" not in store.writes("userActions")[0].data
    assert store.docs["roleNominations"][NOMINEE]["trialStartedAt"] is None
    assert len(store.writes("mail")) == 1


def test_a_trial_administrator_demoted_is_still_signed_out():
    accounts = people(account(NOMINEE, {**ADMIN_CLAIMS, "newAdmin": True}))
    store = store_with(
        **{
            NOMINEE: nomination(
                "datascience", trialStartedAt="2026-09-23T10:26:21.000Z"
            )
        }
    )
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    assert accounts.revoked == [NOMINEE]
    # What was lost is `admin`; the trial that went with it takes nothing away.
    detail = store.writes("userActions")[0].data["detail"]
    assert detail == "Unieważniono sesje (odebrane: admin)."
    assert store.docs["roleNominations"][NOMINEE]["trialStartedAt"] is None


def test_lost_claims_leaves_out_new_admin():
    on_trial = {**ADMIN_CLAIMS, "newAdmin": True}
    assert set_auth_claims.lost_claims(on_trial, ADMIN_CLAIMS) == []
    assert set_auth_claims.lost_claims(on_trial, {"trusted": True}) == [
        "admin",
        "datascience",
    ]
    # Back on trial: what that closes is read from the account, not the token.
    assert set_auth_claims.lost_claims(ADMIN_CLAIMS, on_trial) == []
    assert set_auth_claims.lost_claims({**ADMIN_CLAIMS, "owner": True}, {}) == [
        "admin",
        "datascience",
        "owner",
        "trusted",
    ]


def test_a_change_that_keeps_the_trial_keeps_its_start():
    accounts = people(account(NOMINEE, {**ADMIN_CLAIMS, "newAdmin": True, "x": 1}))
    store = store_with(
        **{
            NOMINEE: nomination(
                "admin", trial=True, trialStartedAt="2026-09-23T10:26:21.000Z"
            )
        }
    )
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    update = store.writes("roleNominations")[0].data
    assert "trialStartedAt" not in update
    assert (
        store.docs["roleNominations"][NOMINEE]["trialStartedAt"]
        == "2026-09-23T10:26:21.000Z"
    )


def test_the_owner_keeps_the_owner_claim():
    accounts = people(account(OWNER, {"admin": True, "datascience": True}))
    store = store_with(**{OWNER: nomination("admin")})
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    assert accounts.claims_set == [(OWNER, {**ADMIN_CLAIMS, "owner": True})]


@pytest.mark.parametrize(
    "level, trial",
    [("datascience", False), ("normal", False), ("admin", True)],
)
def test_the_owner_cannot_be_demoted(level, trial):
    accounts = people(account(OWNER, {**ADMIN_CLAIMS, "owner": True}))
    store = store_with(**{OWNER: nomination(level, trial=trial)})
    ctx, prompts = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    assert prompts == []
    assert accounts.claims_set == []
    error = store.docs["roleNominations"][OWNER]["applyError"]
    assert error["at"] == NOW_ISO
    assert "Właściciel" in error["message"]


@pytest.mark.parametrize("level", ["datascience", "admin"])
def test_an_unverified_address_is_refused_publishing_levels(level):
    accounts = people(account(NOMINEE, email_verified=False))
    store = store_with(**{NOMINEE: nomination(level)})
    ctx, prompts = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    assert prompts == []
    assert accounts.claims_set == []
    message = store.docs["roleNominations"][NOMINEE]["applyError"]["message"]
    assert "nie jest potwierdzony" in message


def test_an_unverified_address_may_still_be_trusted_or_demoted():
    accounts = people(
        account(NOMINEE, email_verified=False),
        account(OTHER, ADMIN_CLAIMS, email_verified=False),
    )
    store = store_with(
        **{NOMINEE: nomination("trusted"), OTHER: nomination("datascience")}
    )
    ctx, _ = context(accounts, store, answers=[True, True])

    run(parse_args([]), ctx)

    assert dict(accounts.claims_set) == {
        NOMINEE: {"trusted": True},
        OTHER: {"trusted": True, "datascience": True},
    }


@pytest.mark.parametrize(
    "uid", ["pipeline-people-import", "migration:merge-duplicate-people"]
)
def test_a_robot_is_refused(uid):
    accounts = people(account(uid))
    store = store_with(**{uid: nomination("trusted")})
    ctx, prompts = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    assert prompts == []
    assert accounts.claims_set == []
    assert "automat" in store.docs["roleNominations"][uid]["applyError"]["message"]


def test_a_self_nomination_is_refused():
    # The server refuses it first; a document that says so anyway is not
    # applied because it is in the collection.
    accounts = people(account(NOMINEE, ADMIN_CLAIMS))
    store = store_with(**{NOMINATOR: nomination("admin", trial=True)})
    ctx, prompts = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    assert prompts == []
    assert accounts.claims_set == []
    message = store.docs["roleNominations"][NOMINATOR]["applyError"]["message"]
    assert message == set_auth_claims.SELF_REFUSED


def test_a_change_auth_refuses_is_recorded_and_the_run_goes_on():
    class Refusing(FakeAccounts):
        def set_claims(self, uid: str, claims: dict[str, bool]) -> None:
            if uid == NOMINEE:
                raise ValueError("claims too large")
            super().set_claims(uid, claims)

    accounts = Refusing(
        account(NOMINATOR, ADMIN_CLAIMS), account(NOMINEE), account(OTHER)
    )
    store = store_with(**{NOMINEE: nomination("trusted"), OTHER: nomination("trusted")})
    ctx, _ = context(accounts, store, answers=[True, True])

    assert run(parse_args([]), ctx) == 0

    error = store.docs["roleNominations"][NOMINEE]["applyError"]
    assert "claims too large" in error["message"]
    assert store.docs["roleNominations"][NOMINEE]["applied"] is None
    assert all(w.doc_id != NOMINEE for w in store.writes("users"))
    assert accounts.claims_set == [(OTHER, {"trusted": True})]


def test_a_failed_revoke_still_records_the_change_and_says_so(capsys):
    class NoRevoke(FakeAccounts):
        def revoke_refresh_tokens(self, uid: str) -> None:
            raise RuntimeError("quota")

    accounts = NoRevoke(
        account(NOMINATOR, ADMIN_CLAIMS), account(NOMINEE, ADMIN_CLAIMS)
    )
    store = store_with(**{NOMINEE: nomination("normal")})
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    # A later run finds the account matching and only stamps it, so this is
    # the one chance to say the sessions are still alive.
    assert store.docs["roleNominations"][NOMINEE]["applied"]["level"] == "normal"
    action = store.writes("userActions")[0].data
    assert "NIE" in action["detail"]
    assert "quota" in capsys.readouterr().out


def test_a_gone_account_is_recorded_and_the_run_goes_on():
    accounts = people(account(NOMINEE))
    store = store_with(
        **{
            # Sorted first by the time of the nomination.
            "deletedUid": {
                **nomination("admin"),
                "desired": {**nomination("admin")["desired"], "at": "2026-01-01"},
            },
            NOMINEE: nomination("trusted"),
        }
    )
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    error = store.docs["roleNominations"]["deletedUid"]["applyError"]
    assert error == {"at": NOW_ISO, "message": set_auth_claims.ACCOUNT_GONE}
    assert accounts.claims_set == [(NOMINEE, {"trusted": True})]


def test_an_equal_state_only_stamps_the_receipt():
    accounts = people(account(NOMINEE, ADMIN_CLAIMS))
    store = store_with(**{NOMINEE: nomination("admin")})
    ctx, prompts = context(accounts, store)

    run(parse_args([]), ctx)

    assert prompts == []
    assert accounts.claims_set == []
    assert store.commits == [
        [
            Write(
                "update",
                "roleNominations",
                NOMINEE,
                {
                    "applied": {
                        "level": "admin",
                        "trial": False,
                        "at": NOW_ISO,
                        "by": "script:set_auth_claims@test",
                    },
                    "applyError": None,
                },
            )
        ]
    ]


def test_an_equal_state_with_a_current_receipt_writes_nothing():
    applied = {"level": "admin", "trial": False, "at": "x", "by": "y"}
    accounts = people(account(NOMINEE, ADMIN_CLAIMS))
    store = store_with(**{NOMINEE: nomination("admin", applied=applied)})
    ctx, prompts = context(accounts, store)

    run(parse_args([]), ctx)

    assert prompts == []
    assert store.commits == []


ON_TRIAL = {**ADMIN_CLAIMS, "newAdmin": True}
TRIAL_APPLIED = {"level": "admin", "trial": True, "at": "x", "by": "y"}


@pytest.mark.parametrize("applied", [None, TRIAL_APPLIED])
def test_a_stamp_dates_a_trial_nobody_dated(applied, capsys):
    # A trial granted by a run whose batch failed after the claims were set,
    # or by hand in the console. Without a start the users page counts no
    # days, never lists it as due and shows no trial stats - and a receipt
    # that is otherwise current must not hide that.
    accounts = people(account(NOMINEE, ON_TRIAL))
    store = store_with(**{NOMINEE: nomination("admin", trial=True, applied=applied)})
    ctx, prompts = context(accounts, store)

    run(parse_args([]), ctx)

    assert prompts == []
    [write] = store.writes("roleNominations")
    assert write.data["trialStartedAt"] == NOW_ISO
    assert write.data["applied"]["trial"] is True
    # The date is the stamp's, later than the trial's real start; it says so.
    out = capsys.readouterr().out
    assert f"dating it {NOW_ISO}" in out
    assert "began earlier" in out


def test_a_stamp_keeps_a_dated_trial_as_it_is():
    accounts = people(account(NOMINEE, ON_TRIAL))
    store = store_with(
        **{NOMINEE: nomination("admin", trial=True, trialStartedAt="2026-09-23")}
    )
    ctx, _ = context(accounts, store)

    run(parse_args([]), ctx)

    [write] = store.writes("roleNominations")
    assert "trialStartedAt" not in write.data
    assert store.docs["roleNominations"][NOMINEE]["trialStartedAt"] == "2026-09-23"


def test_a_stamp_clears_the_start_of_a_trial_ended_by_hand():
    applied = {"level": "admin", "trial": False, "at": "x", "by": "y"}
    accounts = people(account(NOMINEE, ADMIN_CLAIMS))
    store = store_with(
        **{
            NOMINEE: nomination(
                "admin", applied=applied, trialStartedAt="2026-09-23T10:26:21.000Z"
            )
        }
    )
    ctx, _ = context(accounts, store)

    run(parse_args([]), ctx)

    assert store.docs["roleNominations"][NOMINEE]["trialStartedAt"] is None


def test_a_trial_whose_record_failed_is_dated_by_the_next_run():
    # The recovery the module promises: the claims are set, the batch after
    # them fails, and the next run puts the receipt and the date right.
    class FailsOnce(FakeStore):
        failed = False

        def commit(self, writes: Sequence[Write]) -> bool:
            if not self.failed and writes[0].collection == "roleNominations":
                self.failed = True
                raise RuntimeError("deadline exceeded")
            return super().commit(writes)

    accounts = people(account(NOMINEE, ADMIN_CLAIMS))
    store = FailsOnce(
        docs={"roleNominations": {NOMINEE: nomination("admin", trial=True)}}
    )
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)
    assert accounts.claims_set == [(NOMINEE, ON_TRIAL)]
    assert store.docs["roleNominations"][NOMINEE]["trialStartedAt"] is None

    run(parse_args([]), ctx)
    doc = store.docs["roleNominations"][NOMINEE]
    assert doc["applied"]["trial"] is True
    assert doc["trialStartedAt"] == NOW_ISO
    assert accounts.claims_set == [(NOMINEE, ON_TRIAL)]  # not set twice


def test_dry_run_counts_an_undated_trial_as_work():
    accounts = people(account(NOMINEE, ON_TRIAL))
    store = store_with(
        **{NOMINEE: nomination("admin", trial=True, applied=TRIAL_APPLIED)}
    )
    ctx, _ = context(accounts, store, dry_run=True)

    assert run(parse_args(["--dry-run"]), ctx) == 1
    assert store.commits == []


def test_no_changes_anything_on_the_account():
    accounts = people(account(NOMINEE))
    store = store_with(**{NOMINEE: nomination("admin")})
    ctx, prompts = context(accounts, store, answers=[False])

    run(parse_args([]), ctx)

    assert len(prompts) == 1
    assert accounts.claims_set == []
    assert store.commits == []


def test_the_facts_are_printed_before_the_question(capsys):
    accounts = people(account(NOMINEE, providers=("password",)))
    store = store_with(**{NOMINEE: nomination("trusted")})
    ctx, _ = context(accounts, store)

    run(parse_args([]), ctx)

    out = capsys.readouterr().out
    assert NOMINEE in out
    assert "Name of nomine" in out
    assert "set by the user" in out
    assert "password" in out
    assert "Name of nomina" in out  # the nominator
    assert "established administrator" in out
    assert "Robi dobrą robotę od miesiąca" in out
    assert "Uczestnik -> Zaufany uczestnik" in out
    assert "+ trusted" in out
    assert "WARNING" not in out


def test_a_nominator_on_trial_gets_a_loud_warning(capsys):
    accounts = people(
        account(TRIAL_NOMINATOR, {**ADMIN_CLAIMS, "newAdmin": True}),
        account(NOMINEE),
    )
    store = store_with(**{NOMINEE: nomination("trusted", by=TRIAL_NOMINATOR)})
    ctx, _ = context(accounts, store)

    run(parse_args([]), ctx)

    assert "WARNING" in capsys.readouterr().out


def test_a_nomination_without_a_nominator_is_warned_about(capsys):
    # A document edited by hand, with no `desired.by`: the account behind ""
    # is nobody, which is what the warning is for.
    accounts = people(account(NOMINEE), account(OTHER))
    no_by = nomination("trusted")
    del no_by["desired"]["by"]
    store = store_with(
        **{
            NOMINEE: made_at(no_by, "2026-10-04T09:00:00.000Z"),
            OTHER: nomination("trusted"),
        }
    )
    ctx, prompts = context(accounts, store, answers=[False, True])

    run(parse_args([]), ctx)

    out = capsys.readouterr().out
    assert "(no such account)" in out
    assert "WARNING" in out
    assert len(prompts) == 2
    assert accounts.claims_set == [(OTHER, {"trusted": True})]


def test_a_nominator_demoted_earlier_in_the_run_reads_as_demoted(capsys):
    # Approving a nominator's own demotion and then being shown their next
    # nomination as an established administrator's is what the warning is
    # there to prevent.
    accounts = FakeAccounts(
        account(NOMINATOR, ADMIN_CLAIMS),
        account(SECOND_ADMIN, ADMIN_CLAIMS),
        account(NOMINEE),
        account(OTHER),
    )
    store = store_with(
        **{
            NOMINEE: made_at(nomination("trusted"), "2026-10-04T10:00:00.000Z"),
            NOMINATOR: made_at(
                nomination("normal", by=SECOND_ADMIN), "2026-10-04T11:00:00.000Z"
            ),
            OTHER: made_at(nomination("admin"), "2026-10-04T12:00:00.000Z"),
        }
    )
    ctx, _ = context(accounts, store, answers=[True, True, False])

    run(parse_args([]), ctx)

    assert accounts.claims_set[1] == (NOMINATOR, {})
    before, after = capsys.readouterr().out.split(f"Account    {OTHER}")
    assert "WARNING" not in before
    assert "Uczestnik now" in after
    assert "WARNING" in after


def test_a_nomination_withdrawn_while_the_owner_decides_is_not_applied(capsys):
    # The y answers the facts printed above it. An administrator who
    # withdraws the nomination meanwhile - having found the nominee is a
    # troll, say - must not have the printed one applied over their head.
    accounts = people(account(NOMINEE))
    store = store_with(**{NOMINEE: nomination("datascience")})
    ctx, _ = context(accounts, store)

    def withdrawn_then_yes(prompt: str) -> bool:
        store.docs["roleNominations"][NOMINEE]["desired"] = {
            "level": "normal",
            "trial": False,
            "reason": "Wycofane",
            "by": SECOND_ADMIN,
            "at": "2026-10-05T12:00:00.000Z",
        }
        return True

    ctx.confirm = withdrawn_then_yes

    assert run(parse_args([]), ctx) == 0

    assert accounts.claims_set == []
    assert accounts.revoked == []
    # Nothing written at all: the new wish is simply pending, not failed.
    assert store.commits == []
    doc = store.docs["roleNominations"][NOMINEE]
    assert doc["applied"] is None
    assert doc["applyError"] is None
    out = capsys.readouterr().out
    assert "changed while you were deciding" in out
    assert "Uczestnik" in out.split("changed while you were deciding")[1]
    assert "1 changed" in out


def test_a_nomination_gone_while_the_owner_decides_is_not_applied(capsys):
    accounts = people(account(NOMINEE))
    store = store_with(**{NOMINEE: nomination("trusted")})
    ctx, _ = context(accounts, store)

    def deleted_then_yes(prompt: str) -> bool:
        del store.docs["roleNominations"][NOMINEE]
        return True

    ctx.confirm = deleted_then_yes

    run(parse_args([]), ctx)

    assert accounts.claims_set == []
    assert "changed while you were deciding" in capsys.readouterr().out


def test_a_nomination_with_only_a_new_reason_is_not_applied_either():
    # A new reason is a new nomination, by whoever wrote it: the owner said y
    # to the one with the old reason and the old nominator.
    accounts = people(account(NOMINEE))
    store = store_with(**{NOMINEE: nomination("trusted")})
    ctx, _ = context(accounts, store)

    def renominated_then_yes(prompt: str) -> bool:
        desired = store.docs["roleNominations"][NOMINEE]["desired"]
        store.docs["roleNominations"][NOMINEE]["desired"] = {
            **desired,
            "by": SECOND_ADMIN,
            "reason": "Inny powód",
            "at": "2026-10-05T12:00:00.000Z",
        }
        return True

    ctx.confirm = renominated_then_yes

    run(parse_args([]), ctx)

    assert accounts.claims_set == []


def test_a_nomination_changed_before_its_turn_is_shown_as_it_is_now(capsys):
    # The run reads the list once, then takes minutes of y/N. A nomination
    # changed during an earlier question is asked about as it is now, not as
    # it was when the run began.
    accounts = people(account(NOMINEE), account(OTHER))
    store = store_with(
        **{
            OTHER: made_at(nomination("trusted"), "2026-10-04T09:00:00.000Z"),
            NOMINEE: nomination("datascience"),
        }
    )
    ctx, _ = context(accounts, store)
    answers = iter([True, True])

    def renominate_during_the_first(prompt: str) -> bool:
        desired = store.docs["roleNominations"][NOMINEE]["desired"]
        store.docs["roleNominations"][NOMINEE]["desired"] = {
            **desired,
            "level": "trusted",
            "reason": "Na razie tylko zaufany",
        }
        return next(answers)

    ctx.confirm = renominate_during_the_first

    run(parse_args([]), ctx)

    assert accounts.claims_set == [
        (OTHER, {"trusted": True}),
        (NOMINEE, {"trusted": True}),
    ]
    assert store.docs["roleNominations"][NOMINEE]["applied"]["level"] == "trusted"
    assert "Na razie tylko zaufany" in capsys.readouterr().out


def test_claim_holders_without_a_document_are_listed_and_left_alone(capsys):
    accounts = people(account(OTHER, {"trusted": True}))
    store = store_with()
    ctx, _ = context(accounts, store)

    assert run(parse_args([]), ctx) == 0

    out = capsys.readouterr().out
    assert "no nomination document" in out
    assert OTHER in out
    assert NOMINATOR in out
    assert accounts.claims_set == []
    assert store.commits == []


# ---------------------------------------------------------------------------
# --dry-run and --report


def test_dry_run_writes_nothing_and_says_there_is_work():
    accounts = people(
        account(NOMINEE),
        account(OTHER, ADMIN_CLAIMS),
        account("pipeline-x"),
    )
    store = store_with(
        **{
            NOMINEE: nomination("admin"),  # a change
            OTHER: nomination("admin"),  # a receipt to stamp
            "pipeline-x": nomination("trusted"),  # a refusal
            "goneUid": nomination("trusted"),  # a refusal
        }
    )
    ctx, prompts = context(accounts, store, answers=[True], dry_run=True)

    assert run(parse_args(["--dry-run"]), ctx) == 1

    assert prompts == []
    assert accounts.claims_set == []
    assert accounts.revoked == []
    assert store.commits == []


def test_dry_run_with_nothing_to_do_exits_zero():
    applied = {"level": "admin", "trial": False, "at": "x", "by": "y"}
    accounts = people(account(NOMINEE, ADMIN_CLAIMS))
    store = store_with(**{NOMINEE: nomination("admin", applied=applied)})
    ctx, _ = context(accounts, store, dry_run=True)

    assert run(parse_args(["--dry-run"]), ctx) == 0


def test_report_lists_holders_gone_accounts_and_robots(capsys):
    accounts = people(
        account(OTHER, {"datascience": True, "trusted": True}),
        account("pipeline-people-import"),
        account(NOMINEE),
    )
    store = store_with(
        **{NOMINEE: nomination("trusted"), "goneUid": nomination("admin")}
    )
    ctx, prompts = context(accounts, store, answers=[True])

    assert run(parse_args(["--report"]), ctx) == 0

    out = capsys.readouterr().out
    holders, rest = out.split("whose account is gone")
    assert OTHER in holders and NOMINATOR in holders
    assert NOMINEE not in holders
    gone, robots = rest.split("Robots")
    assert "goneUid" in gone
    assert "pipeline-people-import" in robots
    # A report acts on nothing.
    assert prompts == []
    assert accounts.claims_set == []
    assert store.commits == []


# ---------------------------------------------------------------------------
# The mail


def test_the_role_changed_copy():
    message = render_role_changed("Administrator (okres próbny)", "https://koryta.pl")
    assert message["subject"] == "Zmiana Twoich uprawnień na koryta.pl"
    assert message["text"] == (
        "Dzień dobry,\n"
        "\n"
        "Twoje uprawnienia na koryta.pl się zmieniły. "
        "Teraz: Administrator (okres próbny).\n"
        "\n"
        "Jeśli masz otwartą stronę, odświeży uprawnienia sama w ciągu kilku sekund. "
        "Jeśli menu się nie zmieni, wyloguj się i zaloguj ponownie.\n"
        "\n"
        "Ustawienia powiadomień: https://koryta.pl/profil"
    )
    assert message["html"] == (
        "<p>Dzień dobry,</p>\n"
        "<p>Twoje uprawnienia na koryta.pl się zmieniły. "
        "Teraz: Administrator (okres próbny).</p>\n"
        "<p>Jeśli masz otwartą stronę, odświeży uprawnienia sama w ciągu kilku sekund. "
        "Jeśli menu się nie zmieni, wyloguj się i zaloguj ponownie.</p>\n"
        '<p>Ustawienia powiadomień: <a href="https://koryta.pl/profil">'
        "https://koryta.pl/profil</a></p>"
    )


def test_role_changed_is_a_kind_the_site_knows():
    # The switch on /profil that turns this mail off is rendered from
    # frontend/shared/notifications.ts, which names the kind and the copy.
    notifications = (FRONTEND / "shared" / "notifications.ts").read_text()
    # Fails until the kind is added there: another change of the same series.
    assert "roleChanged" in notifications, "no roleChanged in notifications.ts"
    assert set_auth_claims.ROLE_CHANGED_SUBJECT in notifications


def test_an_applied_change_mails_a_verified_address():
    accounts = people(account(NOMINEE))
    store = store_with(**{NOMINEE: nomination("admin", trial=True)})
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    [mail] = store.writes("mail")
    assert mail.op == "create"
    assert mail.doc_id == f"roleChanged_{NOMINEE}_20261005T123456789Z"
    assert mail.data == {
        "to": ["nomine@example.com"],
        "message": render_role_changed(
            "Administrator (okres próbny)", "https://koryta.pl"
        ),
        "kind": "roleChanged",
        "uid": NOMINEE,
        "created_at": NOW,
    }


def test_no_mail_to_an_unverified_address():
    accounts = people(account(NOMINEE, ADMIN_CLAIMS, email_verified=False))
    store = store_with(**{NOMINEE: nomination("trusted")})
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    assert accounts.claims_set  # applied all the same
    assert store.writes("mail") == []


def test_no_mail_to_somebody_who_opted_out():
    accounts = people(account(NOMINEE))
    store = store_with(**{NOMINEE: nomination("trusted")})
    store.docs["users"] = {NOMINEE: {"notifications": {"roleChanged": False}}}
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    assert accounts.claims_set
    assert store.writes("mail") == []


def test_mail_goes_out_when_other_kinds_are_off():
    accounts = people(account(NOMINEE))
    store = store_with(**{NOMINEE: nomination("trusted")})
    store.docs["users"] = {NOMINEE: {"notifications": {"revisionApproved": False}}}
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    assert len(store.writes("mail")) == 1


def test_a_mail_already_queued_is_not_written_twice():
    accounts = people(account(NOMINEE))
    store = store_with(**{NOMINEE: nomination("trusted")})
    store.docs["mail"] = {f"roleChanged_{NOMINEE}_20261005T123456789Z": {}}
    ctx, _ = context(accounts, store, answers=[True])

    assert run(parse_args([]), ctx) == 0
    assert store.writes("mail") == []


# ---------------------------------------------------------------------------
# The real Auth and Firestore, as far as they can be read without a server


def test_an_auth_record_reads_as_an_account():
    record = UserRecord(
        {
            "localId": NOMINEE,
            "email": "a@example.com",
            "emailVerified": True,
            "displayName": "Anna",
            "providerUserInfo": [{"providerId": "google.com", "rawId": "1"}],
            "createdAt": "1756684800000",
            "customAttributes": json.dumps({"trusted": True}),
        }
    )
    assert set_auth_claims.account_from_record(record) == Account(
        uid=NOMINEE,
        display_name="Anna",
        email="a@example.com",
        email_verified=True,
        providers=("google.com",),
        created_at=datetime(2025, 9, 1, tzinfo=UTC),
        claims={"trusted": True},
        disabled=False,
    )


@pytest.fixture
def auth_app(monkeypatch):
    """A firebase_admin app that never reaches a server: the emulator host
    spares it credentials, and nothing listens there."""
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:1")
    app = firebase_admin.initialize_app(
        options={"projectId": "demo-koryta-pl"}, name="test_set_auth_claims"
    )
    yield app
    firebase_admin.delete_app(app)


@pytest.mark.parametrize("uid", ["", "x" * 129])
def test_an_invalid_uid_is_no_account(auth_app, uid):
    # firebase_admin checks the uid before asking and raises ValueError, not
    # UserNotFoundError. A nomination with no `desired.by` asks for "", and
    # must not end the run for every nomination after it.
    assert set_auth_claims.FirebaseAccounts(auth_app).get(uid) is None


def test_a_value_error_about_anything_but_the_uid_is_raised(auth_app, monkeypatch):
    # A valid uid that raises is a broken app - a missing project id - which
    # would otherwise read every account as gone and refuse every nomination.
    def get_user(uid, app):
        raise ValueError("A project ID is required to access the auth service.")

    monkeypatch.setattr(set_auth_claims.auth, "get_user", get_user)
    with pytest.raises(ValueError, match="project ID"):
        set_auth_claims.FirebaseAccounts(auth_app).get(NOMINEE)


def test_one_nomination_is_read_by_its_id():
    class Snapshot:
        def __init__(self, data: dict | None):
            self.data = data
            self.exists = data is not None

        def get(self) -> "Snapshot":  # the reference, read: itself
            return self

        def to_dict(self) -> dict | None:
            return self.data

    class Client:
        docs: dict[str, dict] = {NOMINEE: {"desired": {"level": "admin"}}, OTHER: {}}

        def collection(self, name: str) -> "Client":
            assert name == "roleNominations"
            return self

        def document(self, doc_id: str) -> Snapshot:
            return Snapshot(self.docs.get(doc_id))

    store = set_auth_claims.FirestoreStore(Client())

    assert store.nomination(NOMINEE) == {"desired": {"level": "admin"}}
    assert store.nomination(OTHER) == {}
    assert store.nomination("goneUid") is None


class RecordingClient:
    """Just enough of `firestore.Client` to see what a batch is made of."""

    def __init__(self, fail_with: Exception | None = None):
        self.calls: list[tuple] = []
        self.fail_with = fail_with

    def collection(self, name: str) -> "RecordingClient.Collection":
        return RecordingClient.Collection(name)

    def batch(self) -> "RecordingClient":
        return self

    def create(self, ref, data):
        self.calls.append(("create", ref, data))

    def update(self, ref, data):
        self.calls.append(("update", ref, data))

    def set(self, ref, data, merge=False):
        self.calls.append(("set", ref, data, merge))

    def commit(self):
        if self.fail_with:
            raise self.fail_with

    @dataclass
    class Collection:
        name: str

        def document(self, doc_id: str | None = None) -> str:
            return f"{self.name}/{doc_id or '<auto>'}"


def test_writes_become_one_batch():
    client = RecordingClient()
    store = set_auth_claims.FirestoreStore(client)

    assert store.commit(
        [
            Write("update", "roleNominations", "u", {"a": 1}),
            Write("merge", "users", "u", {"b": 2}),
            Write("set", "userActions", None, {"c": 3}),
            Write("create", "mail", "m", {"d": 4}),
        ]
    )
    assert client.calls == [
        ("update", "roleNominations/u", {"a": 1}),
        ("set", "users/u", {"b": 2}, True),
        ("set", "userActions/<auto>", {"c": 3}, False),
        ("create", "mail/m", {"d": 4}),
    ]


def test_a_create_that_finds_its_document_is_false_not_an_error():
    store = set_auth_claims.FirestoreStore(RecordingClient(AlreadyExists("exists")))
    assert store.commit([Write("create", "mail", "m", {})]) is False

    store = set_auth_claims.FirestoreStore(RecordingClient(PermissionDenied("no")))
    with pytest.raises(PermissionDenied):
        store.commit([Write("create", "mail", "m", {})])


# ---------------------------------------------------------------------------
# Where it runs


EMULATOR_HOSTS = ("FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST")


def clear_emulators(monkeypatch):
    for name in (*EMULATOR_HOSTS, "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"):
        monkeypatch.delenv(name, raising=False)


def test_production_by_default(monkeypatch):
    clear_emulators(monkeypatch)
    target = resolve_target(yes=False)
    assert target.project == "koryta-pl"
    assert not target.emulator
    assert target.site_url == "https://koryta.pl"


def test_the_emulators_by_their_project(monkeypatch):
    clear_emulators(monkeypatch)
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")
    target = resolve_target(yes=True)
    assert target.project == "demo-koryta-pl"
    assert target.emulator
    assert target.site_url == "http://localhost:3000"


@pytest.mark.parametrize("host", EMULATOR_HOSTS)
def test_one_emulator_without_the_other_is_refused(monkeypatch, host):
    # Claims written to production from what the emulator's Firestore says,
    # or the other way round, is the one mix with no use at all.
    clear_emulators(monkeypatch)
    monkeypatch.setenv(host, "127.0.0.1:1")
    with pytest.raises(set_auth_claims.UsageError):
        resolve_target(yes=False)


def test_yes_is_refused_outside_the_emulators(monkeypatch, capsys):
    clear_emulators(monkeypatch)

    def connect(target):
        raise AssertionError("must not connect")

    monkeypatch.setattr(set_auth_claims, "connect", connect)

    assert main(["--yes"]) == 2
    assert "--yes" in capsys.readouterr().err


def test_report_and_seed_are_separate_runs():
    with pytest.raises(SystemExit):
        parse_args(["--report", "--seed"])
