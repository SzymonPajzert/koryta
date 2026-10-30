"""Reading the BIPs that draw their pages in JavaScript, in headless Chromium.

Some BIP platforms send every visitor the same empty shell and draw the page
with a script: Madkom's (bip.gminaolawa.pl, bip.dolnyslask.pl, *.nv.pl) answers
4,092 bytes with two links, bip.malopolska.pl's AngularJS app none. The people
mode's walk saw nothing there and ended its units after 1-3 pages: 7 of the
trial's 9 units with no declarations page, 68 units of the list on
bip.malopolska.pl alone. Rendered, bip.malopolska.pl/umwm showed 71 links in
2.2 s (10-29), and the declarations' files are plain links curl downloads.

A render asks the site for more than a fetch does - the page, its scripts and
their API calls - so it reports how many of those went to the page's own host,
and the walk pays a turn of the host's rate for each. Chromium keeps its cache
(no request routing, which would turn it off) and loads no pictures.

Needs the ``render`` dependency group (``playwright``, whose Chromium revision
must be installed: ``.venv/bin/playwright install chromium``). Without it the
walk reads the HTML as it comes, as before.
"""

from __future__ import annotations

import logging
import queue
import threading
from concurrent.futures import Future
from typing import Any

from scrapers.bip.classify import host_of
from scrapers.common.fetch import HttpResult

logger = logging.getLogger(__name__)

#: Chromium without pictures; Ctrl+C and SIGTERM are Python's to handle.
_LAUNCH: dict[str, Any] = {
    "args": ["--blink-settings=imagesEnabled=false"],
    "handle_sigint": False,
    "handle_sigterm": False,
    "handle_sighup": False,
}

#: A render's result and how many requests it made to the page's own host
#: beyond the page itself.
Drawn = tuple[HttpResult, int]
#: Kinds the browser keeps in its cache: a script, style or font costs the site
#: once per browser, though Playwright reports each page's use of it again.
_CACHED = frozenset({"script", "stylesheet", "font", "image", "media", "manifest"})


def available() -> bool:
    """Whether playwright is installed (the ``render`` group)."""
    try:
        import playwright.sync_api  # noqa: F401, PLC0415
    except ImportError:
        return False
    return True


class RendererDown(RuntimeError):
    """No headless browser could start."""


class Renderer:
    """A few threads, each with its own headless Chromium (Playwright's sync API
    belongs to the thread that started it), rendering pages the walk asks for.

    Raises `RendererDown` when no browser starts. A render never waits on a
    browser that is gone: when the last one stops, everything still queued is
    answered with an error, and later renders are answered at once.
    """

    def __init__(
        self,
        user_agent: str,
        *,
        workers: int = 2,
        timeout_s: float = 30.0,
        start_timeout_s: float = 120.0,
    ) -> None:
        if workers < 1:
            raise ValueError("a renderer needs at least one browser")
        self.user_agent = user_agent
        self.timeout_ms = timeout_s * 1000
        self._jobs: queue.Queue[tuple[str, Future[Drawn]] | None] = queue.Queue()
        self._lock = threading.Lock()
        self._live = 0
        started: queue.Queue[str] = queue.Queue()
        self._threads = [
            threading.Thread(
                target=self._serve, args=(started,), name=f"render-{i}", daemon=True
            )
            for i in range(workers)
        ]
        for thread in self._threads:
            thread.start()
        problems = []
        for _ in self._threads:
            try:
                problem = started.get(timeout=start_timeout_s)
            except queue.Empty:
                problem = "a browser did not start in time"
            if problem:
                problems.append(problem)
        with self._lock:
            live = self._live
        if not live:
            self.close()
            raise RendererDown(problems[0] if problems else "no browser started")

    def render(self, url: str) -> Drawn:
        """The page at ``url`` as the browser drew it, or an error result."""
        done: Future[Drawn] = Future()
        with self._lock:
            if not self._live:
                return HttpResult(url, 0, "", b"", "renderer not running"), 0
            self._jobs.put((url, done))
        try:
            # Waits behind the other walks' renders; never longer than this.
            return done.result(timeout=self.timeout_ms / 1000 * 10)
        except TimeoutError:
            return HttpResult(url, 0, "", b"", "renderer did not answer"), 0

    def close(self) -> None:
        for _ in self._threads:
            self._jobs.put(None)
        for thread in self._threads:
            thread.join(timeout=60)

    def _serve(self, started: queue.Queue[str]) -> None:
        counted = False
        try:
            from playwright.sync_api import sync_playwright  # noqa: PLC0415

            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(**_LAUNCH)
                context = browser.new_context(user_agent=self.user_agent)
                fetched: set[str] = set()
                with self._lock:
                    self._live += 1
                    counted = True
                started.put("")
                while (job := self._jobs.get()) is not None:
                    url, done = job
                    try:
                        done.set_result(self._render(context, url, fetched))
                    except BaseException as exc:
                        done.set_result(
                            (HttpResult(url, 0, "", b"", str(exc)[:200]), 0)
                        )
                        raise
                browser.close()
        except BaseException as exc:  # noqa: BLE001 - reported, then the thread ends
            if counted:
                logger.exception("renderer stopped")
            started.put(f"{type(exc).__name__}: {str(exc)[:200]}")
        finally:
            self._stopped(counted)

    def _stopped(self, counted: bool) -> None:
        """One browser fewer; the last one out answers what still waits."""
        with self._lock:
            if counted:
                self._live -= 1
            if self._live:
                return
            while True:
                try:
                    job = self._jobs.get_nowait()
                except queue.Empty:
                    return
                if job is not None:
                    url, done = job
                    done.set_result(
                        (HttpResult(url, 0, "", b"", "renderer stopped"), 0)
                    )

    def _render(self, context: Any, url: str, fetched: set[str]) -> Drawn:
        """``url`` drawn, and the requests it cost its host: the page, its data
        calls, and the scripts and styles this browser had not fetched yet."""
        own = host_of(url)
        asked = 0

        def count(request: Any) -> None:
            nonlocal asked
            if host_of(request.url) != own:
                return
            if request.resource_type in _CACHED:
                if request.url in fetched:
                    return
                fetched.add(request.url)
            asked += 1

        page = None
        try:
            page = context.new_page()
            page.on("request", count)
            response = page.goto(url, wait_until="commit", timeout=self.timeout_ms)
            try:
                page.wait_for_load_state("networkidle", timeout=self.timeout_ms)
            except Exception as exc:  # noqa: BLE001
                # Long polling never goes idle: take what the page drew by then.
                if "Timeout" not in type(exc).__name__:
                    raise
            status = response.status if response is not None else 0
            drawn = HttpResult(
                url=page.url,
                status=status,
                content_type="text/html; charset=utf-8",
                content=page.content().encode("utf-8"),
            )
            return drawn, max(0, asked - 1)
        except Exception as exc:  # noqa: BLE001 - one page's failure is the page's
            return HttpResult(url, 0, "", b"", str(exc)[:200]), max(0, asked - 1)
        finally:
            if page is not None:
                try:
                    page.close()
                except Exception:  # noqa: BLE001, S110 - a dead page needs no closing
                    pass
