from datetime import datetime
from zoneinfo import ZoneInfo
from util.url import NormalizedParse
from google.cloud import storage

BUCKET = "koryta-pl-crawled"

warsaw_tz = ZoneInfo("Europe/Warsaw")
now = datetime.now(warsaw_tz)
storage_client = storage.Client()


# TODO why are we discarding query params
def upload_to_gcs(
    source: NormalizedParse | str,
    data,
    content_type,
):
    if isinstance(source, str):
        source = NormalizedParse.parse(source)
    try:
        now = datetime.now(warsaw_tz)
        if source.path == "":
            source.path = "index"
        destination_blob_name = (
            f"hostname={source.hostname}/"
            f"date={now.strftime('%Y')}-{now.strftime('%m')}-{now.strftime('%d')}/"
            f"{source.path}"
        )
        destination_blob_name = destination_blob_name.replace("//", "/")
        destination_blob_name = destination_blob_name.rstrip("/")

        bucket = storage_client.bucket(BUCKET)
        blob = bucket.blob(destination_blob_name)
        # Upload the string data
        blob.upload_from_string(data, content_type=f"{content_type}; charset=utf-8")

        full_path = f"gs://{BUCKET}/{destination_blob_name}"
        print(f"Successfully uploaded data to: {full_path}")

    except Exception as e:
        print(f"An error occurred: {e}")
        return None


def list_blobs(hostname):
    bucket = storage_client.bucket(BUCKET)
    blobs = bucket.list_blobs(prefix=f"hostname={hostname}/")
    for blob in blobs:
        yield blob.name
