import glob
import json
import os
import sys

import pandas as pd

_current_dir = os.path.dirname(os.path.abspath(__file__))

PROJECT_ROOT = os.path.dirname(os.path.dirname(_current_dir))
VERSIONED_DIR = os.path.join(PROJECT_ROOT, "versioned")
DOWNLOADED_DIR = os.path.join(PROJECT_ROOT, "downloaded")
TESTS_DIR = os.path.join(PROJECT_ROOT, "tests")

if not os.path.exists(VERSIONED_DIR):
    os.makedirs(VERSIONED_DIR)
if not os.path.exists(DOWNLOADED_DIR):
    os.makedirs(DOWNLOADED_DIR)


class Accessor:
    path: str

    def __init__(self, path):
        self.path = path

    def get_path(self, filename):
        return os.path.join(self.path, filename)

    def assert_path(self, filename):
        p = self.get_path(filename)
        if os.path.exists(p):
            return p
        else:
            print(f"{p} is missing.")
            sys.exit(1)

    def exists(self, filename):
        return len(glob.glob(os.path.join(self.path, filename))) > 0

    def read_jsonl(self, filename):
        with open(self.assert_path(filename), "r") as f:
            for line in f:
                yield json.loads(line)

    def read_parquet(self, filename):
        return pd.read_parquet(self.assert_path(filename))


versioned = Accessor(VERSIONED_DIR)
tests = Accessor(TESTS_DIR)
downloaded = Accessor(DOWNLOADED_DIR)
