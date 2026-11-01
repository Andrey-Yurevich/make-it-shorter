#!/usr/bin/env python3
"""Writes the Chrome Web Store listing (name, short and full description) for the store
locales the extension does not have yet, one locale at a time, each in a fresh Claude
session. A copy of localize-listing.py with its own locale list.

    python3 scripts/localize-listing-missing.py all
    python3 scripts/localize-listing-missing.py bg,hr

The script only starts Claude. What Claude does is in listing/prompt.md: it writes the
locale's messages.json and a short report in listing/<locale>.md. When Claude fails,
usually on the usage limit, the script waits and starts the same locale again, so a run
left alone in a terminal gets through the limit by itself.

Semrush out of API units or without a subscription is a different failure: Claude would
carry on and write the listing without keywords, and only the owner can clear it, by
fixing the connector. The script stops Claude as soon as Semrush answers so, and starts
the same locale again every 10 minutes, with no limit on attempts, until Semrush works.

Several runs of the script may work at once on different locales; the prompt tells
Claude so.

While Claude works, the script prints every step it takes: the tool and the file, command
or report it is used on. A step can take minutes of writing with no tool call (the full
description goes into messages.json in one edit), so during such a stretch it prints a
line every 30 seconds with how much has been written. Lines keep coming while Claude is
alive; minutes without one mean it is stuck.
"""
import json
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES_DIR = ROOT / "apps/extension/public/_locales"
PROMPT = ROOT / "listing/prompt.md"

MODEL = "opus"
RETRY_MINUTES = 20
SEMRUSH_RETRY_MINUTES = 10
MAX_ATTEMPTS = 24
QUIET_SECONDS = 30

# Semrush error codes that only the owner can clear. A Semrush error is a JSON object in
# the tool's result; rate_limit is not here, it passes and Claude retries the call.
SEMRUSH_LIMIT = re.compile(r'"code"\s*:\s*"(no_api_units|no_subscription)"')

# locale -> (language, market, Semrush database). These are the Chrome Web Store locales
# the listing does not have yet; none of them is a priority market in
# assets/listing-translation-notes.md, so the name stays English everywhere.
LANGUAGES = {
    "es_419": ("Latin American Spanish", "Latin America", None),
    "bg": ("Bulgarian", "Bulgaria", None),
    "ca": ("Catalan", "Catalonia", None),
    "et": ("Estonian", "Estonia", None),
    "hr": ("Croatian", "Croatia", None),
    "lt": ("Lithuanian", "Lithuania", None),
    "lv": ("Latvian", "Latvia", None),
    "sk": ("Slovak", "Slovakia", None),
    "sl": ("Slovenian", "Slovenia", None),
    "sr": ("Serbian (Cyrillic script)", "Serbia", None),
    "bn": ("Bengali", "Bangladesh", None),
    "fil": ("Filipino", "the Philippines", None),
    "sw": ("Swahili", "Kenya and Tanzania", None),
    "am": ("Amharic", "Ethiopia", None),
    "gu": ("Gujarati", "India", None),
    "kn": ("Kannada", "India", None),
    "ml": ("Malayalam", "India", None),
    "mr": ("Marathi", "India", None),
    "ta": ("Tamil", "India", None),
    "te": ("Telugu", "India", None),
}


def sync_english():
    # The full description is written by hand in assets/long-description.txt; the English
    # catalog carries a copy so that every locale has the same three keys.
    path = LOCALES_DIR / "en/messages.json"
    messages = json.loads(path.read_text())
    long_description = (ROOT / "assets/long-description.txt").read_text().strip()
    messages["storeDesc"] = {"message": long_description}
    text = json.dumps(messages, ensure_ascii=False, indent=2) + "\n"
    # Parallel runs all sync it; rewriting an unchanged file could let one read it empty.
    if path.read_text() != text:
        path.write_text(text)


