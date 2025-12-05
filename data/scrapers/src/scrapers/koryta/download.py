"""
This module contains pipelines for downloading and processing data from
Firestore, specifically focusing on 'nodes' and 'edges' collections
to extract and structure information about people and articles.

It defines two main pipelines:
- `process_people`: Extracts `Person` entities from Firestore's 'nodes' collection.
- `process_articles`: Extracts `Article` entities and identifies mentioned people
  within them by processing 'edges' data from Firestore.
"""

import typing
from collections import Counter

from tqdm import tqdm

from entities.article import Article
from entities.person import Koryta as Person
from entities.util import NormalizedParse
from scrapers.stores import Context, FirestoreCollection, PipelineModel


def list_people(ctx: Context) -> typing.Generator[Person, None, None]:
    """
    Lists and yields `Person` entities from the Firestore 'nodes' collection.

    Args:
        ctx: The scraper context, providing I/O access to Firestore.

    Yields:
        `Person` objects, representing individuals with their full name, party, and ID.
    """
    for person_doc in tqdm(
        ctx.io.read_data(
            FirestoreCollection("nodes", filters=[("type", "==", "person")])
        ).read_iterable()
    ):
        id = person_doc.id
        person_data = person_doc.to_dict()
        assert person_data is not None
        yield Person(
            full_name=person_data.get("name", ""),
            party=person_data.get("parties", [None])[0],
            id=id,
        )


class KorytaPeople(PipelineModel):
    filename: str = "person_koryta"
    nodes_collection: FirestoreCollection = FirestoreCollection(
        "nodes", filters=[("type", "==", "person")]
    )

    def process(self, ctx: Context):
        """
        Pipeline to process and output `Person` entities.

        It iterates through people listed in Firestore and outputs each as a
        `Person` entity using the context's I/O.
        """
        print("Processing people from Firestore...")
        for person in list_people(ctx):
            ctx.io.output_entity(person)
        print("Finished processing people.")


class KorytaArticles(PipelineModel):
    filename: str = "article_article"
    nodes_collection: FirestoreCollection = FirestoreCollection(
        "nodes", filters=[("type", "==", "article")]
    )
    edges_collection: FirestoreCollection = FirestoreCollection("edges", stream=True)

    def process(self, ctx: Context):
        """
        Pipeline to process `Article` entities and link them to mentioned people.

        This function fetches both people and article nodes from Firestore,
        then iterates through 'mentions' edges to enrich article data with
        mentioned individuals. It also calculates website popularity and outputs
        `Article` entities.
        """
        print("Processing articles and mentions from Firestore...")
        people = {person.id: person for person in list_people(ctx)}
        articles = {
            article.doc_id: article.to_dict()  # Assuming doc_id exists on the returned object
            for article in ctx.io.read_data(
                self.nodes_collection
            ).read_iterable()
        }

        # Enrich articles with mentioned people
        for edge_doc in tqdm(
            ctx.io.read_data(self.edges_collection).read_iterable()
        ):
            edge = edge_doc.to_dict()
            assert edge is not None
            if (
                edge["type"] == "mentions"
                and edge["source"] in articles
                and edge["target"] in people
            ):
                article = articles[edge["source"]]
                mentions = article.get("mentioned", [])
                mentions.append(people[edge["target"]])
                article["mentioned"] = mentions

        website_popularity = Counter()
        for key, article in articles.items():
            if "sourceURL" in article:
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

        print("\nWebsite Popularity (most common domains):")
        for domain, count in website_popularity.most_common(5):
            print(f"- {domain}: {count}")
        print("Finished processing articles.")
