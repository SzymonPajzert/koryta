import multiprocessing
import xml.etree.ElementTree as ET

import mwparserfromhell
import pandas as pd
from memoized_property import memoized_property  # type: ignore
from tqdm import tqdm

from scrapers.stores import Context, Pipeline
from scrapers.wiki.process_articles import DUMP_SIZE, WIKI_DUMP, WikiArticle


# TODO https://github.com/SzymonPajzert/koryta/issues/327


def _article_generator(f, tq):
    prev = 0
    for event, elem in ET.iterparse(f, events=("end",)):
        current_pos = f.tell()
        tq.update(current_pos - prev)
        prev = current_pos
        if elem.tag.endswith("page"):
            title = elem.findtext("{http://www.mediawiki.org/xml/export-0.11/}title")
            revision = elem.find("{http://www.mediawiki.org/xml/export-0.11/}revision")
            if title and revision:
                wikitext = revision.findtext("{http://www.mediawiki.org/xml/export-0.11/}text")
                if wikitext:
                    yield (title, wikitext)
            elem.clear()


def _is_person_article_worker(args):
    title, wikitext = args
    try:
        article = WikiArticle.parse_text(title, wikitext)
        if article and article.about_person:
            return article.title
    except Exception:
        return None
    return None


class ProcessWikiPeopleNames(Pipeline):
    filename = "wiki_people_names"

    def process(self, ctx: Context) -> pd.DataFrame:
        person_titles = []
        with (
            ctx.io.read_data(WIKI_DUMP).read_zip().read_file() as f,
            tqdm(total=DUMP_SIZE, unit_scale=True, smoothing=0.1) as tq,
        ):
            article_gen = _article_generator(f, tq)
            with multiprocessing.Pool(processes=multiprocessing.cpu_count()) as pool:
                for title in pool.imap_unordered(
                        _is_person_article_worker, article_gen, chunksize=1000
                ):
                    if title:
                        person_titles.append({"title": title})
        return pd.DataFrame(person_titles)


def _ner_worker(args):
    title, wikitext, people_titles = args
    try:
        article = WikiArticle.parse_text(title, wikitext)
        if not article:
            return None

        text = mwparserfromhell.parse(wikitext).strip_code().strip()
        names = []

        parsed_wikitext = mwparserfromhell.parse(wikitext)
        for link in parsed_wikitext.filter_wikilinks():
            normalized_name = str(link.title).split("#")[0].strip()
            if not normalized_name or normalized_name.isdigit():
                continue

            if normalized_name in people_titles:
                name_in_text = str(link.text).strip() if link.text else normalized_name
                if name_in_text not in text:
                    continue
                mention = {
                    "name_in_text": name_in_text,
                    "name_normalize": normalized_name,
                }
                if mention not in names:
                    names.append(mention)

        if not names:
            return None

        return {"text": text, "names": names}
    except Exception:
        return None


class ProcessWikiNer(Pipeline):
    filename = "person_wikipedia_ner"
    people_names: ProcessWikiPeopleNames

    def process(self, ctx: Context) -> pd.DataFrame:
        people_names_df = self.people_names.read_or_process(ctx)
        people_titles = set(people_names_df["title"])

        dataset = []
        with (
            ctx.io.read_data(WIKI_DUMP).read_zip().read_file() as f,
            tqdm(total=DUMP_SIZE, unit_scale=True, smoothing=0.1) as tq,
        ):
            worker_args = (
                (title, wikitext, people_titles)
                for title, wikitext in _article_generator(f, tq)
            )
            with multiprocessing.Pool(processes=multiprocessing.cpu_count()) as pool:
                for result in pool.imap_unordered(
                        _ner_worker, worker_args, chunksize=100
                ):
                    if result:
                        dataset.append(result)

        return pd.DataFrame(dataset)
