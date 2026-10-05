"""The table set_auth_claims applied before nominations, and the one run that
moves the claims accounts hold into `roleNominations`.

`uv run set_auth_claims --seed` writes, for every account whose claims amount
to more than "normal" and that has no document yet, a nomination whose desired
and applied state are both what the account holds now - so the first ordinary
run finds nothing to do instead of taking for unnominated every administrator
the site has. It is created, never set: a nomination an administrator makes in
the same minute is the one that stays. Then it prints where the live claims
differ from ROLE_LEVELS and NEW_ADMINS below, which is how the owner sees the
seed is what he meant: the claims, not this table, are what gets seeded.

Nothing else reads ROLE_LEVELS or NEW_ADMINS any more, and no uid is to be
added here: a new role is a nomination on /admin/uzytkownicy. Once the seed has
run, delete this file, test_set_auth_claims_legacy.py and `--seed`.
"""

from __future__ import annotations

from typing import Any

from set_auth_claims import (
    NOMINATIONS,
    USER_ACTIONS,
    Account,
    Context,
    Level,
    Write,
    claims_diff,
    get_claims,
    is_robot,
    iso,
    role_from_claims,
)

#: `by` on what the seed writes: `isMigrationUid` in frontend/shared/stats.ts
#: reads it as a script, not a person.
MIGRATION = "migration:set_auth_claims"

#: Shown on the users page as the reason for the seeded nomination.
SEED_REASON = (
    "Uprawnienia nadane przed nominacjami na stronie Użytkownicy - "
    "przeniesione z konta bez zmian."
)

ROLE_LEVELS = {
    "of0BKlwqWLX21Cuml4NMHZ18xoC3": Level.ADMIN,
    "REdyYP4uvMSgCEjdSoiEHqy360G3": Level.ADMIN,
    "8DomV5BlwlgPI9iLSDA2wHk168h1": Level.ADMIN,
    "7bu9zrX4OzVrrq1atEF7vsehea52": Level.ADMIN,
    "9YY314GDLUauY92yNpjdgYL2ONr2": Level.ADMIN,
    "6tieFsnlz0g4kzT4nb5QFMBvTBx2": Level.ADMIN,
    "WpuDVVsjUpOVOoCbnCfzIve2xMh1": Level.ADMIN,
    "BNsOBjwYW3eGgcnOnQYZoTPOGbA3": Level.ADMIN,
    "rJNsODgkXuZ9di81GTcgPhc192o2": Level.ADMIN,
    "ODZUN0WEZ9PLpVNO3uBq808D8Uh2": Level.ADMIN,
    "xLrIMGV6ITbhGG2H1s2urN226tv1": Level.ADMIN,
    "1U0540kyQpOWsqa5OItWyDC4vTf2": Level.DATASCIENCE,
}

# Administrators on trial: `admin` plus `newAdmin`, which lets the established
# administrators watch what they do on /aktywnosc under "Nowi administratorzy".
NEW_ADMINS = {
    "8DomV5BlwlgPI9iLSDA2wHk168h1",
    "7bu9zrX4OzVrrq1atEF7vsehea52",
    "9YY314GDLUauY92yNpjdgYL2ONr2",
    "6tieFsnlz0g4kzT4nb5QFMBvTBx2",
    "WpuDVVsjUpOVOoCbnCfzIve2xMh1",
    "BNsOBjwYW3eGgcnOnQYZoTPOGbA3",
    "rJNsODgkXuZ9di81GTcgPhc192o2",
    "ODZUN0WEZ9PLpVNO3uBq808D8Uh2",
    "xLrIMGV6ITbhGG2H1s2urN226tv1",
}

# When each of those trials began, for the users page's "od N dni" and its list
# of trials to decide on. Nothing recorded it at the time; the closest record
# is the commit that put the uid into NEW_ADMINS, since the owner edited the
# table and ran the script in one sitting. Its author date, not its committer
# date: 3f21db58 was written on 09-30 and rebased onto main on 10-05, which
# moved only the latter. rJNsODgk was an administrator once before (2025-06 to
# 2025-09, before trials existed); its trial is the one that began on 09-30.
#
#   jj log -r '::main & diff_lines(regex:"<uid>", glob:"**/set_auth_claims*.py")'
_F11B2D4F = "2026-09-23T10:26:21.000Z"  # More admins marked as newAdmins
_317D6208 = "2026-09-23T15:41:06.000Z"  # More new admins
_3F21DB58 = "2026-09-30T13:14:02.000Z"  # Skip auth changes without changes, ...
TRIAL_STARTED_AT = {
    "8DomV5BlwlgPI9iLSDA2wHk168h1": _F11B2D4F,
    "7bu9zrX4OzVrrq1atEF7vsehea52": _F11B2D4F,
    "9YY314GDLUauY92yNpjdgYL2ONr2": _F11B2D4F,
    "6tieFsnlz0g4kzT4nb5QFMBvTBx2": _317D6208,
    "WpuDVVsjUpOVOoCbnCfzIve2xMh1": _317D6208,
    "BNsOBjwYW3eGgcnOnQYZoTPOGbA3": _3F21DB58,
    "rJNsODgkXuZ9di81GTcgPhc192o2": _3F21DB58,
    "ODZUN0WEZ9PLpVNO3uBq808D8Uh2": _3F21DB58,
    "xLrIMGV6ITbhGG2H1s2urN226tv1": _3F21DB58,
}


