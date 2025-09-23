import duckdb
from dataclasses import fields
import os
from util.config import VERSIONED_DIR


dbs = []


def dump_dbs(tables_to_dump=None):
    if tables_to_dump is None:
        tables_to_dump = dbs
    for db in tables_to_dump:
        file_path = os.path.join(VERSIONED_DIR, f"{db}.jsonl")
        duckdb.execute(f"COPY {db} TO '{file_path}'")


def ducktable(cls):
    sql_type = {
        int: "INTEGER",
        str: "VARCHAR",
        str | None: "VARCHAR",
        int | None: "INTEGER",
    }

    table_name = cls.__name__.lower()
    dbs.append(table_name)
    table_fields = [f"{field.name} {sql_type[field.type]}" for field in fields(cls)]
    duckdb.execute(f"CREATE TABLE {table_name} ({", ".join(table_fields)})")

    def insert_into(arg):
        assert isinstance(arg, cls), "arg must be an instance of cls"
        field_values = [getattr(arg, field.name) for field in fields(cls)]
        duckdb.execute(
            f"INSERT INTO {table_name} VALUES ({', '.join(['?'] * len(field_values))})",
            field_values,
        )

    setattr(cls, "insert_into", insert_into)
    return cls
