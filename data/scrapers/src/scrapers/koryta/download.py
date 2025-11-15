from tqdm import tqdm
from collections import Counter

from stores.firestore import firestore_db
from stores.duckdb import always_export, register_table, insert_into
from util.url import NormalizedParse

from entities.article import Article
from entities.person import Koryta as Person

register_table(Person)
register_table(Article)


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
            insert_into(
                Article(
                    id=key,
                    title=article.get("name", ""),
                    url=article.get("sourceURL", ""),
                    mentioned_person=person.full_name,
                )
            )

    print(website_popularity.most_common(None))
