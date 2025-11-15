"""This file contains abstract definition of store functionality, to use in the scrapers"""


def insert_into(v):
    raise NotImplementedError


def always_export(func):
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        finally:
            dump_dbs()

    return wrapper


def dump_dbs(tables_to_dump: None | dict[str, list[str]] = None):
    raise NotImplementedError()
