import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { SUMMARY_LANGS, languageName } from "../shared/lang.ts";
import { MAX_INPUT, MIN_INPUT } from "../shared/limits.ts";
import { PANEL_PORT, readPanelMessage, type PanelJob } from "../shared/messaging.ts";
import { TONES, type ErrorCode, type Source, type Tone } from "../shared/protocol.ts";
import {
  getSettings,
  hideRating,
  isRatingHidden,
  saveSettings,
  type Settings,
} from "../shared/storage.ts";
import { activeTab, extractFromTab } from "../shared/tab.ts";
import { countCodePoints } from "../shared/text.ts";
import { shorten } from "./api.ts";
import { OutputBox } from "./components/OutputBox.tsx";
import { Picker } from "./components/Picker.tsx";
import { StarRating } from "./components/StarRating.tsx";
import { Button } from "./components/ui.tsx";
import { initialRunState, runReducer } from "./state.ts";

// One column, top to bottom: the text going in, how to shorten it, the text coming out.
// The panel holds one run — the one on screen — and keeps nothing after it is closed.
//
// Everything the user reads here is an English literal. The panel is not localised: the
// only strings that go through chrome.i18n are the ones Chrome itself draws — the name,
// the description, the context menu item and the icon tooltip.

// One emoji per tone, in front of the name, so the list can be scanned by shape as well
// as read. The order is the order of TONES: the default first, then the rest as the
// product lists them. Every wire value has a label here — the type makes sure of it.
const TONE_LABELS: Record<Tone, string> = {
  original: "📄 Original",
  diplomatic: "🤝 Diplomatic",
  formal: "🎩 Formal",
  professional: "💼 Professional",
  confident: "💪 Confident",
  friendly: "😊 Friendly",
  academic: "🎓 Academic",
  casual: "😎 Casual",
  simplified: "🔤 Simplified",
  bold: "🔥 Bold",
  empathetic: "💛 Empathetic",
  direct: "🎯 Direct",
  luxury: "💎 Luxury",
  persuasive: "🧲 Persuasive",
  engaging: "✨ Engaging",
};

const TONE_OPTIONS = TONES.map((tone) => ({ value: tone, label: TONE_LABELS[tone] }));

