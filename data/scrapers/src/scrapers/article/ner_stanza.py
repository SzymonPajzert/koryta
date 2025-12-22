import os

import spacy
import stanza


class StanzaNERClient:
    _nlp_stanza = None
    _nlp_spacy = None

    def __init__(self):
        self.model_dir = os.path.join('models','stanza')

    def _get_model(self):
        if self._nlp_stanza is None:
            if not os.path.isdir(os.path.join(self.model_dir,'pl')):
                print(f'Model is downloaded from external resource to location {self.model_dir}') # noqa: E501
                stanza.download('pl', model_dir=self.model_dir)
            else:
                print(f'Model already exists in location: {self.model_dir}')

            StanzaNERClient._nlp_stanza = stanza.Pipeline('pl', processors='tokenize,ner',
                                                           dir = self.model_dir)
            print("Model has been loaded")
        
        return StanzaNERClient._nlp_stanza

    def _get_nlp_spacy(self):
        if self._nlp_spacy is None:
            print('Loading spacy NLP...')
            StanzaNERClient._nlp_spacy = spacy.load("pl_core_news_lg")

        return StanzaNERClient._nlp_spacy

    def extract_entities(self, text):
        ner_model = self._get_model()
        return ner_model(text)


    def filter_entities(self, document, pos_type):
    #persName, orgName, placeName
        findings = []
        current = []
    
        for sentence in document.sentences:
            for token in sentence.tokens:
                ner_tag = token.ner
                text = token.text
    
                if ner_tag == f'B-{pos_type}':
                    current.append(text)
                elif ner_tag == f'I-{pos_type}':
                    current.append(text)
                elif ner_tag == f'E-{pos_type}':
                    current.append(text)
                    full = ' '.join(current)
                    findings.append(full)
                    current = []
                elif ner_tag == f'S-{pos_type}':
                    findings.append(text)
    
        return findings

    def lemmatize_name_spacy(self, name):
        nlp_spacy = self._get_nlp_spacy()
        doc = nlp_spacy(name)
        lemmatized = [token.lemma_ for token in doc]
        return " ".join(lemmatized)