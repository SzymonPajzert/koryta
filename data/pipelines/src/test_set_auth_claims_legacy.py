"""`set_auth_claims --seed`: the one run that moves the claims accounts already
hold into `roleNominations`, and the table it checks them against.

Delete together with set_auth_claims_legacy.py.
"""

from set_auth_claims import OWNERS, Level, Write, parse_args, run
from set_auth_claims_legacy import (
    MIGRATION,
    NEW_ADMINS,
    ROLE_LEVELS,
    TRIAL_STARTED_AT,
)
from test_set_auth_claims import (
    ADMIN_CLAIMS,
    NOMINATOR,
    NOMINEE,
    NOW_ISO,
    OTHER,
    FakeStore,
    account,
    context,
    nomination,
    people,
    store_with,
)

LEGACY_TRIAL = "8DomV5BlwlgPI9iLSDA2wHk168h1"


def test_every_trial_in_the_table_has_a_start_and_nothing_else_does():
    # No uid is added anywhere by this change: the dates are for exactly the
    # administrators on trial when the table stopped being the source.
    assert set(TRIAL_STARTED_AT) == NEW_ADMINS
    assert NEW_ADMINS <= {u for u, level in ROLE_LEVELS.items() if level == Level.ADMIN}
    assert TRIAL_STARTED_AT[LEGACY_TRIAL] == "2026-09-23T10:26:21.000Z"
    assert all(at.endswith("Z") for at in TRIAL_STARTED_AT.values())


def test_the_owner_is_an_admin_in_the_table():
    assert OWNERS <= {u for u, level in ROLE_LEVELS.items() if level == Level.ADMIN}


def test_seed_writes_the_live_state_of_every_claim_holder():
    accounts = people(
        account(NOMINEE, {"trusted": True, "datascience": True}),
        account(OTHER),  # nothing to move
    )
    store = FakeStore()
    ctx, prompts = context(accounts, store, answers=[True])

    assert run(parse_args(["--seed"]), ctx) == 0

    assert len(prompts) == 1  # once for the lot
    seeded = store.docs["roleNominations"]
    assert set(seeded) == {NOMINATOR, NOMINEE}
    assert seeded[NOMINEE] == {
        "desired": {
            "level": "datascience",
            "trial": False,
            "reason": seeded[NOMINEE]["desired"]["reason"],
            "by": "migration:set_auth_claims",
            "at": NOW_ISO,
        },
        "applied": {
            "level": "datascience",
            "trial": False,
            "at": NOW_ISO,
            "by": "migration:set_auth_claims",
        },
        "trialStartedAt": None,
        "applyError": None,
    }
    assert seeded[NOMINEE]["desired"]["reason"]
    # Created, never set: an administrator nominating in the same minute wins.
    assert {w.op for w in store.writes("roleNominations")} == {"create"}
    # Claims are not touched.
    assert accounts.claims_set == []


def test_seed_logs_each_document():
    accounts = people()
    store = FakeStore()
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args(["--seed"]), ctx)

    [action] = [w.data for w in store.writes("userActions")]
    assert action == {
        "kind": "seed",
        "target": NOMINATOR,
        "by": MIGRATION,
        "at": NOW_ISO,
        "from": {"level": "admin", "trial": False, "owner": False},
        "to": {"level": "admin", "trial": False},
    }


def test_seed_never_overwrites_a_document():
    existing = nomination("normal")
    accounts = people(account(NOMINEE, ADMIN_CLAIMS))
    store = store_with(**{NOMINEE: existing})
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args(["--seed"]), ctx)

    assert store.docs["roleNominations"][NOMINEE] == existing
    assert set(store.docs["roleNominations"]) == {NOMINEE, NOMINATOR}


def test_seed_takes_trial_starts_from_the_table(capsys):
    accounts = people(
        account(LEGACY_TRIAL, {**ADMIN_CLAIMS, "newAdmin": True}),
        account(NOMINEE, {**ADMIN_CLAIMS, "newAdmin": True}),
    )
    store = FakeStore()
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args(["--seed"]), ctx)

    seeded = store.docs["roleNominations"]
    assert seeded[LEGACY_TRIAL]["trialStartedAt"] == "2026-09-23T10:26:21.000Z"
    assert seeded[LEGACY_TRIAL]["desired"]["trial"] is True
    # A trial the table never knew about: nobody recorded when it began.
    assert seeded[NOMINEE]["trialStartedAt"] is None
    assert NOMINEE in capsys.readouterr().out


ON_TRIAL = {**ADMIN_CLAIMS, "newAdmin": True}
SECOND_TRIAL = "7bu9zrX4OzVrrq1atEF7vsehea52"
ENDED_TRIAL = "9YY314GDLUauY92yNpjdgYL2ONr2"


def with_nominator(**docs: dict) -> FakeStore:
    """`docs`, plus a seeded document for the nominator `people()` brings, so
    that the seed has nobody to create."""
    return store_with(**{NOMINATOR: nomination("admin", by=MIGRATION)}, **docs)


def page_made(**extra) -> dict:
    """What the users page writes for a trial administrator somebody nominated
    before the seed ran - „Zakończ okres próbny”, then withdrawn: desired back
    to the live state, and no start, which only the table knows."""
    return nomination("admin", trial=True, by=NOMINATOR, **extra)


