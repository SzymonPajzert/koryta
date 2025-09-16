import duckdb

hostname_config = duckdb.read_json("./versioned/hostname_config.jsonl")
request_logs = duckdb.read_json("./versioned/request_logs.jsonl")
website_index = duckdb.read_json("./versioned/website_index.jsonl")

last_requested = duckdb.sql(
    """
    SELECT domain_id, MAX(time)
    FROM request_logs JOIN website_index ON website_index.id = request_logs.website_id
    GROUP BY domain_id
    """
)

# def decide_if_scrape():
#     dont_remove = set()
#     for domain, urls in awaiting_decision.items():
#         response = input_with_timeout(
#             f"Should I crawl [{domain}]? [b] - block, [g] - good, [y] - approve - http://{domain}"
#         )
#         if response == "y":
#             hostname_config[domain] = "approved"
#         elif response == "g":
#             hostname_config[domain] = "good"
#         elif response == "b":
#             hostname_config[domain] = "block"
#             print(f"Skipping {domain}")
#             continue
#         else:
#             dont_remove.add(domain)

#         for url in urls:
#             pages_to_visit.add(url)

#     remove = set(awaiting_decision.keys()) - dont_remove
#     for domain in remove:
#         del awaiting_decision[domain]
