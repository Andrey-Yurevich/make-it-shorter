#!/usr/bin/env python3
"""Rewrites the Chrome Web Store listing (name, short and full description) one locale
at a time, each in a fresh Claude session.

    python3 scripts/localize-listing.py all
    python3 scripts/localize-listing.py ru,pl

The script only starts Claude. What Claude does is in listing/prompt.md: it writes the
locale's messages.json and a short report in listing/<locale>.md. When Claude fails,
usually on the usage limit, the script waits and starts the same locale again, so a run
left alone in a terminal gets through the limit by itself.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES_DIR = ROOT / "apps/extension/public/_locales"
PROMPT = ROOT / "listing/prompt.md"

MODEL = "opus"
RETRY_MINUTES = 20
MAX_ATTEMPTS = 24

# locale -> (language, market, Semrush database). A database marks a priority market from
# listing-translation-notes.md: there the name and keywords are chosen from Semrush data.
# Everywhere else the listing is written natively and the name stays English. `all` runs
# them in this order, so the markets that matter are done first.
LANGUAGES = {
    # Paying markets.
    "fr": ("French", "France", "fr"),
    "de": ("German", "Germany", "de"),
    "es": ("Spanish", "Spain", "es"),
    "it": ("Italian", "Italy", "it"),
    "nl": ("Dutch", "the Netherlands", "nl"),
    "sv": ("Swedish", "Sweden", "se"),
    "pt_BR": ("Brazilian Portuguese", "Brazil", "br"),
    "ko": ("Korean", "South Korea", "kr"),
    "ja": ("Japanese", "Japan", "jp"),
    # Many speakers.
    "ru": ("Russian", "Russia", "ru"),
    "ar": ("Arabic", "Saudi Arabia", "sa"),
    "tr": ("Turkish", "Turkey", "tr"),
    "vi": ("Vietnamese", "Vietnam", "vn"),
    # The rest.
    "cs": ("Czech", "Czechia", None),
    "da": ("Danish", "Denmark", None),
    "el": ("Greek", "Greece", None),
    "fa": ("Persian", "Iran", None),
    "fi": ("Finnish", "Finland", None),
    "he": ("Hebrew", "Israel", None),
    "hi": ("Hindi", "India", None),
    "hu": ("Hungarian", "Hungary", None),
    "id": ("Indonesian", "Indonesia", None),
    "ms": ("Malay", "Malaysia", None),
    "pl": ("Polish", "Poland", None),
    "ro": ("Romanian", "Romania", None),
    "th": ("Thai", "Thailand", None),
    "uk": ("Ukrainian", "Ukraine", None),
    "zh_CN": ("Simplified Chinese", "mainland China", None),
    "zh_TW": ("Traditional Chinese", "Taiwan", None),
}


def sync_english():
    # The full description is written by hand in long-description.txt; the English
    # catalog carries a copy so that every locale has the same three keys.
    path = LOCALES_DIR / "en/messages.json"
    messages = json.loads(path.read_text())
    long_description = (ROOT / "long-description.txt").read_text().strip()
    messages["storeDesc"] = {"message": long_description}
    path.write_text(json.dumps(messages, ensure_ascii=False, indent=2) + "\n")


def localize(locale):
    language, market, database = LANGUAGES[locale]
    prompt = PROMPT.read_text()
    for placeholder, value in [
        ("{locale}", locale),
        ("{language}", language),
        ("{market}", market),
        ("{database}", database or "none"),
    ]:
        prompt = prompt.replace(placeholder, value)

    command = [
        "claude", "-p",
        "--model", MODEL,
        "--output-format", "json",
        "--allowedTools",
        "Read",
        f"Edit(apps/extension/public/_locales/{locale}/messages.json)",
        f"Edit(listing/{locale}.md)",
        "Bash(node apps/extension/scripts/check-locales.mjs)",
        "mcp__claude_ai_Semrush",
        "Agent",
    ]

    for attempt in range(1, MAX_ATTEMPTS + 1):
        completed = subprocess.run(command, input=prompt, capture_output=True, text=True, cwd=ROOT)
        try:
            reply = json.loads(completed.stdout)
        except ValueError:
            reply = {"is_error": True, "result": completed.stdout.strip() or completed.stderr.strip()}
        if completed.returncode == 0 and not reply.get("is_error"):
            print(reply.get("result", "").strip(), flush=True)
            return
        print(f"{locale}: claude failed: {reply.get('result', '')}".strip(), flush=True)
        if attempt < MAX_ATTEMPTS:
            print(f"{locale}: retrying in {RETRY_MINUTES} min ({attempt}/{MAX_ATTEMPTS})", flush=True)
            time.sleep(RETRY_MINUTES * 60)
    raise RuntimeError(f"{locale}: gave up after {MAX_ATTEMPTS} attempts")


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    if sys.argv[1] == "all":
        locales = list(LANGUAGES)
    else:
        locales = [locale.strip() for locale in sys.argv[1].split(",") if locale.strip()]
    unknown = [locale for locale in locales if locale not in LANGUAGES]
    if unknown:
        sys.exit(f"unknown locales: {', '.join(unknown)}; known: {', '.join(LANGUAGES)}")

    sync_english()
    for index, locale in enumerate(locales):
        print(f"\n[{index + 1}/{len(locales)}] {locale} {time.strftime('%H:%M')}", flush=True)
        try:
            localize(locale)
        except (KeyboardInterrupt, RuntimeError) as error:
            sys.exit(f"{error or 'stopped'}\nto continue: python3 scripts/localize-listing.py {','.join(locales[index:])}")


if __name__ == "__main__":
    main()