def describe(tool):
    # One line per tool call: the tool and what it is used on.
    name = tool["name"].replace("mcp__claude_ai_", "")
    args = tool.get("input", {})
    target = args.get("file_path") or args.get("command") or args.get("report") or args.get("description") or ""
    return f"{name} {target}".replace(f"{ROOT}/", "")[:120]


def result_text(content):
    # A tool result is a string or a list of content blocks.
    if isinstance(content, str):
        return content
    return "".join(part.get("text", "") for part in content or [] if isinstance(part, dict))


def run_claude(command, prompt, locale):
    # stream-json reports each event as it happens. stderr is not captured: whatever
    # Claude complains about goes straight to the terminal.
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, cwd=ROOT)
    process.stdin.write(prompt)
    process.stdin.close()

    reply = None
    semrush_limit = None
    semrush_calls = set()
    last_print = time.monotonic()
    written = 0
    for line in process.stdout:
        try:
            event = json.loads(line)
        except ValueError:
            continue
        prefix = f"  {time.strftime('%H:%M:%S')} {locale}"
        if event.get("parent_tool_use_id"):
            prefix += " subagent"

        if event["type"] == "assistant":
            for block in event["message"]["content"]:
                if block["type"] == "tool_use":
                    print(f"{prefix}: {describe(block)}", flush=True)
                    last_print = time.monotonic()
                    written = 0
                    if block["name"].startswith("mcp__claude_ai_Semrush"):
                        semrush_calls.add(block["id"])
        elif event["type"] == "user" and isinstance(event["message"]["content"], list):
            for block in event["message"]["content"]:
                if block.get("type") == "tool_result" and block.get("tool_use_id") in semrush_calls:
                    match = SEMRUSH_LIMIT.search(result_text(block.get("content")))
                    if match:
                        semrush_limit = match.group(1)
        elif event["type"] == "stream_event" and event["event"]["type"] == "content_block_delta":
            # Tokens of thinking, text or a tool's input: Claude is busy, not stuck.
            delta = event["event"]["delta"]
            written += len(delta.get("text") or delta.get("thinking") or delta.get("partial_json") or "")
            # Thinking may arrive without its text, so nothing written yet is still a signal.
            if time.monotonic() - last_print >= QUIET_SECONDS:
                activity = f"writing, {written} characters so far" if written else "thinking"
                print(f"{prefix}: {activity}", flush=True)
                last_print = time.monotonic()
        elif event["type"] == "result":
            reply = event

        if semrush_limit:
            process.kill()
            break

    process.wait()
    return process.returncode, reply, semrush_limit


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
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--allowedTools",
        "Read",
        f"Edit(apps/extension/public/_locales/{locale}/messages.json)",
        f"Edit(listing/{locale}.md)",
        "Bash(node apps/extension/scripts/check-locales.mjs)",
        "mcp__claude_ai_Semrush",
        "Agent",
    ]

    attempt = 1
    while True:
        returncode, reply, semrush_limit = run_claude(command, prompt, locale)
        if semrush_limit:
            # Not an attempt: it lasts until the owner fixes the connector, however long.
            print(f"{locale}: Semrush answered {semrush_limit}, fix the connector; "
                  f"retrying in {SEMRUSH_RETRY_MINUTES} min", flush=True)
            time.sleep(SEMRUSH_RETRY_MINUTES * 60)
            continue
        if returncode == 0 and reply and not reply.get("is_error"):
            print(reply.get("result", "").strip(), flush=True)
            return
        error = reply.get("result", "") if reply else f"exit code {returncode}"
        print(f"{locale}: claude failed: {error}".strip(), flush=True)
        if attempt == MAX_ATTEMPTS:
            raise RuntimeError(f"{locale}: gave up after {MAX_ATTEMPTS} attempts")
        print(f"{locale}: retrying in {RETRY_MINUTES} min ({attempt}/{MAX_ATTEMPTS})", flush=True)
        attempt += 1
        time.sleep(RETRY_MINUTES * 60)


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
            sys.exit(f"{error or 'stopped'}\nto continue: python3 scripts/localize-listing-missing.py {','.join(locales[index:])}")


if __name__ == "__main__":
    main()
