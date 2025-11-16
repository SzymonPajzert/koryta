from tqdm import tqdm
from collections import Counter

from scrapers.stores import Context, Pipeline
from entities.util import NormalizedParse

from entities.article import Article
from entities.person import Koryta as Person


def list_people(ctx: Context):
    people = ctx.io.read_collection(
        "nodes", stream=True, filters=[("type", "==", "person")]
    )
    for person in tqdm(people):
        id = person.id
        person = person.to_dict()
        assert person is not None
        yield Person(
            full_name=person.get("name", ""),
            party=person.get("parties", [None])[0],
            id=id,
        )


@Pipeline(io="firestore")
def process_people(ctx: Context):
    for person in list_people(ctx):
        person.insert_into()


@Pipeline(io="firestore")
def process_articles(ctx: Context):
    people = {person.id: person for person in list_people(ctx)}
    articles = {
        article.id: article.to_dict()
        for article in ctx.io.read_collection(
            "nodes", stream=True, filters=[("type", "==", "article")]
        )
    }
    for edge in tqdm(ctx.io.read_collection("edges", stream=True)):
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
            ctx.io.output_entity(
                Article(
                    id=key,
                    title=article.get("name", ""),
                    url=article.get("sourceURL", ""),
                    mentioned_person=person.full_name,
                )
            )

    print(website_popularity.most_common(None))
