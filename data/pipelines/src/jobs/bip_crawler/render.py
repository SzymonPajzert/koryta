"""Reading the BIPs that draw their pages in JavaScript, in headless Chromium.

Some BIP platforms send every visitor the same empty shell and draw the page
with a script: Madkom's (bip.gminaolawa.pl, bip.dolnyslask.pl, *.nv.pl) answers
4,092 bytes with two links, bip.malopolska.pl's AngularJS app none. The people
mode's walk saw nothing there and ended its units after 1-3 pages: 7 of the
trial's 9 units with no declarations page, 68 units of the list on
bip.malopolska.pl alone. Rendered, bip.malopolska.pl/umwm showed 106 links in
1.8 s (10-29), and the declarations' files are plain links curl downloads.

Needs the ``render`` dependency group (``playwright``, whose Chromium revision
must be installed: ``.venv/bin/playwright install chromium``). Without it the
walk reads the HTML as it comes, as before.
"""

from __future__ import annotations

import logging
import queue
import threading
from concurrent.futures import Future

from scrapers.common.fetch import HttpResult

logger = logging.getLogger(__name__)

#: What a rendered BIP page needs: its document, scripts and their API calls.
#: Pictures, fonts and styles only cost the site bandwidth.
_SKIPPED = frozenset({"image", "media", "font", "stylesheet"})


def available() -> bool:
    """Whether playwright is installed (the ``render`` group)."""
    try:
        import playwright.sync_api  # noqa: F401, PLC0415
    except ImportError:
        return False
    return True


class Renderer:
    """A few threads, each with its own headless Chromium (Playwright's sync API
    belongs to the thread that started it), rendering pages the walk asks for."""

    def __init__(
        self, user_agent: str, *, workers: int = 2, timeout_s: float = 30.0
    ) -> None:
        self.user_agent = user_agent
        self.timeout_ms = timeout_s * 1000
        self._jobs: queue.Queue[tuple[str, Future[HttpResult]] | None] = queue.Queue()
        self._threads = [
            threading.Thread(target=self._serve, name=f"render-{i}", daemon=True)
            for i in range(workers)
        ]
        for thread in self._threads:
            thread.start()

    def render(self, url: str) -> HttpResult:
        """The page at ``url`` as the browser drew it, or an error result."""
        done: Future[HttpResult] = Future()
        self._jobs.put((url, done))
        try:
            # Waits behind the other walks' renders; a dead pool never answers.
            return done.result(timeout=self.timeout_ms / 1000 * 10)
        except TimeoutError:
            return HttpResult(url, 0, "", b"", "renderer did not answer")

    def close(self) -> None:
        for _ in self._threads:
            self._jobs.put(None)
        for thread in self._threads:
            thread.join(timeout=60)

    def _serve(self) -> None:
        from playwright.sync_api import sync_playwright  # noqa: PLC0415

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch()
                context = browser.new_context(user_agent=self.user_agent)
                context.route(
                    "**/*",
                    lambda route: (
                        route.abort()
                        if route.request.resource_type in _SKIPPED
                        else route.continue_()
                    ),
                )
                while (job := self._jobs.get()) is not None:
                    url, done = job
                    done.set_result(self._render(context, url))
                browser.close()
        except Exception as exc:  # noqa: BLE001 - answer every waiting walk
            logger.exception("renderer stopped")
            while True:
                try:
                    job = self._jobs.get_nowait()
                except queue.Empty:
                    return
                if job is not None:
                    job[1].set_result(HttpResult(job[0], 0, "", b"", str(exc)[:200]))

    def _render(self, context, url: str) -> HttpResult:
        page = context.new_page()
        try:
            try:
                response = page.goto(
                    url, wait_until="networkidle", timeout=self.timeout_ms
                )
            except Exception as exc:  # noqa: BLE001
                # Long polling never goes idle: take what the page drew by then.
                if "Timeout" not in type(exc).__name__:
                    raise
                response = None
            status = response.status if response is not None else 200
            return HttpResult(
                url=page.url,
                status=status,
                content_type="text/html; charset=utf-8",
                content=page.content().encode("utf-8"),
            )
        except Exception as exc:  # noqa: BLE001 - one page's failure is the page's
            return HttpResult(url, 0, "", b"", str(exc)[:200])
        finally:
            page.close()
