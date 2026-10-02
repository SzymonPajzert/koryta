"""How a run signs in to koryta.pl's ingest endpoints.

`/api/ingest/*` takes a Firebase id token carrying the `datascience` claim, and
only Firebase Auth issues one. `token_source` picks how this run gets it, the
first that applies winning:

1. `KORYTA_ID_TOKEN`: a token somebody already holds, used as it is. It lasts
   an hour and nothing here can renew it, which suits a test against the
   emulator or a short hand run - and is why `refresh` refuses rather than
   handing the same token back.
2. `KORYTA_PIPELINE_UID`: the run is a robot with an account of its own. The
   service account it runs as mints a custom token for that uid with the claim
   in it, and Firebase Auth exchanges that for an id token with
   `FIREBASE_WEB_API_KEY` - the two calls the capture extractor makes
   (`service/koryta_api.py`), for its reason: a service account cannot present
   an id token, but it can sign a custom one. Signing needs
   `roles/iam.serviceAccountTokenCreator` on the account itself
   (jobs/CLOUD_RUN.md). The uid has to contain "pipeline", which is how the
   site tells a robot's revisions from a person's (`isPipelineUid` in
   frontend/shared/stats.ts): a daily import filing a few thousand under any
   other uid reads as somebody's very busy week in the statistics of work
   people did.
3. Otherwise somebody is at the keyboard, and signs in through the browser
   (`stores.auth.authenticate_user`).

No source asks for a token before the first request needs one, so a preview,
or a local score upload that writes through the Admin SDK, signs in to nothing.
"""

import os
import time
from collections.abc import Callable, Mapping
from typing import Any, Protocol

import firebase_admin
import requests
from firebase_admin import auth

from entities.person import is_pipeline_uid
from stores.auth import authenticate_user

#: How long an id token lasts when the exchange does not say.
TOKEN_LIFETIME_S = 3600
#: Renewed this long before it runs out, so that no request sets off on a
#: token that expires on the way - the capture extractor's margin.
REFRESH_MARGIN_S = 300
#: One small request; half a minute without an answer is an outage, not a slow day.
EXCHANGE_TIMEOUT_S = 30
#: What makes the token good for the ingest (`requireDatascience`).
CLAIMS = {"datascience": True}


class TokenError(RuntimeError):
    """No token can be had this way, or no new one."""


class TokenSource(Protocol):
    #: Who the run signs in as, for the log.
    who: str
    #: Whether getting a token means asking somebody at the keyboard.
    interactive: bool

    def token(self) -> str:
        """A token good for the next request."""
        ...

    def refresh(self) -> str:
        """A new token, the one in hand having been refused."""
        ...


class StaticToken:
    """`KORYTA_ID_TOKEN`, as given."""

    who = "KORYTA_ID_TOKEN"
    interactive = False

    def __init__(self, token: str):
        self._token = token

    def token(self) -> str:
        return self._token

    def refresh(self) -> str:
        raise TokenError(
            "The site refused KORYTA_ID_TOKEN, and a token handed in cannot be "
            "renewed: id tokens last an hour. Set a fresh one, or unset it to "
            "sign in through the browser."
        )


