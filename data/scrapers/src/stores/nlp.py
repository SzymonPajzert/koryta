from typing import List, Literal, Union, overload

from scrapers.stores import NLP
from stores.textmodel.ner import (
    HerbertNERClient,
    NEREntities,
    SpacyUtils,
    StanzaNERClient,
)

NERModelName = Literal["herbert", "stanza"]


class NLPImpl(NLP):
    """
    NLP toolkit.

    Args:
        ner_model_name: The name of the NER model to use ("herbert" or "stanza").
    """

    def __init__(self, ner_model_name: NERModelName = "stanza"):
        if ner_model_name == "herbert":
            self.ner_client = HerbertNERClient()
        elif ner_model_name == "stanza":
            self.ner_client = StanzaNERClient()

        self.spacy_utils = SpacyUtils()

    def extract_ner_entities(self, text: str) -> NEREntities:
        """Uses the initialized NER model to extract entities from text."""
        return self.ner_client.parse_entities(text)

    @overload
    def lemmatize(self, text_data: str) -> str: ...

    @overload
    def lemmatize(self, text_data: List[str]) -> List[str]: ...

    def lemmatize(self, text_data: Union[str, List[str]]) -> Union[str, List[str]]:
        """
        Lemmatizes input text using spaCy. 
        Allowed data types: string and list of strings.
        Automatically routes the request to single or batch processing 
        based on input type. 
        """
        if isinstance(text_data, str):
            return self.spacy_utils.lemmatize_name(text_data)

        if isinstance(text_data, list):
            return self.spacy_utils.lemmatize_names(text_data)

        raise TypeError("text_data must be either a string or a list of strings")
