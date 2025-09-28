import os
import glob
import os
import sys

_current_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(os.path.dirname(_current_dir))

VERSIONED_DIR = os.path.join(_project_root, "versioned")
DOWNLOADED_DIR = os.path.join(_project_root, "downloaded")


class Accessor:
    path: str

    def __init__(self, path):
        self.path = path

    def get_path(self, filename):
        return os.path.join(VERSIONED_DIR, filename)

    def assert_path(self, filename):
        try:
            return glob.glob(self.get_path(filename))[0]
        except IndexError:
            print(f"{filename} is missing.")
            sys.exit(1)

    def exists(self, filename):
        return len(glob.glob(os.path.join(VERSIONED_DIR, filename))) > 0


versioned = Accessor(VERSIONED_DIR)
