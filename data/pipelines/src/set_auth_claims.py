"""Gives accounts the roles administrators nominated on /admin/uzytkownicy.

Firebase Auth custom claims are what every role check on the site reads, and
this script is still the only thing that writes them, run by hand by the
site's owner. What changed is where the wish comes from. It used to be two
dicts in this file, edited and committed for every new administrator - which
published each administrator's uid in a public repository, and left who was
given what, at whose request and why, to commit messages. Now an established
administrator nominates somebody on the users page, the server stores the
desired state in `roleNominations/{uid}` (frontend/shared/userAdmin.ts), and
this script reads it, shows the owner who the account is and who asked, and
writes nothing until he answers y. The site cannot change a claim by itself:
that answer is the approval, as it always was.

A nomination is a desired state, compared with the account's live claims on
every run - never with what the script last wrote, so a claim edited by hand in
the console shows up as a difference too. That is what lets a nomination take
a role away as well as give one ("normal" is a level like any other), and what
makes a declined or failed change come back on the next run instead of being
lost. No document means "leave the account alone", never "demote": the
accounts that held claims before the collection existed are written into it
once, by `--seed`, and any other claim holder is listed at the end of each run
for somebody to decide about.

A run takes as long as the owner's answers do, and the users page goes on
taking nominations and withdrawals meanwhile. So the list read at the start
only sets the order. Each document is read again when its turn comes, so what
is printed is the wish as it stands, and once more after the y: if `desired`
changed while the owner was deciding, nothing is applied - the y answered the
facts above it, not the new wish - and the next run asks about the new one.

A change the owner says yes to does, in order:
1. `set_custom_user_claims`, which replaces the whole claims object - so
   `newAdmin` and `owner` are computed into the same dict (`get_claims`), or
   each run would strip them. Nothing below is written if this fails.
2. `revoke_refresh_tokens`, when the account loses a claim that opened
   something. Not only `admin`: `datascience` opens the ingest, which
   publishes without review, and a session kept alive by its refresh token
   would keep it. Not `newAdmin`, which closes rather than opens: losing it
   is the end of a trial, a promotion, and signs nobody out (`lost_claims`).
3. The receipt on the nomination: `applied`, `trialStartedAt` (set when a
   trial begins, cleared when it ends) and `applyError` cleared.
4. `users/{uid}.claimsChangedAt`, the open tab's cue to fetch a fresh token at
   once rather than within the hour (frontend/app/composables/auth.ts).
5. An `apply` line in `userActions`, the account's history on the users page.
6. The `roleChanged` mail, to a verified address only, unless switched off on
   /profil. Queued in `mail` for the Trigger Email extension, as the site's
   own notifications are (frontend/server/utils/notifications.ts).
3-5 are one batch. The claims cannot be part of it - Auth is not Firestore -
so a batch that fails after the claims changed is printed, loudly, and the
next run finds the account matching its nomination and stamps the receipt,
dating a trial that has no start from the stamp (`trial_start`).

Refused without asking, with the reason recorded as `applyError` for the users
page to show: an account that no longer exists, a robot (pipeline and
migration uids, `isAutomatedUid` in frontend/shared/stats.ts), `datascience`
or `admin` for an address nobody proved they own, and the owner below a plain
administrator. The server refuses the same nominations; these are here because
the script, not the page, is what writes the claims.

    uv run set_auth_claims             apply, asking y/N per account
    uv run set_auth_claims --dry-run   print what would change; exit 1 if anything would
    uv run set_auth_claims --report    claim holders without a document, documents
                                       without an account, robots
    uv run set_auth_claims --seed      once: write documents for today's claim holders

Production is the `koryta-pl` project with application default credentials,
which in practice are the owner's own. With both `FIRESTORE_EMULATOR_HOST` and
`FIREBASE_AUTH_EMULATOR_HOST` set, it is the dev stack's emulators instead, and
only there does `--yes` answer every question - for the end-to-end tests.
"""

from __future__ import annotations

import argparse
import html
import os
import socket
import sys
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import IntEnum
from typing import Any, Literal, Protocol

import firebase_admin
from firebase_admin import auth
from google.api_core.exceptions import AlreadyExists
from google.cloud.firestore import SERVER_TIMESTAMP

from stores.job_runs import emulator_project


class Level(IntEnum):
    UNKNOWN = 0
    NORMAL = 1
    TRUSTED = 2
    DATASCIENCE = 3
    ADMIN = 4


def get_custom_claims_dict(level: Level) -> dict[str, bool]:
    """The claims `level` holds on its own, each level all of the one below.

    frontend/shared/roleClaims.json is the same ladder for the site, and a test
    keeps the two equal."""
    c = Level.UNKNOWN
    result = {}
    while int(c) <= int(level):
        if c == Level.TRUSTED:
            result["trusted"] = True
        if c == Level.DATASCIENCE:
            result["datascience"] = True
        if c == Level.ADMIN:
            result["admin"] = True
        if c == level:
            break
        c = Level(int(c) + 1)
    return result


