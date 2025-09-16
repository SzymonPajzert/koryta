import json
from urllib.parse import urlparse
from uuid_extensions import uuid7str

website_ids = dict()

with open("sites_to_crawl.txt", "r") as f:
    request_logs = []

    with open("website_index.jsonl", "w") as website_index:
        # Return URLs, stripping whitespace and ignoring lines starting with #
        for line in f:
            if line.startswith("#"):
                continue

            split = line.strip().split(" # Last crawled: ", 1)
            url = split[0]
            hostname = urlparse(url).hostname

            id = website_ids.get(url, None)
            if not id:
                website_ids[url] = id = uuid7str()
                website = {"id": id, "url": url}
                website_index.write(json.dumps(website, ensure_ascii=False))
                website_index.write("\n")

            processing_time = ""
            if len(split) > 1:
                processing_time = split[1]
                request_logs.append((processing_time, id))

    request_logs.sort(key=lambda x: x[0])
    with open("request_logs.jsonl", "w") as request_logs_file:
        for log in request_logs:
            log = {
                "id": uuid7str(),
                "website_id": log[1],
                "time": log[0],
                "response_code": -1,
                "payload_size_bytes": -1,
                "duration": "",
            }
            request_logs_file.write(json.dumps(log, ensure_ascii=False))
            request_logs_file.write("\n")


def add_website_index(key, value):
    config = dict()
    config["hostname"] = key
    if value == "approved":
        config["allowed"] = True
    if value == "block":
        config["allowed"] = False
    if value == "good":
        config["allowed"] = True
        config["quality"] = "good"
    website_index.write("\n")