def test_seed_dates_a_trial_whose_document_the_page_made_first(capsys):
    accounts = people(account(LEGACY_TRIAL, ON_TRIAL))
    store = with_nominator(**{LEGACY_TRIAL: page_made()})
    ctx, prompts = context(accounts, store, answers=[True])

    assert run(parse_args(["--seed"]), ctx) == 0

    assert len(prompts) == 1
    # That one field, and nothing else: `desired` and `applied` are the page's
    # and the script's, and no history line is due - no role changed.
    assert store.commits == [
        [
            Write(
                "update",
                "roleNominations",
                LEGACY_TRIAL,
                {"trialStartedAt": "2026-09-23T10:26:21.000Z"},
            )
        ]
    ]
    assert store.docs["roleNominations"][LEGACY_TRIAL] == {
        **page_made(),
        "trialStartedAt": "2026-09-23T10:26:21.000Z",
    }
    out = capsys.readouterr().out
    assert f"{LEGACY_TRIAL}" in out.split("Dating 1")[1]
    assert "2026-09-23T10:26:21.000Z" in out


def test_seed_leaves_every_other_existing_document_alone(capsys):
    accounts = people(
        # Dated already, and as the table says.
        account(LEGACY_TRIAL, ON_TRIAL),
        # Dated otherwise - a trial stamped by an ordinary run before the
        # seed, or begun again since: said, not changed.
        account(SECOND_TRIAL, ON_TRIAL),
        # In the table, but no longer on trial: nothing to date.
        account(ENDED_TRIAL, ADMIN_CLAIMS),
        # On trial, but not in the table: no date to give it.
        account(NOMINEE, ON_TRIAL),
    )
    store = with_nominator(
        **{
            LEGACY_TRIAL: page_made(trialStartedAt="2026-09-23T10:26:21.000Z"),
            SECOND_TRIAL: page_made(trialStartedAt=NOW_ISO),
            ENDED_TRIAL: nomination("admin"),
            NOMINEE: page_made(),
        }
    )
    ctx, prompts = context(accounts, store, answers=[True])

    assert run(parse_args(["--seed"]), ctx) == 0

    assert prompts == []
    assert store.commits == []
    out = capsys.readouterr().out
    differs = [line for line in out.splitlines() if SECOND_TRIAL in line]
    assert any(NOW_ISO in line and "2026-09-23" in line for line in differs)


def test_seed_dry_run_counts_a_trial_to_date():
    accounts = people(account(LEGACY_TRIAL, ON_TRIAL))
    store = with_nominator(**{LEGACY_TRIAL: page_made()})
    ctx, prompts = context(accounts, store, dry_run=True)

    assert run(parse_args(["--seed", "--dry-run"]), ctx) == 1
    assert prompts == []
    assert store.commits == []


def test_seed_dates_nothing_without_a_yes():
    accounts = people(account(LEGACY_TRIAL, ON_TRIAL))
    store = with_nominator(**{LEGACY_TRIAL: page_made()})
    ctx, prompts = context(accounts, store, answers=[False])

    run(parse_args(["--seed"]), ctx)

    assert len(prompts) == 1
    assert store.commits == []


def test_seed_skips_robots():
    accounts = people(account("pipeline-people-import", {"datascience": True}))
    store = FakeStore()
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args(["--seed"]), ctx)

    assert set(store.docs["roleNominations"]) == {NOMINATOR}


def test_seed_does_nothing_without_a_yes():
    accounts = people()
    store = FakeStore()
    ctx, prompts = context(accounts, store, answers=[False])

    run(parse_args(["--seed"]), ctx)

    assert len(prompts) == 1
    assert store.commits == []


def test_seed_dry_run_writes_nothing():
    accounts = people()
    store = FakeStore()
    ctx, prompts = context(accounts, store, dry_run=True)

    assert run(parse_args(["--seed", "--dry-run"]), ctx) == 1
    assert prompts == []
    assert store.commits == []


def test_a_document_written_meanwhile_is_kept(capsys):
    accounts = people()
    store = FakeStore()
    ctx, _ = context(accounts, store, answers=[True])
    # An administrator nominates between the read and the write.
    original_commit = store.commit

    def racing_commit(writes):
        store.docs.setdefault("roleNominations", {})[NOMINATOR] = {"mine": True}
        return original_commit(writes)

    store.commit = racing_commit  # type: ignore[method-assign]

    run(parse_args(["--seed"]), ctx)

    assert store.docs["roleNominations"][NOMINATOR] == {"mine": True}
    assert store.writes("userActions") == []
    assert "already" in capsys.readouterr().out


def test_mismatches_with_the_old_table_are_printed(capsys):
    on_trial = {**ADMIN_CLAIMS, "newAdmin": True}
    in_table = next(u for u, level in ROLE_LEVELS.items() if level == Level.ADMIN)
    accounts = people(
        # Holds what the table says.
        account(LEGACY_TRIAL, on_trial),
        # In the table as an admin, but holds less.
        account(in_table, {"trusted": True}),
        # Not in the table at all.
        account(NOMINEE, {"trusted": True}),
    )
    store = FakeStore()
    ctx, _ = context(accounts, store, answers=[True])

    run(parse_args(["--seed"]), ctx)

    out = capsys.readouterr().out.split("ROLE_LEVELS", 1)[1]
    assert in_table in out
    assert NOMINEE in out
    assert LEGACY_TRIAL not in out
    # Every other uid in the table has no account in this fake.
    gone = set(ROLE_LEVELS) - {in_table, LEGACY_TRIAL}
    assert all(uid in out for uid in gone)


def test_the_table_drives_nothing_but_the_seed():
    # A uid in ROLE_LEVELS with no document is left exactly as it is by an
    # ordinary run, whatever the table says it should hold.
    in_table = next(u for u, level in ROLE_LEVELS.items() if level == Level.ADMIN)
    accounts = people(account(in_table, {"trusted": True}))
    store = FakeStore()
    ctx, prompts = context(accounts, store, answers=[True])

    run(parse_args([]), ctx)

    assert prompts == []
    assert accounts.claims_set == []
    assert store.commits == []
