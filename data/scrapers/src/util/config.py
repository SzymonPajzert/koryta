import os

_current_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(os.path.dirname(_current_dir))
VERSIONED_DIR = os.path.join(_project_root, "versioned")
DOWNLOADED_DIR = os.path.join(_project_root, "downloaded")
