#!/usr/bin/env python3
"""Run a real Chromium smoke test against the built NAV KURD application."""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

from playwright.sync_api import Error, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
BASE_URL = "http://127.0.0.1:4173"


def wait_for_server(timeout: float = 30.0) -> None:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with urlopen(BASE_URL, timeout=1.5) as response:  # noqa: S310 - local test server only
                if response.status == 200:
                    return
        except Exception as error:  # pragma: no cover - retry loop
            last_error = error
        time.sleep(0.25)
    raise RuntimeError(f"preview server did not become ready: {last_error}")


def main() -> int:
    if not (ROOT / "dist/index.html").is_file():
        raise SystemExit("dist/index.html is missing; run npm run build:vercel first.")

    server = subprocess.Popen(
        ["npm", "run", "preview", "--", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        wait_for_server()
        with sync_playwright() as playwright:
            chromium_path = os.environ.get("CHROMIUM_PATH")
            launch_args = {
                "headless": True,
                "args": ["--disable-dev-shm-usage", "--no-sandbox"],
            }
            if chromium_path:
                launch_args["executable_path"] = chromium_path
            browser = playwright.chromium.launch(**launch_args)
            context = browser.new_context(
                viewport={"width": 390, "height": 844},
                locale="ku",
                permissions=["geolocation"],
                geolocation={"latitude": 36.1911, "longitude": 44.0092},
            )
            page = context.new_page()
            page.add_init_script(
                """
                (() => { localStorage.setItem('nav-kurd:tutorial:completed', '1'); })();
                """
            )
            page_errors: list[str] = []
            local_failures: list[str] = []
            page.on("pageerror", lambda error: page_errors.append(str(error)))

            def track_response(response) -> None:
                if not response.url.startswith(BASE_URL) or response.status < 400:
                    return
                if response.url.rstrip("/").endswith("/favicon.ico"):
                    return
                local_failures.append(
                    f"{response.status} {response.request.resource_type} {response.url}"
                )

            page.on("response", track_response)
            page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
            page.locator("#app").wait_for(state="attached", timeout=10_000)
            page.locator("#map").wait_for(state="visible", timeout=15_000)
            page.locator("#placeSearch").wait_for(state="visible", timeout=15_000)
            assert page.locator("#supportVisitorPrivacyControl").count() == 1
            assert page.locator("#offlineMapPack").count() == 1

            # A direct APK button may only appear when the same-origin signed
            # binary exists and its byte count matches verified release metadata.
            android_release = page.evaluate(
                "async () => (await fetch('/releases/latest.json', { cache: 'no-store' })).json()"
            )
            direct_download = page.locator("#androidDirectDownload")
            if android_release.get("directApkAvailable"):
                direct_download.wait_for(state="attached", timeout=10_000)
                page.wait_for_function(
                    "() => !document.querySelector('#androidDirectDownload')?.hidden",
                    timeout=10_000,
                )
                direct_probe = page.evaluate(
                    """async expected => {
                      const response = await fetch('/downloads/NAV-KURD-9.0.0.apk', {
                        method: 'HEAD', cache: 'no-store', redirect: 'error'
                      });
                      return {
                        ok: response.ok,
                        bytes: Number(response.headers.get('content-length') || 0),
                        expected
                      };
                    }""",
                    android_release.get("apkBytes"),
                )
                if not direct_probe["ok"] or direct_probe["bytes"] != direct_probe["expected"]:
                    raise AssertionError(f"direct APK probe failed: {direct_probe}")
            elif not direct_download.is_hidden():
                raise AssertionError("direct APK button is visible without a verified binary")

            # The language controls belong to the map sheet and are intentionally
            # hidden while the mobile shell is still booting/collapsed. Wait for
            # the actual interactive handoff, then open the sheet exactly as a
            # user would before exercising the compact property path.
            page.locator('.map-shell[data-load-state="ready"]').wait_for(
                state="visible", timeout=45_000
            )
            first_language_button = page.locator('button[data-language="en"]')
            if not first_language_button.is_visible():
                sheet_toggle = page.locator("#sheetToggle")
                sheet_toggle.wait_for(state="visible", timeout=10_000)
                sheet_toggle.click()
                first_language_button.wait_for(state="visible", timeout=10_000)

            # Each language must commit without an aborted request or full-page
            # blocking mask. The sheet stays open for the entire sequence.
            for language in ("en", "ar", "ku"):
                language_button = page.locator(f'button[data-language="{language}"]')
                language_button.wait_for(state="visible", timeout=15_000)
                language_button.click()
                page.wait_for_function(
                    "expected => document.body.dataset.language === expected",
                    arg=language,
                    timeout=30_000,
                )
                page.wait_for_function(
                    "() => !document.querySelector('.map-shell')?.classList.contains('is-language-switching')",
                    timeout=30_000,
                )

            # Follow the visible About → Support flow. The tutorial is disabled
            # only inside this automated context so it cannot cover the controls.
            about_button = page.locator("#brandAboutButton")
            about_button.wait_for(state="visible", timeout=10_000)
            about_button.click()
            page.locator("#aboutDialog").wait_for(state="visible", timeout=10_000)
            support_button = page.locator("#supportButton")
            support_button.wait_for(state="visible", timeout=10_000)
            support_button.click()
            page.locator("#supportSection").wait_for(state="visible", timeout=10_000)
            page.locator("#supportVisitorsFold").evaluate(
                "element => { element.open = true; }"
            )
            privacy_control = page.locator("#supportVisitorPrivacyControl")
            privacy_control.wait_for(state="visible", timeout=10_000)
            page.wait_for_function(
                "() => Boolean(document.querySelector('#supportVisitorPrivacyControl')?.textContent?.trim())",
                timeout=10_000,
            )
            privacy_text = (privacy_control.text_content() or "").strip()
            if not privacy_text:
                raise AssertionError("visitor privacy disclosure is empty")

            page.goto(f"{BASE_URL}/legal/privacy.html?lang=en", wait_until="domcontentloaded", timeout=15_000)
            english_privacy = page.locator('article[data-legal-lang="en"]')
            english_privacy.wait_for(state="visible", timeout=10_000)
            body_text = english_privacy.inner_text()
            if "visible by default" not in body_text.lower() or "UUID" not in body_text:
                raise AssertionError("privacy page is missing the visitor-list disclosure")

            page.goto(f"{BASE_URL}/legal/terms.html", wait_until="domcontentloaded", timeout=15_000)
            if not page.locator("body").inner_text().strip():
                raise AssertionError("terms page is empty")

            # Service worker registration must be possible on localhost. A bounded
            # timeout avoids hiding a broken install lifecycle.
            page.goto(BASE_URL, wait_until="domcontentloaded", timeout=15_000)
            try:
                page.set_default_timeout(15_000)
                service_worker_ready = page.evaluate(
                    """async () => {
                      if (!('serviceWorker' in navigator)) return true;
                      const registration = await navigator.serviceWorker.ready;
                      return Boolean(registration.active);
                    }"""
                )
                if not service_worker_ready:
                    raise AssertionError("service worker registration has no active worker")
                page.reload(wait_until="domcontentloaded", timeout=15_000)
                page.wait_for_function("() => Boolean(navigator.serviceWorker.controller)", timeout=15_000)
                offline_css_status = page.evaluate(
                    "async () => (await fetch('/offline.css', { cache: 'reload' })).status"
                )
                if offline_css_status != 200:
                    raise AssertionError(f"offline.css was not available from the controlled shell: {offline_css_status}")
                context.set_offline(True)
                page.reload(wait_until="domcontentloaded", timeout=15_000)
                offline_body = (page.locator("body").inner_text() or "").strip()
                if not offline_body:
                    raise AssertionError("offline navigation returned an empty document")
                if page.locator("#app").count() == 0 and page.locator("main").count() == 0:
                    raise AssertionError("offline navigation returned neither the app shell nor the offline fallback")
                context.set_offline(False)
            except Error as error:
                raise AssertionError(f"service worker/offline reload failed: {error}") from error

            browser.close()

            ignored_fragments = (
                "ResizeObserver loop",
            )
            fatal_errors = [error for error in page_errors if not any(fragment in error for fragment in ignored_fragments)]
            if local_failures:
                raise AssertionError("same-origin HTTP failures:\n" + "\n".join(local_failures))
            if fatal_errors:
                raise AssertionError("uncaught browser errors:\n" + "\n".join(fatal_errors))

        print("Chromium smoke test passed: shell, map container, support privacy, legal pages and service worker and offline reload.")
        return 0
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
        if server.returncode not in (None, 0, -15):
            output = server.stdout.read() if server.stdout else ""
            print(output, file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
