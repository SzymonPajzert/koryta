"""Talking to koryta.pl as the extractor.

`/api/ingest/extraction` wants a Firebase id token carrying the `datascience`
claim, which is a thing only Firebase Auth can issue. A service account cannot
present one directly, but it can mint a *custom* token for a uid of its own
choosing — claims included — and exchange that for an id token. Two calls, no
new authentication path on the endpoint, and the facts arrive over exactly the
route the nightly uploader uses.

Signing the custom token needs `roles/iam.serviceAccountTokenCreator` on the
service's own service account; without a key file firebase_admin signs through
the IAM API. See README-service.md.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

import firebase_admin
import requests
from firebase_admin import auth

from service.config import Config

_TOKEN_LIFETIME_S = 3600
# Refresh early rather than discover expiry mid-request.
_TOKEN_REFRESH_MARGIN_S = 300

logger = logging.getLogger(__name__)


@dataclass
class _CachedToken:
    value: str
    expires_at: float


class KorytaClient:
    def __init__(self, config: Config) -> None:
        self.config = config
        self._session = requests.Session()
        self._token: _CachedToken | None = None
        if not firebase_admin._apps:
            firebase_admin.initialize_app()

    def _id_token(self) -> str:
        now = time.time()
        if self._token and self._token.expires_at - _TOKEN_REFRESH_MARGIN_S > now:
            return self._token.value

        # Developer claims on a custom token are carried into the id token that
        # is exchanged for it, which is how this service ends up in the
        # datascience group without anyone provisioning a password for it.
        custom_token = auth.create_custom_token(
            self.config.extractor_uid, {"datascience": True}
        )
        response = self._session.post(
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken",
            params={"key": self.config.firebase_api_key},
            json={
                "token": custom_token.decode("utf-8"),
                "returnSecureToken": True,
            },
            timeout=30,
        )
        response.raise_for_status()
        id_token = response.json()["idToken"]
        self._token = _CachedToken(id_token, now + _TOKEN_LIFETIME_S)
        return id_token

    def submit_extraction(
        self,
        article: dict[str, Any],
        uploader_uid: str,
    ) -> int:
        """Posts one article's facts, and returns how many were stored.

        Same payload shape as `uploader.py --type extraction`, one article
        instead of a batch — deliberately, so there is one endpoint contract to
        keep working rather than two.
        """
        facts = article.get("extracted_facts") or []
        if not facts:
            return 0

        response = self._session.post(
            f"{self.config.koryta_url}/api/ingest/extraction",
            json={"articles": [article], "uploaderUid": uploader_uid},
            headers={"Authorization": f"Bearer {self._id_token()}"},
            timeout=120,
        )
        if not response.ok:
            raise RuntimeError(
                f"ingest/extraction returned {response.status_code}: "
                f"{response.text[:500]}"
            )
        return int(response.json().get("count") or 0)
