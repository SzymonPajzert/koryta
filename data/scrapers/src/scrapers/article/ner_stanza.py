import stanza
import os
import spacy

class StanzaNERClient:
    _pipeline = None
    _nlp_spacy = None

    def __init__(self):
        self.model_path = os.path.join('models','stanza')

    def _get_pipeline(self):
        if self._nlp_stanza is None:
            if not os.path.isdir(os.path.join(self.model_path,'pl')):
                print(f'Model is downloaded from external resources to location {self.model_path}')
                stanza.download('pl', model_dir=self.model_path)
            else:
                print(f'Model already exists in location: {self.model_path}')

            StanzaNERClient._pipeline = stanza.Pipeline('pl', processors='tokenize,ner', dir = self.model_path)
            print("Model has been loaded")
        
        return StanzaNERClient._pipeline

    def _get_nlp_spacy(self):
        if self._nlp_spacy is None:
            print('Loading spacy NLP...')
            StanzaNERClient._nlp_spacy = spacy.load("pl_core_news_lg")

        return StanzaNERClient._nlp_spacy

    def extract_entities(self, text):
        pipeline = self._get_pipeline()
        return pipeline(text)


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
                    current_name = []
                elif ner_tag == f'S-{pos_type}':
                    findings.append(text)
    
        return findings

    def lemmatize_name_spacy(self, name):
        nlp_spacy = self._get_nlp_spacy()
        doc = nlp_spacy(name)
        lemmatized = [token.lemma_ for token in doc]
        return " ".join(lemmatized)