class PipelineAccount:
    """An id token for `uid`, minted by the service account the run is.

    Kept until shortly before it expires, then minted again: an upload of a few
    thousand people outlasts the hour one token is good for.
    """

    interactive = False

    def __init__(
        self,
        uid: str,
        api_key: str,
        *,
        mint: Callable[[str, Mapping[str, Any]], str] | None = None,
        session: Any | None = None,
        clock: Callable[[], float] = time.time,
    ):
        if not is_pipeline_uid(uid):
            raise TokenError(
                f"KORYTA_PIPELINE_UID={uid!r} does not contain 'pipeline', so the "
                "site would count every revision this run files as a person's work."
            )
        self.uid = uid
        self.who = f"pipeline uid {uid}"
        self._api_key = api_key
        self._mint = mint or mint_custom_token
        self._session = session if session is not None else requests.Session()
        self._clock = clock
        self._token: str | None = None
        self._expires_at = 0.0

    def token(self) -> str:
        if self._token is None or self._clock() >= self._expires_at - REFRESH_MARGIN_S:
            return self.refresh()
        return self._token

    def refresh(self) -> str:
        # Taken before the exchange, so a slow answer shortens the token's life
        # here rather than outliving it.
        asked_at = self._clock()
        custom_token = self._mint(self.uid, CLAIMS)
        response = self._session.post(
            identity_toolkit_url("v1/accounts:signInWithCustomToken"),
            params={"key": self._api_key},
            json={"token": custom_token, "returnSecureToken": True},
            timeout=EXCHANGE_TIMEOUT_S,
        )
        if not response.ok:
            raise TokenError(
                f"Firebase Auth would not exchange {self.uid}'s custom token: "
                f"{response.status_code} {' '.join(response.text.split())[:300]}"
            )
        body = response.json()
        self._token = str(body["idToken"])
        self._expires_at = asked_at + float(body.get("expiresIn") or TOKEN_LIFETIME_S)
        return self._token


class BrowserLogin:
    """Whoever is at the keyboard, signing in through the site's /cli-login."""

    who = "whoever signs in through the browser"
    interactive = True

    def __init__(self, endpoint: str, login: Callable[[str], str] | None = None):
        self.endpoint = endpoint
        self._login = login
        self._token: str | None = None

    def token(self) -> str:
        if self._token is None:
            return self.refresh()
        return self._token

    def refresh(self) -> str:
        # Looked up here rather than bound as a default, so a test can swap it.
        login = self._login or authenticate_user
        self._token = login(self.endpoint)
        return self._token


def identity_toolkit_url(path: str) -> str:
    """Where to exchange a custom token, production or emulator.

    The same few lines as `identity_toolkit_url` in `service/koryta_api.py`,
    which `stores` may not import - see its docstring for why the exchange has
    to follow `FIREBASE_AUTH_EMULATOR_HOST` when `firebase_admin` already does.
    """
    host = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST")
    if not host:
        return f"https://identitytoolkit.googleapis.com/{path}"
    # The variable is a bare host:port; the emulator speaks http.
    origin = host if "://" in host else f"http://{host}"
    return f"{origin.rstrip('/')}/identitytoolkit.googleapis.com/{path}"


def mint_custom_token(uid: str, claims: Mapping[str, Any]) -> str:
    """A custom token for `uid` carrying `claims`, signed as this run's account.

    Without a key file `firebase_admin` signs through the IAM API, as the
    capture extractor does. With `FIREBASE_AUTH_EMULATOR_HOST` set it signs
    nothing, and only the emulator will take the result.
    """
    try:
        app = firebase_admin.get_app()
    except ValueError:
        app = firebase_admin.initialize_app()
    token = auth.create_custom_token(uid, dict(claims), app=app)
    return token.decode("utf-8") if isinstance(token, bytes) else str(token)


def token_source(endpoint: str) -> TokenSource:
    """How this run gets its tokens; see the module doc for the order.

    Raises for a source that is chosen but cannot work, before anything is
    built - a job that finds out at its first upload has spent an hour on
    payloads for nothing.
    """
    static = os.environ.get("KORYTA_ID_TOKEN", "").strip()
    if static:
        return StaticToken(static)
    uid = os.environ.get("KORYTA_PIPELINE_UID", "").strip()
    if uid:
        api_key = os.environ.get("FIREBASE_WEB_API_KEY", "").strip()
        if not api_key:
            raise TokenError(
                f"KORYTA_PIPELINE_UID is set, so this run signs in as {uid}, and "
                "exchanging its custom token for an id token needs "
                "FIREBASE_WEB_API_KEY - the web key in frontend/nuxt.config.ts."
            )
        return PipelineAccount(uid, api_key)
    return BrowserLogin(endpoint)
