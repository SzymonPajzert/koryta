import os
import sys

import firebase_admin
import requests
from firebase_admin import firestore

from entities.composite import PersonScore


class Firestore:
    def __init__(self, args):
        project_id = getattr(args, "project", None)
        if args.endpoint.startswith("http://localhost"):
            os.environ["FIRESTORE_EMULATOR_HOST"] = "localhost:8080"
            if not project_id:
                try:
                    resp = requests.get("http://127.0.0.1:4000/api/config", timeout=2)
                    if resp.status_code == 200:
                        project_id = resp.json().get("projectId")
                except Exception as e:
                    print(
                        f"Warning: Could not detect emulator project ID: {e}",
                        file=sys.stderr,
                    )
                if not project_id:
                    project_id = "demo-koryta-pl"

        options = {}
        if project_id:
            options["projectId"] = project_id

        try:
            app = firebase_admin.get_app("uploader")
        except ValueError:
            app = firebase_admin.initialize_app(options=options, name="uploader")

        database_id = getattr(args, "database", "koryta-pl")
        self.db = firestore.client(app=app, database_id=database_id)
        self.user_id = "pipeline"

    def submit_score(self, p: dict | PersonScore):
        if isinstance(p, dict):
            p = PersonScore(**p)

        print(
            f"Uploading score {p.score} for {p.name} (nodeId: {p.node_id})...",
            end=" ",
            file=sys.stderr,
        )

        doc_ref = self.db.collection("votes").document(f"{p.node_id}_{self.user_id}")
        doc_ref.set(
            {
                "nodeId": p.node_id,
                "userUid": self.user_id,
                "categoryVotes": {"interesting": p.score},
            },
            merge=True,
        )
        print(f"  OK: {doc_ref.id}", file=sys.stderr)
