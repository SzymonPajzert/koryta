import os
import glob
import os
import sys

_current_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(os.path.dirname(_current_dir))

VERSIONED_DIR = os.path.join(_project_root, "versioned")
DOWNLOADED_DIR = os.path.join(_project_root, "downloaded")

HINTS = {
    "people_wiki.jsonl": "poetry run scrape_wiki",
    "people_krs.jsonl": "poetry run scrape_krs  # requires access to Google bucket koryta-pl-crawled",
}


class Accessor:
    path: str

    def __init__(self, path):
        self.path = path

    def get_path(self, filename):
        return os.path.join(VERSIONED_DIR, filename)

    def assert_path(self, filename):
        p = self.get_path(filename)
        if os.path.exists(p):
            return p
        else:
            print(f"{filename} is missing.")
            if filename in HINTS:
                print(HINTS[filename])
            else:
                print("No hint found for this filename, add it in the config.py")
            sys.exit(1)

    def exists(self, filename):
        return len(glob.glob(os.path.join(VERSIONED_DIR, filename))) > 0


versioned = Accessor(VERSIONED_DIR)
