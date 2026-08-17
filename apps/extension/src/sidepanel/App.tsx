import { useEffect, useReducer, useRef, useState } from "react";
import { loadButtonLabels } from "../shared/i18n.ts";
import { RTL_LANGS, localeDirForUI } from "../shared/lang.ts";
import { MIN_INPUT } from "../shared/limits.ts";
import { PANEL_PORT, type PanelJob, type PanelMessage } from "../shared/messaging.ts";
import type { Source } from "../shared/protocol.ts";
import {
  clearHistory,
  deleteDialog,
  getSettings,
  hideRating,
  isRatingHidden,
  loadHistory,
  saveDialog,
  saveSettings,
  type Dialog,
  type Settings,
} from "../shared/storage.ts";
import { countCodePoints } from "../shared/text.ts";
import { summarize } from "./api.ts";
import { Composer } from "./components/Composer.tsx";
import { DialogView } from "./components/DialogView.tsx";
import { Header } from "./components/Header.tsx";
import { MenuDrawer } from "./components/MenuDrawer.tsx";
import { SettingsView } from "./components/SettingsView.tsx";
import { StarRating } from "./components/StarRating.tsx";
import { initialRunState, runReducer } from "./state.ts";

type Screen = "dialog" | "menu" | "settings";

export function App() {
  const [run, dispatch] = useReducer(runReducer, initialRunState);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [history, setHistory] = useState<Dialog[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [screen, setScreen] = useState<Screen>("dialog");
  const [ratingHidden, setRatingHidden] = useState(true);

  // Read inside callbacks that outlive the render they were created in.
  const settingsRef = useRef<Settings | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const lastJobRef = useRef<PanelJob | null>(null);
  // The dialog currently being generated. Only that one gets written to the history,
  // once, when its stream ends — opening an old dialog must not reshuffle the list.
  const runningIdRef = useRef<string | null>(null);

  useEffect(() => {
    void (async () => {
      const loaded = await getSettings();
      settingsRef.current = loaded;
      setSettings(loaded);
      setHistory(await loadHistory());
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

  useEffect(() => {
    const dialog = run.dialog;
    if (run.streaming || !dialog || dialog.id !== runningIdRef.current || !dialog.summary) {
      return;
    }
    runningIdRef.current = null;
    void saveDialog(dialog).then(setHistory);
  }, [run.streaming, run.dialog]);

  function handleJob(job: PanelJob): void {
    setScreen("dialog");
    lastJobRef.current = job;

    // Readability came back with less than the minimum, or the page could not be read
    // at all. Neither is an error: no request goes out, no quota is spent, the panel
    // just says the page could not be read and waits for pasted text.
    if (job.kind === "manual" || countCodePoints(job.text) < MIN_INPUT) {
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
    runningIdRef.current = dialog.id;
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

  function retry(): void {
    const job = lastJobRef.current;
    const dialog = run.dialog;
    if (job && job.kind === "text") {
      void start(job.text, job.source, job.truncated, job.pageUrl);
      return;
    }
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
  // the retry button under the message is. Streaming blocks the composer for the
  // ordinary reason — one dialog at a time.
  const inputBlocked = run.streaming || run.error?.code === "service_disabled";

  return (
    <div className="relative flex h-full flex-col bg-surface">
      <Header onMenu={() => setScreen("menu")} />

      <main className="flex-1 overflow-y-auto">
        <DialogView state={run} labels={labels} onRetry={retry} />
      </main>

      <Composer
        disabled={inputBlocked}
        onSubmit={(text, truncated) => void start(text, "manual", truncated)}
      />

      {!ratingHidden && (
        <StarRating
          onHide={() => {
            setRatingHidden(true);
            void hideRating();
          }}
        />
      )}

      {screen === "menu" && (
        <MenuDrawer
          history={history}
          onOpen={(dialog) => {
            dispatch({ type: "open", dialog });
            setScreen("dialog");
          }}
          onDelete={(id) => void deleteDialog(id).then(setHistory)}
          onClear={() => void clearHistory().then(() => setHistory([]))}
          onNew={() => {
            dispatch({ type: "reset" });
            setScreen("dialog");
          }}
          onSettings={() => setScreen("settings")}
          onClose={() => setScreen("dialog")}
        />
      )}

      {screen === "settings" && settings && (
        <SettingsView
          settings={settings}
          onChange={(patch) => void changeSettings(patch)}
          onClose={() => setScreen("menu")}
        />
      )}
    </div>
  );
}
