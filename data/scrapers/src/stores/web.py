from typing import Any
from urllib.robotparser import RobotFileParser

from scrapers.stores import Context, DownloadableFile, Web

robot_parsers = {}


class WebImpl(Web):
    def robot_txt_allowed(
        self, ctx: Context, url: str, parsed_url: Any, user_agent: str
    ) -> bool:
        """
        Checks if we are allowed to fetch a URL according to the site's robots.txt.
        Caches the parsed robots.txt file for efficiency.
        """
        robots_url = f"{parsed_url.domain}/robots.txt"
        if parsed_url.domain not in robot_parsers:
            parser = RobotFileParser(robots_url)
            parser.parse(robots_url)
            robot_parsers[parsed_url.domain] = parser
            # TODO(mpacek) fix robot txt allowed (previously it saved evenrything to one file and there were conflicts)

        return robot_parsers[parsed_url.domain].can_fetch(user_agent, url)
