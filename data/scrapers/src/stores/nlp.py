
from scrapers.stores import NLP
from stores.textmodel.ner import HerbertNERClient, StanzaNERClient


class NLPImpl(NLP):
    def __init__(self, use_herbert_ner: bool = False, use_stanza_ner: bool = True):
        self.herbert_ner_client: HerbertNERClient | None = None
        self.stanza_ner_client: StanzaNERClient | None = None

        if use_herbert_ner:
            self.herbert_ner_client = HerbertNERClient()
        if use_stanza_ner:
            self.stanza_ner_client = StanzaNERClient()