#: How a level is spelled in a nomination (`roleLevels` in
#: frontend/shared/roles.ts). UNKNOWN has no spelling: nobody is nominated to it.
LEVEL_NAMES: dict[Level, str] = {
    Level.NORMAL: "normal",
    Level.TRUSTED: "trusted",
    Level.DATASCIENCE: "datascience",
    Level.ADMIN: "admin",
}


def level_from_name(name: object) -> Level | None:
    for level, spelled in LEVEL_NAMES.items():
        if name == spelled:
            return level
    return None


# The site's owner. `owner` is what opens his task list, /admin/zadania, and
# the routes behind it - narrower than `admin` on purpose: the list names
# rules holes, credentials to set up and research about people, and the other
# administrators have no business reading it. Like `newAdmin`, it is granted
# only alongside `admin`. It stays a constant here rather than becoming
# something a nomination can ask for, so that no write to Firestore, by anybody,
# can make an account the owner.
OWNERS = {"of0BKlwqWLX21Cuml4NMHZ18xoC3"}

PROJECT_ID = "koryta-pl"
#: Every collection this script touches is in the site's database, never in
#: `(default)` - in the emulator as in production.
DATABASE = "koryta-pl"

#: `siteUrl` in frontend/nuxt.config.ts: where the mail's links point, so a
#: message queued in the emulator never sends anybody to production.
SITE_URL = "https://koryta.pl"
EMULATOR_SITE_URL = "http://localhost:3000"

#: `userCollections` in frontend/shared/userAdmin.ts.
NOMINATIONS = "roleNominations"
USER_ACTIONS = "userActions"
USERS = "users"
MAIL = "mail"

#: Who wrote a receipt or a history line - `applied.by` in userAdmin.ts. The
#: host says which machine's credentials did it.
ACTOR_PREFIX = "script:set_auth_claims@"

# The reasons a nomination is refused, as the users page shows them (Polish,
# like the rest of the site).
ACCOUNT_GONE = "Konto nie istnieje - mogło zostać usunięte."
ROBOT_REFUSED = "To konto automatu, nie osoby - skrypt nie nadaje mu uprawnień."
OWNER_REFUSED = "Właściciel serwisu pozostaje administratorem, bez okresu próbnego."
SELF_REFUSED = "Nikt nie nominuje sam siebie."


def unverified_refused(level: Level) -> str:
    return (
        "Adres e-mail konta nie jest potwierdzony, a poziom "
        f"„{LEVEL_TITLES[level]}” wymaga potwierdzonego."
    )


# ---------------------------------------------------------------------------
# Roles


@dataclass(frozen=True)
class Role:
    """What one account's claims amount to (`CurrentRole` in roles.ts)."""

    level: Level
    trial: bool = False
    owner: bool = False

    def state(self) -> dict[str, Any]:
        """The part a nomination asks for: `RoleState`."""
        return {"level": LEVEL_NAMES[self.level], "trial": self.trial}

    def current(self) -> dict[str, Any]:
        return {**self.state(), "owner": self.owner}


def get_claims(uid: str, level: Level, trial: bool = False) -> dict[str, bool]:
    """The whole claims dict `uid` should hold at `level`.

    `set_custom_user_claims` replaces every claim at once, so `newAdmin` and
    `owner` have to be part of the same dict or each run would drop them. They
    mean nothing without `admin`, and are left out at any other level: a trial
    is a trial as an administrator, and the owner is never nominated below one
    (`refusal` says so before this is asked)."""
    claims = get_custom_claims_dict(level)
    if level == Level.ADMIN:
        if trial:
            claims["newAdmin"] = True
        if uid in OWNERS:
            claims["owner"] = True
    return claims


def role_from_claims(claims: Mapping[str, Any] | None) -> Role:
    """`roleFromClaims` in roles.ts: the highest level whose own claim is
    there, so an account edited by hand into `{admin: true}` reads as the
    administrator every check on the site takes it for."""
    claims = claims or {}
    admin = claims.get("admin") is True
    if admin:
        level = Level.ADMIN
    elif claims.get("datascience") is True:
        level = Level.DATASCIENCE
    elif claims.get("trusted") is True:
        level = Level.TRUSTED
    else:
        level = Level.NORMAL
    return Role(
        level,
        trial=admin and claims.get("newAdmin") is True,
        owner=admin and claims.get("owner") is True,
    )


# The labels of frontend/shared/roles.ts, which a test checks are still there.
LEVEL_TITLES: dict[Level, str] = {
    Level.NORMAL: "Uczestnik",
    Level.TRUSTED: "Zaufany uczestnik",
    Level.DATASCIENCE: "Zespół",
    Level.ADMIN: "Administrator",
}
TRIAL_CHIP = "okres próbny"
OWNER_LABEL = "Właściciel serwisu"


