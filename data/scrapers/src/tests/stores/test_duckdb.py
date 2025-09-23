import duckdb
import os
from dataclasses import dataclass
from stores.duckdb import ducktable, dump_dbs

@ducktable
@dataclass
class MyTestTable:
    id: int
    name: str

@ducktable
@dataclass
class MyDumpTestTable:
    id: int
    name: str

def test_ducktable_decorator():
    """Should create a table with the correct schema."""
    result = duckdb.execute("SELECT * FROM MyTestTable").fetchall()
    assert result == []

def test_ducktable_insert_into():
    """Should insert data into the table."""
    duckdb.execute("DELETE FROM MyTestTable")
    item = MyTestTable(id=1, name="test")
    item.insert_into()
    result = duckdb.execute("SELECT * FROM MyTestTable").fetchall()
    assert result == [(1, "test")]

def test_dump_dbs():
    """Should dump the database to a JSONL file."""
    duckdb.execute("DELETE FROM MyDumpTestTable")
    if os.path.exists("./versioned/mydumptesttable.jsonl"):
        os.remove("./versioned/mydumptesttable.jsonl")

    item = MyDumpTestTable(id=2, name="test2")
    item.insert_into()
    dump_dbs(tables_to_dump=["mydumptesttable"])

    assert os.path.exists("./versioned/mydumptesttable.jsonl")
    with open("./versioned/mydumptesttable.jsonl", "r") as f:
        assert f.read() == '{"id":2,"name":"test2"}\n'