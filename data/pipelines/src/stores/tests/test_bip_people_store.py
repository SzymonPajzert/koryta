"""``bip_poi`` keeps only what the people mode's search found."""

from __future__ import annotations

from stores.bip_people import PostgresBipPeopleStore


class FakePg:
    """Answers each query by a word in it; keeps every statement run."""

    def __init__(self, answers: dict[str, list[tuple]]) -> None:
        self.answers = answers
        self.executed: list[str] = []

    def execute(self, sql: str, params: tuple = ()) -> None:
        self.executed.append(" ".join(sql.split()))

    def fetchall(self, sql: str, params: tuple = ()) -> list[tuple]:
        for word, rows in self.answers.items():
            if word in sql:
                return rows
        return []


def test_a_bip_poi_from_before_takes_new_rows_without_the_list_s_fields():
    old = FakePg({"information_schema.columns": [(1,)]})
    PostgresBipPeopleStore(old)  # type: ignore[arg-type]
    new = FakePg({})
    PostgresBipPeopleStore(new)  # type: ignore[arg-type]

    alter = "ALTER TABLE bip_poi ALTER COLUMN unit SET DEFAULT ''"
    assert alter in old.executed and alter not in new.executed