def describe_role(role: Role) -> str:
    """`describeRole` in roles.ts: one line for a role, as the page prints it."""
    if role.owner:
        return OWNER_LABEL
    title = LEVEL_TITLES[role.level]
    return (
        f"{title} ({TRIAL_CHIP})" if role.level == Level.ADMIN and role.trial else title
    )


def is_robot(uid: str) -> bool:
    """`isAutomatedUid` in frontend/shared/stats.ts. The pipeline accounts get
    `datascience` in a custom token that is never saved on the account, so the
    account itself holds no claim, and must not be "fixed" by being given one."""
    return "pipeline" in uid or uid.startswith("migration:")


#: Claims that narrow what an account may do rather than widen it. `newAdmin`
#: is what keeps an administrator on trial off the pages that watch the
#: others, and those read it from the account, not from the token
#: (`requireEstablishedAdmin` in frontend/server/utils/auth.ts) - so losing it
#: takes nothing away, and gaining it applies without a fresh token.
RESTRICTIONS = frozenset({"newAdmin"})


def lost_claims(before: Mapping[str, Any], after: Mapping[str, Any]) -> list[str]:
    """Claims `before` holds that `after` does not and that opened something:
    the loss `revoke` ends the account's sessions for.

    Not `newAdmin`. Revoking is not a quiet refresh: the open tab's forced one
    (`refreshIfClaimsChanged` in frontend/app/composables/auth.ts) is refused,
    and Firebase signs the person out mid-page. For the end of a trial that
    would sign out somebody who was just promoted, with a mail telling them
    the page refreshes by itself. A trial administrator demoted below
    `admin` still loses `admin`, and is signed out for that."""
    return sorted(
        k
        for k, value in before.items()
        if value and not after.get(k) and k not in RESTRICTIONS
    )


def claims_diff(target: Mapping[str, Any], live: Mapping[str, Any]) -> list[str]:
    lines = [f"+ {k}" for k in sorted(target) if k not in live]
    lines += [f"- {k}" for k in sorted(live) if k not in target]
    lines += [
        f"~ {k}: {live[k]!r} -> {target[k]!r}"
        for k in sorted(target)
        if k in live and live[k] != target[k]
    ]
    return lines


def iso(moment: datetime) -> str:
    """ISO 8601 in UTC with milliseconds, as `new Date().toISOString()` writes
    it - the convention of every timestamp string the site stores."""
    return (
        moment.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    )


# ---------------------------------------------------------------------------
# Auth and Firestore, behind the little this script needs of them


@dataclass(frozen=True)
class Account:
    uid: str
    display_name: str | None
    email: str | None
    email_verified: bool
    #: `providerData` ids: `google.com`, `password`.
    providers: tuple[str, ...]
    created_at: datetime | None
    claims: dict[str, Any]
    disabled: bool = False


class Accounts(Protocol):
    def get(self, uid: str) -> Account | None:
        """The account, or None when there is none by that uid."""
        ...

    def all(self) -> Iterable[Account]: ...

    def set_claims(self, uid: str, claims: dict[str, bool]) -> None: ...

    def revoke_refresh_tokens(self, uid: str) -> None: ...


@dataclass(frozen=True)
class Write:
    """One write of a batch. `merge` is `set(..., merge=True)`; a `doc_id` of
    None is a new document with an id Firestore picks."""

    op: Literal["set", "merge", "update", "create"]
    collection: str
    doc_id: str | None
    data: dict[str, Any]


class Store(Protocol):
    def nominations(self) -> dict[str, dict[str, Any]]:
        """Every `roleNominations` document by uid."""
        ...

    def nomination(self, uid: str) -> dict[str, Any] | None:
        """`roleNominations/{uid}` as it is now, None when there is none."""
        ...

    def notification_preferences(self, uid: str) -> dict[str, Any]:
        """`users/{uid}.notifications`, empty when never set."""
        ...

    def commit(self, writes: Sequence[Write]) -> bool:
        """All or nothing. False, with nothing written, when a `create` found
        its document already there; any other failure raises."""
        ...


def account_from_record(record: Any) -> Account:
    metadata = record.user_metadata
    created = metadata.creation_timestamp if metadata else None
    return Account(
        uid=record.uid,
        display_name=record.display_name,
        email=record.email,
        email_verified=bool(record.email_verified),
        providers=tuple(p.provider_id for p in record.provider_data or []),
        created_at=datetime.fromtimestamp(created / 1000, UTC) if created else None,
        claims=dict(record.custom_claims or {}),
        disabled=bool(record.disabled),
    )


#: The longest uid Firebase Auth takes (`validate_uid` in firebase_admin).
MAX_UID_LENGTH = 128


