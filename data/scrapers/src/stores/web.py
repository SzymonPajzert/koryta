from typing import Any
from urllib.robotparser import RobotFileParser

from scrapers.stores import Context, DownloadableFile, Web

robot_parsers = {}

class WebImpl(Web):
    def robot_txt_allowed(self, ctx: Context, url: str, parsed_url: Any, user_agent: str) -> bool:
        """
        Checks if we are allowed to fetch a URL according to the site's robots.txt.
        Caches the parsed robots.txt file for efficiency.
        """
        robots_url = f"{parsed_url.domain}/robots.txt"
        if parsed_url.domain not in robot_parsers:
            parser = RobotFileParser()
            # We fetch robots.txt using ctx.io to avoid direct network I/O in scrapers if possible,
            # but RobotFileParser usually fetches itself.
            # However, RobotFileParser.parse(lines) allows parsing content.
            # So we can fetch content using ctx.io and parse it.
            
            try:
                # We use DownloadableFile to fetch robots.txt
                # But read_data returns a File, we need content.
                # read_content returns str or bytes.
                # parser.parse expects list of lines.
                content = ctx.io.read_data(DownloadableFile(robots_url)).read_content()
                if isinstance(content, bytes):
                    content = content.decode("utf-8")
                
                parser.parse(content.splitlines())
                robot_parsers[parsed_url.domain] = parser
            except Exception as e:
                print(f"Could not read robots.txt for {parsed_url.domain}: {e}")
                # If we can't read robots.txt, it's safer to assume we can't fetch.
                return False

        return robot_parsers[parsed_url.domain].can_fetch(user_agent, url)
