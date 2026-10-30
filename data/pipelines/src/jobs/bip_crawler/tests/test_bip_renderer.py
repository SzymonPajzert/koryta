"""The headless renderer, against a fake Playwright: it says at once when no
browser starts, answers every render, and never leaves a walk waiting."""

from __future__ import annotations

import sys
import time
import types

import pytest

from jobs.bip_crawler.render import Renderer, RendererDown


def fake_playwright(monkeypatch, *, launch_error=None, failing=()):
    class Response:
        status = 200

    class Page:
        url = ""

        def on(self, event, handler):
            self.handler = handler

        def goto(self, url, wait_until, timeout):
            if any(bad in url for bad in failing):
                raise RuntimeError("net::ERR_CONNECTION_RESET")
            for kind, address in (
                ("document", url),
                ("script", "https://u1.pl/main.js"),
            ):
                self.handler(types.SimpleNamespace(url=address, resource_type=kind))
            self.url = url
            return Response()

        def wait_for_load_state(self, state, timeout):
            pass

        def content(self):
            return "<html><body><a href='/om'>Oświadczenia</a></body></html>"

        def close(self):
            pass

    class Browser:
        def new_context(self, user_agent):
            return types.SimpleNamespace(new_page=Page)

        def close(self):
            pass

    class Chromium:
        def launch(self, **options):
            if launch_error is not None:
                raise launch_error
            return Browser()

    class Session:
        def __enter__(self):
            return types.SimpleNamespace(chromium=Chromium())

        def __exit__(self, *exc):
            return False

    module = types.ModuleType("playwright.sync_api")
    module.sync_playwright = Session  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "playwright.sync_api", module)


def test_a_browser_that_cannot_start_is_said_at_once(monkeypatch):
    fake_playwright(monkeypatch, launch_error=RuntimeError("Executable doesn't exist"))
    started = time.monotonic()
    with pytest.raises(RendererDown, match="Executable doesn't exist"):
        Renderer("ua", workers=2, start_timeout_s=5)
    assert time.monotonic() - started < 5


def test_every_render_is_answered_and_counts_its_requests(monkeypatch):
    fake_playwright(monkeypatch, failing=("bad",))
    renderer = Renderer("ua", workers=1, start_timeout_s=5)
    try:
        bad, asked = renderer.render("https://u1.pl/bad")
        assert not bad.ok and "ERR_CONNECTION_RESET" in bad.error
        good, asked = renderer.render("https://u1.pl/")
        assert good.ok and b"/om" in good.content
        assert asked == 1  # its script; the page itself is paid for by the walk
        _, asked = renderer.render("https://u1.pl/om")
        assert asked == 0  # the script again: the browser has it cached
    finally:
        renderer.close()


def test_a_stopped_renderer_answers_at_once(monkeypatch):
    fake_playwright(monkeypatch)
    renderer = Renderer("ua", workers=1, start_timeout_s=5)
    renderer.close()
    started = time.monotonic()
    result, _ = renderer.render("https://u1.pl/")
    assert not result.ok and result.error == "renderer not running"
    assert time.monotonic() - started < 1
