from dataclasses import fields
import os

import duckdb

from util.polish import PkwFormat
from util.config import VERSIONED_DIR
from datetime import datetime


dbs = []
used = dict()


def dump_dbs(tables_to_dump: None | dict[str, list[str]] = None):
    if tables_to_dump is None:
        tables_to_dump = {db: [] for db in dbs}
    for db, sort in tables_to_dump.items():
        if not used.get(db, False):
            continue
        file_path = os.path.join(VERSIONED_DIR, f"{db}.jsonl")
        if len(sort) == 0:
            duckdb.execute(f"COPY {db} TO '{file_path}'")
        else:
            q = f"SELECT * FROM {db} ORDER BY {sort[0]}"
            duckdb.execute(f"COPY ({q}) TO '{file_path}'")


def always_export(func):
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        finally:
            dump_dbs()

    return wrapper


def ducktable(read=False, name=None, excluded_fields=set()):
    def wrapper(cls):
        sql_type = {
            int: "INTEGER",
            str: "VARCHAR",
            str | None: "VARCHAR",
            int | None: "INTEGER",
            bool: "BOOLEAN",
            bool | None: "BOOLEAN",
            datetime: "TIMESTAMP",
            datetime | None: "TIMESTAMP",
            list[str]: "VARCHAR[]",
            PkwFormat: "VARCHAR",
        }

        clsfields = [
            field for field in fields(cls) if field.name not in excluded_fields
        ]

        table_name = name
        if table_name is None:
            table_name = cls.__name__.lower()
        dbs.append(table_name)
        table_fields = [f"{field.name} {sql_type[field.type]}" for field in clsfields]
        if read:
            print(f"Reading table {table_name}...")
            duckdb.execute(
                f"""CREATE TABLE {table_name} AS
                SELECT *
                FROM read_json('{os.path.join(VERSIONED_DIR, table_name +'.jsonl')}')"""
            )
            print(f"Table {table_name} read.")
        else:
            duckdb.execute(f"CREATE TABLE {table_name} ({", ".join(table_fields)})")

        def insert_into(arg):
            assert isinstance(arg, cls), "arg must be an instance of cls"
            field_values = [getattr(arg, field.name) for field in clsfields]
            duckdb.execute(
                f"INSERT INTO {table_name} VALUES ({', '.join(['?'] * len(field_values))})",
                field_values,
            )
            used[table_name] = True

        setattr(cls, "insert_into", insert_into)
        return cls

    return wrapper
