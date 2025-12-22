import os
import re
from transformers import AutoTokenizer, AutoModelForTokenClassification, pipeline
import spacy
nlp_spacy = spacy.load("pl_core_news_lg")

class HerbertNERClient:
    
    _pipeline = None
    _nlp_spacy = None

    def __init__(self):
        self.model_checkpoint = "pczarnik/herbert-base-ner"
        self.model_dir = os.path.join("models","herbert-base-ner")
        
    def _get_pipeline(self):
        if self._pipeline is None:
            if not os.path.isdir(self.model_dir):
                
                print(f"Loading model from {self.model_checkpoint}...")
                tokenizer = AutoTokenizer.from_pretrained(self.model_checkpoint)
                model = AutoModelForTokenClassification.from_pretrained(self.model_checkpoint)
                tokenizer.save_pretrained(self.model_dir)
                model.save_pretrained(self.model_dir)
            else:
                print(f"Loading model from {self.model_dir}...")
                tokenizer = AutoTokenizer.from_pretrained(self.model_dir)
                model = AutoModelForTokenClassification.from_pretrained(self.model_dir)
            
            HerbertNERClient._pipeline = pipeline("ner", model=model, tokenizer=tokenizer)
            print("Model has been loaded")
        
        return HerbertNERClient._pipeline

    def _get_nlp_spacy(self):
        if self._nlp_spacy is None:
            print('Loading spacy NLP...')
            HerbertNERClient._nlp_spacy = spacy.load("pl_core_news_lg")

        return HerbertNERClient._nlp_spacy
            

    def extract_entities(self, text):
        ner_pipeline = self._get_pipeline()
        return ner_pipeline(text)
        
    def group_entities(self, ner_output):
        entities = {
            'PER': [],
            'LOC': [],
            'ORG': []
        }
    
        current_entity = []
        # current_type = None
        
        for token in ner_output:
            tag = token['entity']
            word = token['word'].replace('</w>', ' ')
    
            if tag.startswith('B-'):
                if current_entity and current_type:
                    entities[current_type].append(''.join(current_entity))
                current_type = tag[2:]
                current_entity = [word]
    
            elif tag.startswith('I-') and current_type == tag[2:]:
                current_entity.append(word)
    
            else:
                if current_entity and current_type:
                    entities[current_type].append(''.join(current_entity))
                current_entity = []
                current_type = None
        
            if current_entity and current_type:
                entities[current_type].append(''.join(current_entity))
        
            return entities

    def fix_spacing_full_names(self, full_name):
        # tokenize string
        tokens = re.findall(r'\b\w+\b', full_name)
    
        if not tokens:
            return full_name
    
        result = tokens[0]
        for token in tokens[1:]:
            if token[0].isupper():
                result += ' ' + token
            else:
                result += token 
    
        return result.strip()

    def lemmatize_name_spacy(self, name):
        nlp_spacy = self._get_nlp_spacy()
        doc = nlp_spacy(name)
        lemmatized = [token.lemma_ for token in doc]
        return " ".join(lemmatized)

        

