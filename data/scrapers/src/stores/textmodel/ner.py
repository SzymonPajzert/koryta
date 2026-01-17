import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List

import spacy
import stanza  # type: ignore
from transformers import AutoModelForTokenClassification, AutoTokenizer, pipeline


@dataclass
class NEREntities:
    personalia: List[str] = field(default_factory=list)
    locations: List[str] = field(default_factory=list)
    organizations: List[str] = field(default_factory=list)

class HerbertNERClient:
    
    _pipeline = None

    def __init__(self):
        self.model_checkpoint = "pczarnik/herbert-base-ner"
        self.model_dir = Path("models") / "herbert-base-ner"
        
    def _get_pipeline(self):
        if self._pipeline is None:
            if not Path(self.model_dir).is_dir():
                
                print(f"Loading model from {self.model_checkpoint}...")
                tokenizer = AutoTokenizer.from_pretrained(self.model_checkpoint)
                model = AutoModelForTokenClassification.from_pretrained(self.model_checkpoint) # noqa: E501
                tokenizer.save_pretrained(self.model_dir)
                model.save_pretrained(self.model_dir)
            else:
                print(f"Loading model from {self.model_dir}...")
                tokenizer = AutoTokenizer.from_pretrained(self.model_dir)
                model = AutoModelForTokenClassification.from_pretrained(self.model_dir)
            
            HerbertNERClient._pipeline = pipeline("ner", model=model, 
                                                  tokenizer=tokenizer)
            print("Model has been loaded")
        
        return HerbertNERClient._pipeline
            

    def extract_raw_entities(self, text: str) -> List[dict]:
        """Extract all entities from given text"""

        ner_pipeline = self._get_pipeline()
        return ner_pipeline(text)
        
    def group_entities(self, ner_output: List[dict]) -> dict:
        """Group NERs withing three categories: PER, LOC, ORG"""

        entities: Dict[str, List[str]] = {
            'PER': [],
            'LOC': [],
            'ORG': []
        }
    
        current_entity: list[str] = []
        current_type = None
        
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

    def fix_spacing_full_names(self, full_name: str) -> str:
        """Remove unnecessary spacing"""

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

    def parse_entities(self, text: str) -> NEREntities:
        """Combined logic of extracting, cleaning and parsing NER entities"""
        entities_herbert = self.extract_raw_entities(text)
        grouped_entities = self.group_entities(entities_herbert)
        personalia = [self.fix_spacing_full_names(pers) for pers in grouped_entities.get('PER',[])]
        locations = [self.fix_spacing_full_names(loc) for loc in grouped_entities.get('LOC',[])]
        organizations = [self.fix_spacing_full_names(org) for org in grouped_entities.get('ORG',[])]
        return NEREntities(personalia, locations, organizations)

        
class StanzaNERClient:
    
    _nlp_stanza = None

    def __init__(self):
        self.model_dir = Path("models") / "stanza"

    def _get_model(self):
        if self._nlp_stanza is None:
            if not (Path(self.model_dir) / 'pl').is_dir():
                print(f'Model is downloaded from external resource to location {self.model_dir}') # noqa: E501
                stanza.download('pl', model_dir=str(self.model_dir))
            else:
                print(f'Model already exists in location: {self.model_dir}')

            StanzaNERClient._nlp_stanza = stanza.Pipeline('pl', processors='tokenize,ner', # noqa: E501
                                                           dir = str(self.model_dir))
            print("Model has been loaded")
        
        return StanzaNERClient._nlp_stanza

    def extract_raw_entities(self, text: str):
        """Extract all entities from given text"""

        ner_model = self._get_model()
        return ner_model(text)


    def filter_entities(self, document, pos_type: str):
        """Filter entities with pos_type: persName, placeName or orgName"""

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

    def parse_entities(self, text: str) -> NEREntities:
        """Combined logic of extracting, cleaning and parsing NER entities"""
        stanza_entities = self.extract_raw_entities(text)
        personalia = self.filter_entities(stanza_entities, 'persName')
        locations = self.filter_entities(stanza_entities, 'placeName')
        organizations = self.filter_entities(stanza_entities, 'orgName')
        return NEREntities(personalia, locations, organizations)

    
class SpacyUtils:

    _nlp_spacy = None
    
    def _get_nlp_spacy(self):
        if self._nlp_spacy is None:
            print('Loading spacy NLP...')
            SpacyUtils._nlp_spacy = spacy.load("pl_core_news_lg")

        return SpacyUtils._nlp_spacy

    def lemmatize_name(self, name: str) -> str:
        """Return the basic form of given name"""

        nlp_spacy = self._get_nlp_spacy()
        doc = nlp_spacy(name)
        lemmatized = [token.lemma_ for token in doc]
        return " ".join(lemmatized)

    def lemmatize_names(self, names: List[str]) -> List[str]:
        """Return the basic forms of a list of names"""
        
        nlp_spacy = self._get_nlp_spacy()
        docs = nlp_spacy.pipe(names)
        lemmatized = []
        for doc in docs:
            lemmatized.append(" ".join([token.lemma_ for token in doc]))
            
        return lemmatized