class FirebaseAccounts:
    def __init__(self, app: Any):
        self.app = app

    def get(self, uid: str) -> Account | None:
        try:
            return account_from_record(auth.get_user(uid, app=self.app))
        except auth.UserNotFoundError:
            return None
        except ValueError:
            # `get_user` checks the uid before it asks, and raises ValueError
            # rather than UserNotFoundError for "" or one too long. Such a uid
            # names no account either. It comes from a document - a
            # `desired.by` left out or edited by hand in the console - and one
            # bad document must not end the run for every nomination after it.
            # A uid of a valid length means the error is about something else,
            # a missing project id say, which would otherwise read every
            # account as gone and refuse every nomination: that is raised.
            if 0 < len(uid) <= MAX_UID_LENGTH:
                raise
            return None

    def all(self) -> Iterable[Account]:
        for record in auth.list_users(app=self.app).iterate_all():
            yield account_from_record(record)

    def set_claims(self, uid: str, claims: dict[str, bool]) -> None:
        auth.set_custom_user_claims(uid, claims, app=self.app)

    def revoke_refresh_tokens(self, uid: str) -> None:
        auth.revoke_refresh_tokens(uid, app=self.app)


class FirestoreStore:
    def __init__(self, client: Any):
        self.db = client

    def nominations(self) -> dict[str, dict[str, Any]]:
        return {
            doc.id: doc.to_dict() or {}
            for doc in self.db.collection(NOMINATIONS).stream()
        }

    def nomination(self, uid: str) -> dict[str, Any] | None:
        snapshot = self.db.collection(NOMINATIONS).document(uid).get()
        return (snapshot.to_dict() or {}) if snapshot.exists else None

    def notification_preferences(self, uid: str) -> dict[str, Any]:
        # One field of a document its owner can fill with anything.
        snapshot = (
            self.db.collection(USERS).document(uid).get(field_paths=["notifications"])
        )
        preferences = (snapshot.to_dict() or {}).get("notifications")
        return preferences if isinstance(preferences, dict) else {}

    def commit(self, writes: Sequence[Write]) -> bool:
        batch = self.db.batch()
        for write in writes:
            collection = self.db.collection(write.collection)
            ref = (
                collection.document(write.doc_id)
                if write.doc_id
                else collection.document()
            )
            if write.op == "create":
                batch.create(ref, write.data)
            elif write.op == "update":
                batch.update(ref, write.data)
            else:
                batch.set(ref, write.data, merge=write.op == "merge")
        try:
            batch.commit()
        except AlreadyExists:  # from a `create`; nothing in the batch was written
            return False
        return True


# ---------------------------------------------------------------------------
# One run


@dataclass
class Context:
    accounts: Accounts
    store: Store
    #: Asks the owner; True for yes.
    confirm: Callable[[str], bool]
    now: Callable[[], datetime]
    site_url: str
    #: `script:set_auth_claims@<host>`.
    actor: str
    dry_run: bool = False
    _names: dict[str, Account | None] = field(default_factory=dict)

    def lookup(self, uid: str) -> Account | None:
        if uid not in self._names:
            self._names[uid] = self.accounts.get(uid)
        return self._names[uid]

    def forget(self, uid: str) -> None:
        """Drops what `lookup` remembers of `uid`, whose claims this run just
        changed: a nominator demoted a few questions ago must not go on
        reading as an established administrator for the rest of the run."""
        self._names.pop(uid, None)


Outcome = Literal[
    "applied",
    "declined",
    "refused",
    "stamped",
    "unchanged",
    "pending",
    "failed",
    "changed",
]


def desired_role(uid: str, doc: Mapping[str, Any]) -> Role | None:
    desired = doc.get("desired") or {}
    level = level_from_name(desired.get("level"))
    if level is None:
        return None
    admin = level == Level.ADMIN
    return Role(
        level,
        trial=admin and desired.get("trial") is True,
        owner=admin and uid in OWNERS,
    )


def refusal(account: Account, live: Role, desired: Role, by: str) -> str | None:
    """Why the script will not apply this, or None.

    The server refuses the same nominations before it stores them; they are
    checked again here because a document is only as good as whatever wrote
    it, and this, not the page, is what writes the claims.

    A level that publishes needs a verified address: anybody can register with
    anybody's address, and the address is what the nominator recognised. Not
    for a step down, though - an unverified administrator nominated to the team
    should not keep `admin` because their address is unverified."""
    if is_robot(account.uid):
        return ROBOT_REFUSED
    if by == account.uid:
        return SELF_REFUSED
    if account.uid in OWNERS and (desired.level != Level.ADMIN or desired.trial):
        return OWNER_REFUSED
    publishing = desired.level in (Level.DATASCIENCE, Level.ADMIN)
    if publishing and not account.email_verified and desired.level >= live.level:
        return unverified_refused(desired.level)
    return None


def receipt_is_stale(doc: Mapping[str, Any], desired: Role) -> bool:
    applied = doc.get("applied") or {}
    return (
        applied.get("level") != LEVEL_NAMES[desired.level]
        or applied.get("trial", False) is not desired.trial
        or doc.get("applyError") is not None
        # A trial with no start, or a start with no trial: `trial_start`.
        or bool(doc.get("trialStartedAt")) is not desired.trial
    )


def receipt(ctx: Context, desired: Role, at: str) -> dict[str, Any]:
    return {**desired.state(), "at": at, "by": ctx.actor}


