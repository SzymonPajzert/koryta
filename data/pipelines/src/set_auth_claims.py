# This file sets custom claims in firebase of specified user IDs

from enum import IntEnum

import firebase_admin
from firebase_admin import auth
from firebase_admin.auth import UserRecord


class Level(IntEnum):
    UNKNOWN = 0
    NORMAL = 1
    TRUSTED = 2
    DATASCIENCE = 3
    ADMIN = 4


def get_custom_claims_dict(level: Level):
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


def dict_diff(d1, d2):
    if d1 is None:
        d1 = {}
    if d2 is None:
        d2 = {}
    d1_keys = set(d1.keys())
    d2_keys = set(d2.keys())
    shared_keys = d1_keys.intersection(d2_keys)
    added = d1_keys - d2_keys
    removed = d2_keys - d1_keys
    modified = {o: (d1[o], d2[o]) for o in shared_keys if d1[o] != d2[o]}

    return f"Added: {added}\nRemoved: {removed}\nModified: {modified}"


ROLE_LEVELS = {
    "of0BKlwqWLX21Cuml4NMHZ18xoC3": Level.ADMIN,
    "REdyYP4uvMSgCEjdSoiEHqy360G3": Level.ADMIN,
    "8DomV5BlwlgPI9iLSDA2wHk168h1": Level.ADMIN,
    "7bu9zrX4OzVrrq1atEF7vsehea52": Level.ADMIN,
    "9YY314GDLUauY92yNpjdgYL2ONr2": Level.ADMIN,
    "6tieFsnlz0g4kzT4nb5QFMBvTBx2": Level.ADMIN,
    "WpuDVVsjUpOVOoCbnCfzIve2xMh1": Level.ADMIN,
}

# Administrators on trial. They hold `admin` like any other, plus `newAdmin`,
# which only the activity feed reads (and /admin, to hide the link to it from
# them): established administrators (admin without
# newAdmin) can filter the feed to what these did under "Nowi administratorzy",
# while they themselves get the contributor view of it, as if not admins.
#
# Ending a trial:
# - to make them a regular administrator, remove the uid from here and run the
#   script, which drops `newAdmin` and keeps the rest.
# - to take admin away, set their level in ROLE_LEVELS to Level.NORMAL and run
#   the script. Do not delete their line instead: the script only visits
#   ROLE_LEVELS, so the claims they hold now, admin included, would stay.
NEW_ADMINS = {
    "8DomV5BlwlgPI9iLSDA2wHk168h1",
    "7bu9zrX4OzVrrq1atEF7vsehea52",
    "9YY314GDLUauY92yNpjdgYL2ONr2",
    "6tieFsnlz0g4kzT4nb5QFMBvTBx2",
    "WpuDVVsjUpOVOoCbnCfzIve2xMh1",
}

PROJECT_ID = "koryta-pl"


def get_claims(uid: str, level: Level) -> dict:
    """The whole claims dict `uid` should hold at `level`.

    `set_custom_user_claims` replaces every claim at once, so `newAdmin` has to
    be part of the same dict or each run would drop it. It means nothing
    without `admin`, so it is left out, with a warning, at any other level.
    """
    claims = get_custom_claims_dict(level)
    if uid in NEW_ADMINS:
        if level == Level.ADMIN:
            claims["newAdmin"] = True
        else:
            print(
                f"Warning: {uid} is in NEW_ADMINS but its level is {level.name}, "
                "not ADMIN - not marking it as a new admin."
            )
    return claims


def main():
    options = {
        "projectId": PROJECT_ID,
    }
    firebase_admin.initialize_app(options=options)

    for uid in NEW_ADMINS - ROLE_LEVELS.keys():
        print(
            f"Warning: {uid} is in NEW_ADMINS but not in ROLE_LEVELS, "
            "so its claims are left as they are."
        )

    for uid, level in ROLE_LEVELS.items():
        user: UserRecord = auth.get_user(uid)
        print(
            f"{user.display_name} ({user.email}): current levels: {user.custom_claims}"
        )
        change_to = get_claims(uid, level)
        print(
            f"will set to {level}, \
dict_diff is:\n{dict_diff(change_to, user.custom_claims)}"
        )
        # Print confirmation, wait for y, default N
        confirmation = input("Confirm? (y/N): ")
        if confirmation.lower() != "y":
            print("Skipping...")
            continue

        auth.set_custom_user_claims(uid, change_to)

        # New claims reach a user with their next ID token. Revoking signs a
        # demoted admin out everywhere and lets a `checkRevoked` verification
        # refuse the token they hold now - but frontend/server/utils/auth.ts
        # does not ask for one, so that token keeps passing admin checks until
        # it expires.
        if (user.custom_claims or {}).get("admin") and not change_to.get("admin"):
            auth.revoke_refresh_tokens(uid)
            print(
                "Admin removed and refresh tokens revoked. The ID token they "
                "hold now stays valid for up to an hour."
            )