def seeded(account: Account, at: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """The nomination document and the history line for one claim holder."""
    role = role_from_claims(account.claims)
    started = TRIAL_STARTED_AT.get(account.uid) if role.trial else None
    nomination = {
        "desired": {**role.state(), "reason": SEED_REASON, "by": MIGRATION, "at": at},
        "applied": {**role.state(), "at": at, "by": MIGRATION},
        "trialStartedAt": started,
        "applyError": None,
    }
    action = {
        "kind": "seed",
        "target": account.uid,
        "by": MIGRATION,
        "at": at,
        "from": role.current(),
        "to": role.state(),
    }
    return nomination, action


def undated_trials(
    accounts: list[Account], nominations: dict[str, dict[str, Any]]
) -> list[tuple[Account, str]]:
    """Trial administrators whose document has no start, with the start
    TRIAL_STARTED_AT gives them.

    An account with a document is not seeded: whatever is in `desired` is
    somebody's wish, and stays. One thing may still be missing from it, though,
    and only this table has it. The users page goes live before the seed runs
    and lists today's trial administrators with „Zakończ okres próbny”; a
    nomination made there first creates the document with no `trialStartedAt`.
    Declined or withdrawn, it would leave the trial undated for good - no day
    count, never due for a decision. So the seed writes that one field, under
    the same y as the rest.

    A start already there and different from the table's is printed and left:
    it is either a trial begun again since, or a date an ordinary run stamped
    before the seed (`trial_start` in set_auth_claims.py). The owner can tell
    which, and correct the latter by hand."""
    found: list[tuple[Account, str]] = []
    for account in sorted(accounts, key=lambda a: a.uid):
        doc = nominations.get(account.uid)
        table = TRIAL_STARTED_AT.get(account.uid)
        if doc is None or not table or not role_from_claims(account.claims).trial:
            continue
        recorded = doc.get("trialStartedAt")
        if not recorded:
            found.append((account, table))
        elif recorded != table:
            print(
                f"Left as it is: {account.uid} {account.display_name!r} is on "
                f"trial since {recorded} by its document, {table} by the table."
            )
    return found


def seed(ctx: Context) -> int:
    """Writes the documents after one y for all of them - they change no claim,
    only record the claims there are - and then the comparison with the table.
    Robots are left out: a pipeline account with a claim on it is something to
    look into, not something to make official. The same y dates the trials
    whose document the users page made first (`undated_trials`)."""
    accounts = list(ctx.accounts.all())
    nominations = ctx.store.nominations()
    to_seed: list[Account] = []
    for account in sorted(accounts, key=lambda a: a.uid):
        role = role_from_claims(account.claims)
        if role.level <= Level.NORMAL or account.uid in nominations:
            continue
        if is_robot(account.uid):
            print(f"Skipping {account.uid}: a robot, whatever its claims.")
            continue
        to_seed.append(account)
    to_date = undated_trials(accounts, nominations)

    print(f"Seeding {len(to_seed)} nomination documents with the live state:")
    for account in to_seed:
        role = role_from_claims(account.claims)
        note = ""
        if role.trial:
            started = TRIAL_STARTED_AT.get(account.uid) or "an unrecorded date"
            note = f", on trial since {started}"
        print(f"  {account.uid}  {account.display_name!r}  {role.state()}{note}")
    if to_date:
        print(
            f"Dating {len(to_date)} trials whose document the users page made "
            "first, without a start (trialStartedAt only):"
        )
        for account, started in to_date:
            print(
                f"  {account.uid}  {account.display_name!r}  on trial since {started}"
            )

    written = 0
    if (to_seed or to_date) and not ctx.dry_run and ctx.confirm("Write them? (y/N): "):
        at = iso(ctx.now())
        for account in to_seed:
            nomination, action = seeded(account, at)
            created = ctx.store.commit(
                [
                    Write("create", NOMINATIONS, account.uid, nomination),
                    Write("set", USER_ACTIONS, None, action),
                ]
            )
            if created:
                written += 1
            else:
                print(f"  {account.uid}: a document is already there; kept it.")
        print(f"Wrote {written}.")
        if to_date:
            ctx.store.commit(
                [
                    Write("update", NOMINATIONS, account.uid, {"trialStartedAt": since})
                    for account, since in to_date
                ]
            )
            print(f"Dated {len(to_date)}.")

    print_mismatches(accounts)
    return 1 if ctx.dry_run and (to_seed or to_date) else 0


def print_mismatches(accounts: list[Account]) -> None:
    by_uid = {a.uid: a for a in accounts}
    lines = []
    for uid, level in ROLE_LEVELS.items():
        expected = get_claims(uid, level, trial=uid in NEW_ADMINS)
        account = by_uid.get(uid)
        if account is None:
            lines.append(f"  {uid}: in the table, but there is no such account")
        elif account.claims != expected:
            diff = "; ".join(claims_diff(expected, account.claims))
            lines.append(
                f"  {uid} {account.display_name!r}: the table says {level.name}"
                f"{' on trial' if uid in NEW_ADMINS else ''}; to match it: {diff}"
            )
    for account in sorted(accounts, key=lambda a: a.uid):
        if account.uid not in ROLE_LEVELS and any(account.claims.values()):
            lines.append(
                f"  {account.uid} {account.display_name!r}: holds "
                f"{sorted(account.claims)}, not in the table"
            )
    print()
    print("Live claims against the old table (ROLE_LEVELS, NEW_ADMINS):")
    print("\n".join(lines) if lines else "  every account holds what it says")