def record_error(ctx: Context, uid: str, message: str) -> None:
    """`applyError`, for the users page to say why the nomination is still
    pending. Rewritten on every attempt, so `at` is the latest one."""
    if not ctx.dry_run:
        error = {"at": iso(ctx.now()), "message": message}
        ctx.store.commit([Write("update", NOMINATIONS, uid, {"applyError": error})])


def refuse(ctx: Context, uid: str, message: str) -> Outcome:
    print(f"Refused: {message}")
    record_error(ctx, uid, message)
    return "refused"


def trial_start(
    ctx: Context, doc: Mapping[str, Any], desired: Role, at: str
) -> dict[str, Any]:
    """`trialStartedAt` brought in line with `desired`, for a write that does
    not itself begin a trial; empty when it already is.

    A trial with no start is one granted by a run whose batch failed after
    the claims were set, or by hand in the console. The users page counts a
    trial's days, lists it as due for a decision and shows its stats from
    this date, and does none of that without one. `at` - the time of this
    write - is the best date there is, later than the real start, and the
    output says so. A start left on an account no longer on trial dates a
    trial that has ended, and is cleared."""
    started = doc.get("trialStartedAt")
    if desired.trial and not started:
        verb = "would date" if ctx.dry_run else "dating"
        print(
            f"  No trial start recorded; {verb} it {at}, the time of this run. "
            "The trial began earlier - when, the account's history on the users "
            "page may say."
        )
        return {"trialStartedAt": at}
    if not desired.trial and started:
        verb = "would clear" if ctx.dry_run else "clearing"
        print(f"  Not on trial; {verb} the trial start recorded as {started}.")
        return {"trialStartedAt": None}
    return {}


def stamp(ctx: Context, uid: str, doc: Mapping[str, Any], desired: Role) -> Outcome:
    """The account already holds what was asked for - by hand in the console,
    or from a run whose receipt failed. Nothing to ask about; the receipt, and
    the trial's start with it, are brought up to date so the page stops
    calling it unapplied."""
    verb = "would stamp" if ctx.dry_run else "stamping"
    print(f"{uid}: already holds {describe_role(desired)}; {verb} the receipt.")
    at = iso(ctx.now())
    update = {
        "applied": receipt(ctx, desired, at),
        "applyError": None,
        **trial_start(ctx, doc, desired, at),
    }
    if not ctx.dry_run:
        ctx.store.commit([Write("update", NOMINATIONS, uid, update)])
    return "stamped"


def print_facts(
    ctx: Context,
    account: Account,
    doc: Mapping[str, Any],
    wanted: Role,
    claims: tuple[Mapping[str, Any], Mapping[str, Any]],
) -> None:
    """Everything the owner needs to say y or N without opening the console.

    The name and the address are whatever the account says: a password
    account chose both, and a Google one chose its name - so they are marked as
    the user's own words rather than shown as an identity."""
    live, target = claims
    desired = doc.get("desired") or {}
    created = account.created_at.date().isoformat() if account.created_at else "?"
    verified = "verified" if account.email_verified else "NOT VERIFIED"
    print()
    print("=" * 72)
    print(f"Account    {account.uid}")
    print(f"  name     {account.display_name!r} (set by the user)")
    print(f"  email    {account.email!r} (set by the user), {verified}")
    print(f"  sign-in  {', '.join(account.providers) or '?'}, created {created}")
    if account.disabled:
        print("  DISABLED in Firebase Auth")
    print_nominator(ctx, str(desired.get("by", "")))
    print(f"  at       {desired.get('at', '?')}")
    print(f"  reason   {desired.get('reason', '')!r}")
    last_error = doc.get("applyError")
    if isinstance(last_error, dict):
        print(f"  last try {last_error.get('message')}")
    before = describe_role(role_from_claims(live))
    print(f"Role       {before} -> {describe_role(wanted)}")
    print("Claims     " + "\n           ".join(claims_diff(target, live)))


def print_nominator(ctx: Context, by: str) -> None:
    """Who asked, and whether they may: only an established administrator
    (`admin` without `newAdmin`) can nominate, but the account is read now, and
    somebody demoted since their nomination is the owner's to weigh."""
    if by.startswith("migration:"):
        print(f"Nominated  by {by}: the claims the account held before nominations")
        return
    nominator = ctx.lookup(by)
    role = role_from_claims(nominator.claims if nominator else None)
    established = role.level == Level.ADMIN and not role.trial
    name = nominator.display_name if nominator else "(no such account)"
    standing = "established administrator" if established else describe_role(role)
    print(f"Nominated  by {name!r} ({by}), {standing} now")
    if not established:
        print("!" * 72)
        print(
            "!!! WARNING: the nominator is NOT an established administrator now.\n"
            "!!! Only established administrators may nominate. Find out how this\n"
            "!!! nomination came about before you answer y."
        )
        print("!" * 72)


