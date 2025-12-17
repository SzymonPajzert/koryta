import json

from google.cloud import storage


def fix_name(name: str) -> str:
    # Fixes names with badly escaped front slash characters between suorce and method
    # gs://koryta-pl-external-raw/source=this/is/url/method=detailed/year=2025/month=08/day=31/240487.json
    # Into
    # gs://koryta-pl-external-raw/source=this-is-url/method=detailed/year=2025/month=08/day=31/240487.json

    substring = name.split("method=")[1].split("/year")[0]
    return name.replace(substring, substring.replace("/", "-"))


def convert_bucket_files_to_jsonl(source_bucket: str, destination_bucket: str):
    """
    Iterates through all .json files in a GCS bucket, reads them,
    and overwrites them in a compact, single-line JSONL format.

    Args:
        bucket_name (str): The name of the GCS bucket to process.
    """
    print(
        f"--- Starting conversion for bucket: {source_bucket} to {destination_bucket}--"
    )

    try:
        storage_client = storage.Client()
        source = storage_client.bucket(source_bucket)
        destination = storage_client.bucket(destination_bucket)

        # Use an iterator to handle potentially large buckets efficiently.
        # To test on a subfolder first, use: list_blobs(prefix="source=krs/")
        blobs = source.list_blobs(prefix="source=rejestr-io")

        processed_count = 0
        error_count = 0
        skipped_count = 0

        for source_blob in blobs:
            # Only process files that end with .json to avoid touching other files
            if not source_blob.name.lower().endswith(".json"):
                skipped_count += 1
                continue

            print(f"Processing: gs://{source_bucket}/{source_blob.name}")

            file = f"file: {source_blob.name}"
            try:
                # Specify UTF-8 encoding for Polish characters
                original_content = source_blob.download_as_text(encoding="utf-8")
                data = json.loads(original_content)
                destination_blob = destination.blob(fix_name(source_blob.name))

                # 3. Convert back to a compact, single-line string
                # ensure_ascii=False is crucial for Polish characters
                jsonl_content = json.dumps(data, ensure_ascii=False)

                # 4. Overwrite the blob with the new content
                destination_blob.upload_from_string(
                    jsonl_content,
                    content_type="application/json",
                )
                print(f"Saved:      gs://{destination_bucket}/{destination_blob.name}")

                processed_count += 1

            except json.JSONDecodeError:
                print(f"  [ERROR] Failed to parse JSON for {file}. Skipping")
                error_count += 1
            except Exception as e:
                print(
                    f"  [ERROR] An unexpected error occurred with {file}: {e}. Skipping"
                )
                error_count += 1

        print("\n--- Conversion Complete ---")
        print(f"Successfully processed: {processed_count} files")
        print(f"Skipped (not .json): {skipped_count} files")
        print(f"Errors (failed to parse): {error_count} files")

    except Exception as e:
        print(f"A critical error occurred: {e}")


# --- HOW TO RUN ---
if __name__ == "__main__":
    SOURCE_BUCKET = "koryta-pl-external-raw"
    DESTINATION_BUCKET = "koryta-pl-external-raw-duplicate"
    convert_bucket_files_to_jsonl(SOURCE_BUCKET, DESTINATION_BUCKET)