export function App() {
  const [run, dispatch] = useReducer(runReducer, initialRunState);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ratingHidden, setRatingHidden] = useState(true);

  // Read inside callbacks that outlive the render they were created in.
  const settingsRef = useRef<Settings | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  // Which run the panel is showing. A click on the floating icon opens a second stream
  // while the first one is still writing, and without this its text would be written
  // into the same field, interleaved with the text of the run that replaced it.
  const runId = useRef(0);

  useEffect(() => {
    void (async () => {
      const loaded = await getSettings();
      settingsRef.current = loaded;
      setSettings(loaded);
      setRatingHidden(await isRatingHidden());
      connect();
    })();
    // Mount only. Everything the callbacks below need afterwards is in refs, so there is
    // nothing here to re-run.
  }, []);

  // The port is the panel's lifetime as far as the service worker is concerned, and it
  // carries the job the worker prepared. A worker restart drops it, so the panel dials
  // back: losing the connection costs at most one extra request.
  function connect(): void {
    const port = chrome.runtime.connect({ name: PANEL_PORT });
    portRef.current = port;
    port.onMessage.addListener((message: unknown) => {
      const job = readPanelMessage(message);
      if (job) {
        handleJob(job);
      }
    });
    port.onDisconnect.addListener(() => {
      portRef.current = null;
      setTimeout(connect, 1000);
    });
  }

  // The message about a page that could not be read disables the button at the bottom,
  // so it must not outlive what it is about: the panel stays open while the user
  // switches tabs and loads pages, and these two events are how it hears about that.
  // Neither needs the `tabs` permission — the tab id arrives without it, and nothing
  // here looks at a url. Adding that permission for this would be paid for in the
  // install warning.
  useEffect(() => {
    const onActivated = (info: chrome.tabs.OnActivatedInfo) => {
      dispatch({ type: "tab-activated", tabId: info.tabId });
    };
    const onUpdated = (tabId: number) => {
      dispatch({ type: "tab-navigated", tabId });
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  // What the worker needs for the "second click on the icon" rule.
  useEffect(() => {
    portRef.current?.postMessage({
      type: "state",
      pageUrl: run.pageUrl,
      hasSummary: run.result !== "",
    });
  }, [run.pageUrl, run.result]);

  // The selection and the whole page arrive the same way and end up in the same place:
  // the input field. After that the difference between them is gone — it is text in a
  // field, and the user can correct it and run it again.
  function handleJob(job: PanelJob): void {
    if (job.kind === "unreadable") {
      dispatch({ type: "unreadable-page", tabId: job.tabId ?? null });
      return;
    }
    load(job.text, job.source, job.truncated, job.pageUrl);
  }

  // Text that came from a page, one way or another. It goes into the field and starts
  // running by itself: clicking the floating icon over a selection is already the user
  // asking for this, and asking them to press Shorten afterwards would be asking twice.
  //
  // Below the minimum nothing is sent — the request would come back too_short — but the
  // text stays in the field, where the user can add to it. Throwing it away would leave
  // them with an empty panel and no idea what happened.
  function load(text: string, source: Source, truncated: boolean, pageUrl?: string): void {
    dispatch({ type: "loaded", text, source, truncated, pageUrl });
    if (countCodePoints(text) >= MIN_INPUT) {
      void start(text, source);
    }
  }

  async function start(text: string, source: Source): Promise<void> {
    const id = ++runId.current;
    dispatch({ type: "start" });
    const current = settingsRef.current ?? (await getSettings());

    await shorten(
      { text, lang: current.lang, tone: current.tone, source },
      {
        onDelta: (chunk) => {
          if (id === runId.current) {
            dispatch({ type: "delta", text: chunk });
          }
        },
        onDone: () => {
          if (id === runId.current) {
            dispatch({ type: "done" });
          }
        },
        onError: (code, message) => {
          if (id === runId.current) {
            dispatch({ type: "error", code, message });
          }
        },
      },
    );
  }

  // The button at the bottom reads the active tab from scratch, every time, whatever is
  // in the field: the point of it is a page whose content has moved on, and the only way
  // to know that it has is to go and read it. The panel does the reading itself rather
  // than asking the worker for it — the worker may be asleep, and a message to a port
  // that is being re-established would be lost with nothing on screen to say so.
  async function readPage(): Promise<void> {
    dispatch({ type: "reading" });

    const tab = await activeTab();
    if (tab?.id === undefined) {
      dispatch({ type: "unreadable-page", tabId: null });
      return;
    }

    const extracted = await extractFromTab(tab.id, "page");
    if (!extracted.ok) {
      dispatch({ type: "unreadable-page", tabId: tab.id });
      return;
    }
    load(extracted.text, "page", extracted.truncated, tab.url);
  }

  async function changeSettings(patch: Partial<Settings>): Promise<void> {
    const updated = { ...(settingsRef.current ?? (await getSettings())), ...patch };
    settingsRef.current = updated;
    setSettings(updated);
    await saveSettings(patch);
  }

  const inputLength = countCodePoints(run.input);
  const canShorten = !run.streaming && inputLength >= MIN_INPUT && inputLength <= MAX_INPUT;
  // Three reasons the page cannot be read right now, and the panel says all three out
  // loud below: a run is in flight (one at a time), the service is switched off (no
  // request goes out until the user asks again), or this very tab has just been read and
  // could not be. The last one lasts until the user moves to another tab, loads
  // something else in this one, or puts text in the field by hand — the message and the
  // button go together, and neither outlives the tab it was about.
  const pageBlocked =
    run.streaming || run.unreadable !== null || run.error?.code === "service_disabled";

  return (
    <div className="flex h-full flex-col bg-surface">
      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        <section className="flex min-h-32 flex-1 flex-col gap-1.5">
          <FieldLabel htmlFor="input-text">Input text</FieldLabel>
          {/* The field stays editable while the answer is being written: correcting the
              text and running it again is the ordinary next step, not an edge case. */}
          <textarea
            id="input-text"
            value={run.input}
            onChange={(event) => dispatch({ type: "edit", text: event.target.value })}
            className="h-full w-full flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm leading-relaxed text-ink focus:border-ink focus:outline-none"
          />
          <InputHint length={inputLength} truncated={run.truncated} />
        </section>

        {/* A change applies to the next run, not to the text already on screen: running
            it again costs a request out of the daily quota, and the Shorten button is
            what spends it. */}
        {settings && (
          <div className="flex gap-2">
            <section className="flex flex-1 flex-col gap-1.5">
              <FieldLabel>Output language</FieldLabel>
              <Picker
                label="Output language"
                value={settings.lang}
                options={SUMMARY_LANGS.map((code) => ({ value: code, label: languageName(code) }))}
                onChange={(lang) => void changeSettings({ lang })}
              />
            </section>
            <section className="flex flex-1 flex-col gap-1.5">
              <FieldLabel>Tone</FieldLabel>
              <Picker
                label="Tone"
                value={settings.tone}
                options={TONE_OPTIONS}
                onChange={(tone) => void changeSettings({ tone: tone as Tone })}
              />
            </section>
          </div>
        )}

        {/* Without this button the input field would be decoration: the button at the
            bottom reads the tab and overwrites whatever was typed, so there would be no
            way to send text the user wrote or pasted themselves. */}
        <Button className="w-full" disabled={!canShorten} onClick={() => void start(run.input, run.source)}>
          {run.streaming ? "Shortening…" : "Shorten"}
        </Button>

        <section className="flex min-h-32 flex-1 flex-col gap-1.5">
          <FieldLabel htmlFor="shortened-text">Shortened text</FieldLabel>
          <OutputBox text={run.result} streaming={run.streaming} />
        </section>

        {run.unreadable && (
          <Notice>This page could not be read. Paste the text into the field above instead.</Notice>
        )}
        {run.error && <Notice>{errorText(run.error)}</Notice>}
      </main>

      {!ratingHidden && (
        <StarRating
          onHide={() => {
            setRatingHidden(true);
            void hideRating();
          }}
        />
      )}

      <div className="border-t border-line px-3 py-2">
        <Button className="w-full" disabled={pageBlocked} onClick={() => void readPage()}>
          Shorten entire page content
        </Button>
      </div>
    </div>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium text-ink-soft">
      {children}
    </label>
  );
}

// Why the Shorten button is greyed out, and only then: an empty field explains itself.
function InputHint({ length, truncated }: { length: number; truncated: boolean }) {
  if (length > 0 && length < MIN_INPUT) {
    return <Hint>Add {characters(MIN_INPUT - length)} more to shorten this text.</Hint>;
  }
  if (length > MAX_INPUT) {
    return <Hint>This text is {characters(length - MAX_INPUT)} over the limit.</Hint>;
  }
  if (truncated) {
    return (
      <Hint>The page was long, so only its first {characters(MAX_INPUT)} were read.</Hint>
    );
  }
  return null;
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-ink-soft">{children}</p>;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm text-ink">
      {children}
    </p>
  );
}

// `message` only ever arrives with service_disabled: hand-written English, shown as is.
// Every other code carries no text, and the wording for it is here.
function errorText(error: { code: ErrorCode; message?: string }): string {
  if (error.message) {
    return error.message;
  }
  switch (error.code) {
    case "too_short":
      return "This text is too short.";
    case "too_long":
      return "This text is too long.";
    case "rate_limited":
      return "Today's limit is used up. Come back tomorrow.";
    case "unsupported_language":
      return "This language is not supported yet.";
    case "invalid_request":
      return "Something went wrong. Please try again.";
    case "service_disabled":
      return "The service is temporarily unavailable.";
    case "upstream_error":
      return "The text could not be shortened. Please try again.";
  }
}

function characters(value: number): string {
  return `${value.toLocaleString("en-US")} ${value === 1 ? "character" : "characters"}`;
}