def process(ctx: Context, uid: str) -> Outcome:
    # Read now rather than taken from the list the run began with: the
    # questions before this one may have taken minutes.
    doc = ctx.store.nomination(uid)
    if doc is None:
        print(f"\n{uid}: the nomination is gone since the run began; skipped.")
        return "changed"
    account = ctx.accounts.get(uid)
    if account is None:
        print(f"\n{uid}: no such account.")
        return refuse(ctx, uid, ACCOUNT_GONE)
    desired = desired_role(uid, doc)
    if desired is None:
        level = (doc.get("desired") or {}).get("level")
        print(f"\n{uid}: the nomination names no level.")
        return refuse(ctx, uid, f"Nominacja bez poprawnego poziomu ({level!r}).")

    target = get_claims(uid, desired.level, desired.trial)
    live = dict(account.claims)
    if target == live:
        return (
            stamp(ctx, uid, doc, desired)
            if receipt_is_stale(doc, desired)
            else "unchanged"
        )

    by = str((doc.get("desired") or {}).get("by", ""))
    print_facts(ctx, account, doc, desired, (live, target))
    reason = refusal(account, role_from_claims(live), desired, by)
    if reason:
        return refuse(ctx, uid, reason)
    if ctx.dry_run:
        print("Would ask to apply this (--dry-run).")
        return "pending"
    if not ctx.confirm("Apply? (y/N): "):
        print("Skipped. It stays pending and comes back on the next run.")
        return "declined"
    if changed_while_deciding(ctx, uid, doc):
        return "changed"
    return apply_change(ctx, account, doc, desired, target, live)


def changed_while_deciding(ctx: Context, uid: str, shown: Mapping[str, Any]) -> bool:
    """Whether the nomination the owner just said y to has been replaced.

    The y answers the facts printed above it. An established administrator
    may have withdrawn the nomination, or made another, while the owner read
    them - having found the nominee is a troll, say. Applying the printed one
    then would grant what nobody wants any more, and the receipt, the history
    line and the mail would all describe it. So nothing is applied and
    nothing is written: the new wish is simply pending, and the next run
    prints it and asks again. Any change to `desired` counts, a new reason or
    nominator too - the owner weighed who asked and why.

    Read right before the claims are written, which leaves a few milliseconds
    for a change to slip in rather than as long as the owner takes to answer."""
    current = ctx.store.nomination(uid)
    if current is not None and current.get("desired") == shown.get("desired"):
        return False
    if current is None:
        state = "the document is gone"
    else:
        wish = current.get("desired") or {}
        wanted = desired_role(uid, current)
        role = describe_role(wanted) if wanted else repr(wish.get("level"))
        state = f"it now asks for {role}, by {wish.get('by')} at {wish.get('at')}"
    print("!" * 72)
    print(
        f"!!! NOT applied: the nomination of {uid} changed while you were "
        f"deciding -\n!!! {state}.\n"
        "!!! Run the script again to decide on the current one."
    )
    print("!" * 72)
    return True


def revoke(ctx: Context, uid: str, lost: list[str]) -> bool:
    """Ends every session of an account that lost a claim (`lost_claims`).

    The ID token it holds keeps its claims for up to an hour - the site
    verifies tokens without `checkRevoked` - and the refresh token behind it
    would go on minting new ones. Revoking the latter is what makes the loss
    real within the hour rather than whenever the person signs out.

    A failure does not stop the run: the claims are already changed, and the
    receipt and the history still have to say so. It is shouted instead, and
    written into the history line, because no later run will retry it - by
    then the account matches its nomination and is only stamped."""
    try:
        ctx.accounts.revoke_refresh_tokens(uid)
    except Exception as error:  # noqa: BLE001 - shouted and recorded below
        print("!" * 72)
        print(
            f"!!! Lost {', '.join(lost)}, but revoking the sessions of {uid} "
            f"failed: {error}\n"
            "!!! Revoke them by hand (auth.revoke_refresh_tokens) - no later run "
            "will."
        )
        print("!" * 72)
        return False
    print(f"Lost {', '.join(lost)}: refresh tokens revoked.")
    return True


