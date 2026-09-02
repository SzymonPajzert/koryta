from __future__ import annotations

from typing import Any

from service import people as service_people
from service.people import PersonLookup


class _Doc:
    def __init__(self, doc_id: str, data: dict[str, Any]) -> None:
        self.id = doc_id
        self._data = data

    def to_dict(self) -> dict[str, Any]:
        return self._data


class _Query:
    def __init__(self, docs: list[_Doc], db: "_Db") -> None:
        self._docs = docs
        self._db = db

    def where(self, *args: Any, **kwargs: Any) -> "_Query":
        return self

    def select(self, fields: Any) -> "_Query":
        return self

    def stream(self):
        self._db.streams += 1
        return iter(self._docs)


class _Db:
    """Only the read `PersonLookup` makes."""

    def __init__(self, people: list[tuple[str, str]]) -> None:
        self._docs = [_Doc(pid, {"name": name}) for pid, name in people]
        self.streams = 0

    def collection(self, name: str) -> _Query:
        assert name == "nodes"
        return _Query(self._docs, self)


ARTICLE = (
    "Wczoraj Jan Kowalski zostal prezesem spolki. "
    "Obecna byla takze Anna Nowak, radna miasta."
)


def test_a_person_named_in_the_article_becomes_a_koryta_id():
    db = _Db([("p1", "Jan Kowalski"), ("p2", "Zbigniew Ziobro")])

    match = PersonLookup().match(db, ARTICLE)

    assert match.ids == ("p1",)
    assert match.names == ("Jan Kowalski",)
    # Somebody in the database but not in the article is not a candidate.
    assert "Zbigniew Ziobro" not in match.names


def test_a_name_two_people_share_is_dropped_rather_than_guessed():
    """The batch pipeline separates namesakes with register proof this has
    none of, so picking one would file a stranger's job on a real person."""
    db = _Db([("p1", "Jan Kowalski"), ("p2", " Jan  Kowalski ")])

    match = PersonLookup().match(db, ARTICLE)

    assert match.ids == ()
    assert match.ambiguous == ("Jan Kowalski",)
    # Still worth telling the model a known person is in the text.
    assert "Jan Kowalski" in match.names


def test_the_index_is_built_once_and_reused():
    """A person node read per capture would be ~9k reads a page."""
    db = _Db([("p1", "Jan Kowalski")])
    lookup = PersonLookup()

    lookup.match(db, ARTICLE)
    lookup.match(db, ARTICLE)

    assert db.streams == 1


def test_the_index_is_rebuilt_once_it_goes_stale():
    db = _Db([("p1", "Jan Kowalski")])
    lookup = PersonLookup(ttl_seconds=-1)

    lookup.match(db, ARTICLE)
    lookup.match(db, ARTICLE)

    assert db.streams == 2


def test_an_empty_page_reads_nothing():
    db = _Db([("p1", "Jan Kowalski")])

    assert PersonLookup().match(db, "   ").ids == ()
    assert db.streams == 0


def test_a_failed_lookup_leaves_the_facts_unlinked_rather_than_raising():
    """Losing the whole capture over a Firestore hiccup would be worse than
    submitting the facts the way every capture did before this existed."""

    class _Broken:
        def collection(self, name: str):
            raise RuntimeError("firestore is down")

    assert (
        service_people.match_people(_Broken(), ARTICLE) == service_people.PeopleMatch()
    )
