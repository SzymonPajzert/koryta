from dataclasses import dataclass
from tqdm import tqdm
from collections import Counter

from stores.firestore import firestore_db
from stores.duckdb import ducktable, dump_dbs
from util.url import NormalizedParse


@ducktable(name="people_koryta")
@dataclass
class Person:
    id: str
    full_name: str
    party: str

    def insert_into(self):
        pass


@ducktable(name="articles_koryta")
@dataclass
class Article:
    id: str
    title: str
    url: str
    mentioned_person: str

    def insert_into(self):
        pass


def always_export(func):
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        finally:
            dump_dbs()

    return wrapper


def list_people():
    people = firestore_db.collection("nodes").where("type", "==", "person").stream()
    for person in tqdm(people):
        id = person.id
        person = person.to_dict()
        assert person is not None
        yield Person(
            full_name=person.get("name", ""),
            party=person.get("parties", [None])[0],
            id=id,
        )


@always_export
def process_people():
    for person in list_people():
        person.insert_into()


@always_export
def process_articles():
    people = {person.id: person for person in list_people()}
    articles = {
        article.id: article.to_dict()
        for article in firestore_db.collection("nodes")
        .where("type", "==", "article")
        .stream()
    }
    for edge in tqdm(firestore_db.collection("edges").stream()):
        edge = edge.to_dict()
        assert edge is not None
        if (
            edge["type"] == "mentions"
            and edge["source"] in articles
            # TODO support listing mentioned companies
            and edge["target"] in people
        ):
            article = articles[edge["source"]]
            mentions = article.get("mentioned", [])
            mentions.append(people[edge["target"]])
            article["mentioned"] = mentions

    website_popularity = Counter()
    for key, article in articles.items():
        domain = NormalizedParse.parse(article["sourceURL"]).hostname_normalized
        website_popularity[domain] += 1

        for person in article.get("mentioned", []):
            art = Article(
                id=key,
                title=article.get("name", ""),
                url=article.get("sourceURL", ""),
                mentioned_person=person.full_name,
            )
            art.insert_into()

    print(website_popularity.most_common(None))