def apply_change(
    ctx: Context,
    account: Account,
    doc: Mapping[str, Any],
    desired: Role,
    target: dict[str, bool],
    live: dict[str, Any],
) -> Outcome:
    uid = account.uid
    try:
        ctx.accounts.set_claims(uid, target)
    except Exception as error:  # noqa: BLE001 - recorded and shown, run goes on
        print(f"Firebase Auth refused the change: {error}")
        record_error(ctx, uid, f"Firebase Auth nie przyjął zmiany: {error}")
        return "failed"
    ctx.forget(uid)

    lost = lost_claims(live, target)
    revoked = revoke(ctx, uid, lost) if lost else None

    at = iso(ctx.now())
    update: dict[str, Any] = {"applied": receipt(ctx, desired, at), "applyError": None}
    if target.get("newAdmin") and not live.get("newAdmin"):
        update["trialStartedAt"] = at  # the trial begins with this change
    else:
        update.update(trial_start(ctx, doc, desired, at))
    action: dict[str, Any] = {
        "kind": "apply",
        "target": uid,
        "by": ctx.actor,
        "at": at,
        "from": role_from_claims(live).current(),
        "to": desired.state(),
    }
    if revoked is not None:
        action["detail"] = (
            f"Unieważniono sesje (odebrane: {', '.join(lost)})."
            if revoked
            else f"Odebrane: {', '.join(lost)}. Sesji NIE unieważniono."
        )
    writes = [
        Write("update", NOMINATIONS, uid, update),
        Write("merge", USERS, uid, {"claimsChangedAt": SERVER_TIMESTAMP}),
        Write("set", USER_ACTIONS, None, action),
    ]
    try:
        ctx.store.commit(writes)
    except Exception as error:  # noqa: BLE001 - the claims are already changed
        print("!" * 72)
        print(
            f"!!! The claims of {uid} ARE changed, but recording it failed: {error}\n"
            "!!! The next run will stamp the receipt; the history line and the\n"
            "!!! refresh hint are lost."
        )
        print("!" * 72)
    print(f"Applied: {describe_role(desired)}.")
    print(f"Mail: {queue_role_changed_mail(ctx, account, desired, at)}")
    return "applied"


# ---------------------------------------------------------------------------
# The mail


#: The copy shared with `renderNotification` in frontend/shared/notifications.ts.
ROLE_CHANGED = "roleChanged"
ROLE_CHANGED_SUBJECT = "Zmiana Twoich uprawnień na koryta.pl"


def render_role_changed(role: str, site_url: str) -> dict[str, str]:
    settings = f"{site_url.rstrip('/')}/profil"
    paragraphs = [
        "Dzień dobry,",
        f"Twoje uprawnienia na koryta.pl się zmieniły. Teraz: {role}.",
        "Jeśli masz otwartą stronę, odświeży uprawnienia sama w ciągu kilku "
        "sekund. Jeśli menu się nie zmieni, wyloguj się i zaloguj ponownie.",
    ]
    link = html.escape(settings)
    return {
        "subject": ROLE_CHANGED_SUBJECT,
        "text": "\n\n".join([*paragraphs, f"Ustawienia powiadomień: {settings}"]),
        "html": "\n".join(
            [f"<p>{html.escape(p, quote=False)}</p>" for p in paragraphs]
            + [f'<p>Ustawienia powiadomień: <a href="{link}">{link}</a></p>']
        ),
    }


def mail_doc_id(uid: str, applied_at: str) -> str:
    """One message per change: the same change re-run cannot mail twice, and
    the id says what it was about when read in the console."""
    compact = applied_at.replace("-", "").replace(":", "").replace(".", "")
    return f"{ROLE_CHANGED}_{uid}_{compact}"


def queue_role_changed_mail(
    ctx: Context, account: Account, desired: Role, applied_at: str
) -> str:
    """Tells the person their role changed. Never raises: the change is made,
    and a mail that failed to queue undoes nothing.

    An unverified address is never written to - anybody can open an account
    under anybody's address - and `users/{uid}.notifications.roleChanged` set
    to false switches it off. Unset means on: it is about something done to
    the reader's own account, like the review notifications."""
    try:
        if not account.email:
            return "no address"
        if not account.email_verified:
            return "address not verified, not sent"
        preferences = ctx.store.notification_preferences(account.uid)
        if preferences.get(ROLE_CHANGED) is False:
            return "switched off on /profil, not sent"
        doc = {
            "to": [account.email],
            "message": render_role_changed(describe_role(desired), ctx.site_url),
            # Not read by the extension; here so a failed delivery can be
            # traced to what triggered it.
            "kind": ROLE_CHANGED,
            "uid": account.uid,
            "created_at": ctx.now(),
        }
        # `create`: the extension re-sends a document whose `delivery` is
        # missing, and overwriting a delivered one would strip it.
        write = Write("create", MAIL, mail_doc_id(account.uid, applied_at), doc)
        return "queued" if ctx.store.commit([write]) else "already queued"
    except Exception as error:  # noqa: BLE001 - a courtesy, never the change
        return f"failed to queue: {error}"


# ---------------------------------------------------------------------------
# Runs


def print_unnominated(
    accounts: Iterable[Account], nominations: Mapping[str, Any]
) -> None:
    """Claim holders the script will not touch, because nobody nominated them.

    Listed, not acted on: before `--seed` that is every administrator, and
    after it, somebody given a claim by hand in the console."""
    holders = [
        a for a in accounts if a.uid not in nominations and any(a.claims.values())
    ]
    print()
    print(f"Accounts holding claims with no nomination document ({len(holders)}):")
    for a in sorted(holders, key=lambda a: a.uid):
        robot = " (robot)" if is_robot(a.uid) else ""
        print(f"  {a.uid}  {a.display_name!r}  {a.email!r}  {sorted(a.claims)}{robot}")


def nomination_order(item: tuple[str, Mapping[str, Any]]) -> tuple[str, str]:
    uid, doc = item
    return (str((doc.get("desired") or {}).get("at", "")), uid)


