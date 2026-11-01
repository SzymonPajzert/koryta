"""The User-Agent each host is asked with: the crawler's own, or a browser's
for the few that keep public declarations from the crawler's name."""

from __future__ import annotations

from jobs.bip_crawler.identity import BROWSER_AGENT, Agents
from jobs.bip_crawler.tests.test_people_mode_review import PDF, Web, html, row, search
from scrapers.common.fetch import HttpResult

OWN = "KorytaBIPCrawler/0.1 (+http://koryta.pl/crawler)"
E_LINE = "91.224.198.130"


def test_an_exception_is_asked_as_a_browser_and_the_rest_as_the_crawler() -> None:
    asked: list[str] = []

    def resolve(host: str) -> str:
        asked.append(host)
        return E_LINE if host == "bip.lubuskie.pl" else "10.0.0.1"

    agents = Agents(OWN, resolve)
    assert agents("bip.lubuskie.pl") == BROWSER_AGENT  # by its server
    assert agents("www.bip.mazovia.pl") == BROWSER_AGENT  # by its name
    assert agents("bip.x.pl") == OWN
    assert agents("bip.lubuskie.pl") == BROWSER_AGENT
    assert asked == ["bip.lubuskie.pl", "bip.x.pl"]  # a server looked up once
    # The name names koryta.pl, and not the word the filter looks for.
    assert "koryta.pl" in BROWSER_AGENT and "crawler" not in BROWSER_AGENT.lower()


class Agent(Web):
    """A site that remembers who asked."""

    def __init__(self, sites: dict) -> None:
        super().__init__(sites)
        self.agents: dict[str, str] = {}

    def fetch(self, url: str, timeout: float, user_agent: str) -> HttpResult:
        self.agents[url] = user_agent
        return super().fetch(url, timeout, user_agent)


def test_the_walk_asks_an_exceptions_pages_and_files_as_a_browser(tmp_path) -> None:
    sites = {
        "https://u1.pl": html(
            "BIP", '<a href="/om">Oświadczenia majątkowe radnych</a>'
        ),
        "https://u1.pl/om": html(
            "Oświadczenia majątkowe",
            '<a href="/f/nowak.pdf">Jan Nowak - oświadczenie majątkowe</a>',
        ),
        "https://u1.pl/f/nowak.pdf": (200, "application/pdf", PDF + b"n"),
        "https://u2.pl": html("BIP", ""),
    }
    web = Agent(sites)
    people, store, _, _ = search(
        tmp_path,
        {},
        [row("n", "u1", "Jan", "Nowak"), row("k", "u2", "Ewa", "Kot")],
        web=web,
        sitemaps=False,
    )
    assert store.outcomes["n"].status == "found"
    # u1 stands for an E-LINE BIP; the default resolve maps a host to itself.
    exceptions = Agents(OWN, lambda host: E_LINE if host == "u1.pl" else host)
    people.agents = exceptions
    assert people.agents("u1.pl") == BROWSER_AGENT
    web.agents.clear()
    people._get("https://u1.pl/f/nowak.pdf")
    people._get("https://u2.pl")
    assert web.agents == {
        "https://u1.pl/f/nowak.pdf": BROWSER_AGENT,
        "https://u2.pl": people.options.user_agent,
    }
    posted: list[str] = []

    def post(url: str, payload: object, timeout: float, ua: str) -> HttpResult:
        posted.append(ua)
        return HttpResult(url, 200, "application/json", b"{}")

    people.post = post
    people._post("https://u1.pl/api", {"id": 1})
    assert posted == [BROWSER_AGENT]
