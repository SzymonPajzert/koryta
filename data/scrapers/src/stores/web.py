from typing import Any
from urllib.robotparser import RobotFileParser

from curl_cffi import requests as cffi_requests

from scrapers.stores import Context, Web

robot_parsers: dict[str, RobotFileParser | None] = {}


class WebImpl(Web):
    def robot_txt_allowed(
        self, ctx: Context, url: str, parsed_url: Any, user_agent: str
    ) -> bool:
        """
        Checks if we are allowed to fetch a URL according to the site's robots.txt.
        Caches the parsed robots.txt file per domain for efficiency.
        """
        cache_key = parsed_url.hostname_normalized
        if cache_key not in robot_parsers:
            parser = RobotFileParser()
            robots_url = f"https://{parsed_url.hostname_normalized}/robots.txt"
            try:
                # Use curl_cffi so anti-bot sites don't 403 the robots.txt fetch.
                # RobotFileParser.parse(lines) allows parsing pre-fetched content.
                resp = cffi_requests.get(
                    robots_url,
                    impersonate="chrome136",
                    headers={"User-Agent": user_agent},
                    timeout=10,
                )
                resp.raise_for_status()
                parser.parse(resp.text.splitlines())
                robot_parsers[cache_key] = parser
            except Exception as e:
                print(f"Could not read robots.txt for {cache_key}: {e}")
                # Cache None so we don't retry the fetch for every queued URL.
                # None means robots.txt unavailable → disallow.
                robot_parsers[cache_key] = None

        cached = robot_parsers[cache_key]
        if cached is None:
            return False
        return cached.can_fetch(user_agent, url)
