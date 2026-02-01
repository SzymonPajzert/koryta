import re

import dedupe
from unidecode import unidecode


class DedupeClient:
    _gazetteer = None

    def __init__(self):
        self.settings_file = "data/gazetteer_settings"

    def _get_gazetteer(self):
        print("Reading from existing settings", self.settings_file)
        with open(self.settings_file, "rb") as sf:
            DedupeClient._gazetteer = dedupe.StaticGazetteer(sf)

        return DedupeClient._gazetteer

    def _preprocess_text(self, text: str):
        text = unidecode(text)
        text = re.sub("  +", " ", text)
        text = re.sub("\n", " ", text)
        text = text.strip().strip('"').strip("'").lower().strip()
        return text
        
    def _prepare_data(self, data):
        return  {
                k: {'full': self._preprocess_text(v)} 
                for k, v in data.items()
            }

        

    def messy_canon_match(self, data_canon, data_messy, threshold=0.3, n_matches=3, generator = False):
        gazetteer = self._get_gazetteer()
        data_canon_processed = self._prepare_data(data_canon)
        data_messy_processed = self._prepare_data(data_messy)
        
        gazetteer.index(data_canon_processed)
        results = gazetteer.search(data_messy_processed, threshold=threshold,n_matches=n_matches, generator=generator)

        return results