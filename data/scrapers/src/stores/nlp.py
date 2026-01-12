
from scrapers.stores import NLP
from stores.textmodel.ner import HerbertNERClient, StanzaNERClient


class NLPImpl(NLP):
    def __init__(self):
        self.herbert_ner_client = HerbertNERClient()
        self.stanza_ner_client = StanzaNERClient()