def apply_all(ctx: Context) -> int:
    nominations = ctx.store.nominations()
    outcomes: Counter[str] = Counter()
    for uid, _ in sorted(nominations.items(), key=nomination_order):
        outcomes[process(ctx, uid)] += 1
    print_unnominated(ctx.accounts.all(), nominations)
    print()
    print(
        f"{len(nominations)} nominations: "
        + (", ".join(f"{n} {k}" for k, n in sorted(outcomes.items())) or "nothing")
    )
    if ctx.dry_run:
        to_do = outcomes["pending"] + outcomes["refused"] + outcomes["stamped"]
        return 1 if to_do else 0
    return 0


def report(ctx: Context) -> int:
    """The three things a run leaves alone, read-only."""
    accounts = list(ctx.accounts.all())
    nominations = ctx.store.nominations()
    by_uid = {a.uid: a for a in accounts}

    print_unnominated([a for a in accounts if not is_robot(a.uid)], nominations)

    gone = sorted(uid for uid in nominations if uid not in by_uid)
    print()
    print(f"Nomination documents whose account is gone ({len(gone)}):")
    for uid in gone:
        desired = nominations[uid].get("desired") or {}
        print(f"  {uid}  wanted {desired.get('level')!r} by {desired.get('by')!r}")

    robots = sorted(
        {a.uid for a in accounts if is_robot(a.uid)}
        | {u for u in nominations if is_robot(u)}
    )
    print()
    print(f"Robots: pipeline and migration accounts ({len(robots)}):")
    for uid in robots:
        a = by_uid.get(uid)
        claims = sorted(a.claims) if a else "no account"
        nominated = ", nominated (refused on apply)" if uid in nominations else ""
        print(f"  {uid}  claims {claims}{nominated}")
    return 0


def run(args: argparse.Namespace, ctx: Context) -> int:
    if args.report:
        return report(ctx)
    if args.seed:
        # One-time, and deleted together with the table it reads.
        import set_auth_claims_legacy  # noqa: PLC0415

        return set_auth_claims_legacy.seed(ctx)
    return apply_all(ctx)


# ---------------------------------------------------------------------------
# Entry point


class UsageError(Exception):
    pass


@dataclass(frozen=True)
class Target:
    project: str
    emulator: bool
    site_url: str


def resolve_target(*, yes: bool) -> Target:
    """Production, or the dev stack's emulators - never half of each."""
    firestore_host = bool(os.environ.get("FIRESTORE_EMULATOR_HOST"))
    auth_host = bool(os.environ.get("FIREBASE_AUTH_EMULATOR_HOST"))
    if firestore_host != auth_host:
        raise UsageError(
            "Only one of FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST "
            "is set: that would apply production nominations to emulator "
            "accounts, or the other way round. Set both or neither."
        )
    if yes and not firestore_host:
        raise UsageError(
            "--yes answers for the owner, so it only runs against the "
            "emulators (FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST)."
        )
    if firestore_host:
        return Target(emulator_project(), emulator=True, site_url=EMULATOR_SITE_URL)
    return Target(PROJECT_ID, emulator=False, site_url=SITE_URL)


def connect(target: Target) -> tuple[Accounts, Store]:
    """Auth through firebase_admin, Firestore through the Cloud client - which
    picks application default credentials in production and anonymous ones
    against the emulator, where firebase_admin's own client would demand ADC."""
    from google.cloud import firestore  # noqa: PLC0415

    app = firebase_admin.initialize_app(
        options={"projectId": target.project}, name="set_auth_claims"
    )
    client = firestore.Client(project=target.project, database=DATABASE)
    return FirebaseAccounts(app), FirestoreStore(client)


def ask(prompt: str) -> bool:
    try:
        return input(prompt).strip().lower() == "y"
    except EOFError:
        return False


def answer_yes(prompt: str) -> bool:
    print(f"{prompt}y (--yes)")
    return True


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="set_auth_claims",
        description="Apply the roles nominated on /admin/uzytkownicy.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--report",
        action="store_true",
        help="list claim holders without a document, documents without an "
        "account, and robots; change nothing",
    )
    mode.add_argument(
        "--seed",
        action="store_true",
        help="once: write a document with the live state for every claim "
        "holder that has none",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="write nothing, ask nothing; exit 1 if a run would do anything",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="answer y to every question; emulators only",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        target = resolve_target(yes=args.yes)
    except UsageError as error:
        print(error, file=sys.stderr)
        return 2
    where = f"the emulators ({target.project})" if target.emulator else target.project
    print(f"Project: {where}, database {DATABASE}")
    accounts, store = connect(target)
    ctx = Context(
        accounts=accounts,
        store=store,
        confirm=answer_yes if args.yes else ask,
        now=lambda: datetime.now(UTC),
        site_url=target.site_url,
        actor=ACTOR_PREFIX + socket.gethostname(),
        dry_run=args.dry_run,
    )
    return run(args, ctx)
