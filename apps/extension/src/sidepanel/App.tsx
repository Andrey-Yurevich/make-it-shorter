import { useEffect, useReducer, useRef, useState } from "react";
import { loadButtonLabels } from "../shared/i18n.ts";
import { RTL_LANGS, localeDirForUI } from "../shared/lang.ts";
import { MIN_INPUT } from "../shared/limits.ts";
import { PANEL_PORT, type PanelJob, type PanelMessage } from "../shared/messaging.ts";
import type { Source } from "../shared/protocol.ts";
import {
  getSettings,
  hideRating,
  isRatingHidden,
  saveSettings,
  type Dialog,
  type Settings,
} from "../shared/storage.ts";
import { activeTab, extractFromTab } from "../shared/tab.ts";
import { countCodePoints } from "../shared/text.ts";
import { summarize } from "./api.ts";
import { DialogView } from "./components/DialogView.tsx";
import { RefreshBar } from "./components/RefreshBar.tsx";
import { StarRating } from "./components/StarRating.tsx";
import { Toolbar } from "./components/Toolbar.tsx";
import { initialRunState, runReducer } from "./state.ts";

// The panel holds one dialog: the one on screen. There is no history behind it and no
// second screen over it — the summary, the buttons under it, and one button that goes
// and reads the tab again.
export function App() {
  const [run, dispatch] = useReducer(runReducer, initialRunState);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [ratingHidden, setRatingHidden] = useState(true);

  // Read inside callbacks that outlive the render they were created in.
  const settingsRef = useRef<Settings | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    void (async () => {
      const loaded = await getSettings();
      settingsRef.current = loaded;
      setSettings(loaded);
      setLabels(await loadButtonLabels());
      setRatingHidden(await isRatingHidden());

      document.documentElement.lang = chrome.i18n.getUILanguage();
      document.documentElement.dir = RTL_LANGS.has(localeDirForUI(chrome.i18n.getUILanguage()))
        ? "rtl"
        : "ltr";

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
    port.onMessage.addListener((message: PanelMessage) => {
      if (message.type === "job") {
        handleJob(message.job);
      }
    });
    port.onDisconnect.addListener(() => {
      portRef.current = null;
      setTimeout(connect, 1000);
    });
  }

  // What the worker needs for the "second click on the icon" rule.
  useEffect(() => {
    portRef.current?.postMessage({
      type: "state",
      pageUrl: run.dialog?.pageUrl ?? null,
      hasSummary: run.dialog?.summary !== undefined && run.dialog.summary !== "",
    });
  }, [run.dialog]);

  function handleJob(job: PanelJob): void {
    // Readability came back with less than the minimum, or the page could not be read
    // at all. Neither is an error: no request goes out, no quota is spent, the panel
    // just says the page could not be read.
    if (job.kind === "unreadable" || countCodePoints(job.text) < MIN_INPUT) {
      dispatch({ type: "unreadable-page" });
      return;
    }
    void start(job.text, job.source, job.truncated, job.pageUrl);
  }

  async function start(text: string, source: Source, truncated: boolean, pageUrl?: string): Promise<void> {
    const current = settingsRef.current ?? (await getSettings());
    const dialog: Dialog = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      source,
      pageUrl,
      sourceText: text,
      truncated,
      summary: "",
      actions: [],
    };
    dispatch({ type: "start", dialog });

    await summarize(
      { text, lang: current.lang, ratio: current.ratio, source },
      {
        onDelta: (chunk) => dispatch({ type: "delta", text: chunk }),
        onActions: (ids) => dispatch({ type: "actions", ids }),
        onAnswer: (id, answer) => dispatch({ type: "answer", id, text: answer }),
        onDone: () => dispatch({ type: "done" }),
        onError: (code, message) => dispatch({ type: "error", code, message }),
      },
    );
  }

  // Refresh reads the active tab from scratch, every time, whatever is on screen: the
  // point of the button is a page whose content has moved on, and the only way to know
  // that it has is to go and read it. The panel does the reading itself rather than
  // asking the worker for it — the worker may be asleep, and a message to a port that
  // is being re-established would be lost with nothing on screen to say so.
  async function refresh(): Promise<void> {
    dispatch({ type: "pending" });

    const tab = await activeTab();
    if (tab?.id === undefined) {
      dispatch({ type: "unreadable-page" });
      return;
    }

    const extracted = await extractFromTab(tab.id, "page");
    if (!extracted.ok || countCodePoints(extracted.text) < MIN_INPUT) {
      dispatch({ type: "unreadable-page" });
      return;
    }
    await start(extracted.text, "page", extracted.truncated, tab.url);
  }

  // What the retry button under an error message repeats: the same text as last time,
  // without going back to the tab for it. An error can only be shown under a dialog, so
  // there is always a text to repeat.
  function retry(): void {
    const dialog = run.dialog;
    if (dialog) {
      void start(dialog.sourceText, dialog.source, dialog.truncated, dialog.pageUrl);
    }
  }

  async function changeSettings(patch: Partial<Settings>): Promise<void> {
    const updated = { ...(settingsRef.current ?? (await getSettings())), ...patch };
    settingsRef.current = updated;
    setSettings(updated);
    await saveSettings(patch);
  }

  // The service is switched off: no request goes out until the user asks again, which
  // the retry button under the message is. Streaming blocks refresh for the ordinary
  // reason — one dialog at a time.
  const refreshBlocked = run.streaming || run.error?.code === "service_disabled";

  return (
    <div className="relative flex h-full flex-col bg-surface">
      {settings && <Toolbar settings={settings} onChange={(patch) => void changeSettings(patch)} />}

      <main className="flex-1 overflow-y-auto">
        <DialogView state={run} labels={labels} onRetry={retry} />
      </main>

      {!ratingHidden && (
        <StarRating
          onHide={() => {
            setRatingHidden(true);
            void hideRating();
          }}
        />
      )}

      <RefreshBar disabled={refreshBlocked} onRefresh={() => void refresh()} />
    </div>
  );
}
