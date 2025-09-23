# save_to_gcs.py

import json
from datetime import datetime
from zoneinfo import ZoneInfo  # Requires Python 3.9+

from google.cloud import storage

BUCKET_NAME = "koryta-pl-external-raw"

warsaw_tz = ZoneInfo("Europe/Warsaw")
now = datetime.now(warsaw_tz)
storage_client = storage.Client()

def upload_json_to_gcs(
    source: str,
    method: str,
    object_id: str,
    json_data: dict,
    verbose=False,
):
    """
    Constructs a Hive-partitioned path and uploads a Python dictionary as a JSON file.

    Args:
        bucket_name (str): The name of your GCS bucket.
        source (str): The data source (e.g., 'krs', 'social_media_creator').
        method (str): The method used for data collection (e.g., 'api_v1', 'profile_scrape').
        object_id (str): A unique identifier for this specific file, e.g. person key or url
        json_data (dict): The Python dictionary to upload.
    """
    try:
        
        destination_blob_name = (
            f"source={source}/"
            f"method={method}/"
            f"year={now.strftime('%Y')}/"
            f"month={now.strftime('%m')}/"
            f"day={now.strftime('%d')}/"
            f"{object_id}.json"
        )

        bucket = storage_client.bucket(BUCKET_NAME)
        blob = bucket.blob(destination_blob_name)
        # Can't be indented, because it needs to be a JSONL file
        data_to_upload = json.dumps(json_data, ensure_ascii=False)
        # Upload the string data
        blob.upload_from_string(
            data_to_upload,
            content_type="application/json"
        )

        full_path = f"gs://{BUCKET_NAME}/{destination_blob_name}"
        if verbose:
            print(f"Successfully uploaded data to: {full_path}")
        return full_path

    except Exception as e:
        print(f"An error occurred: {e}")
        return None