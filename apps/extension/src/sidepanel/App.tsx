import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { CopyButton } from "@/components/CopyButton.tsx";
import { MarkdownView } from "@/components/MarkdownView.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { hydrate } from "@/shared/hydrate.ts";
import { LANGUAGES, languageFlag } from "@/shared/lang.ts";
import { MAX_INPUT, MIN_INPUT } from "@/shared/limits.ts";
import { markdownToPlainText } from "@/shared/markdown.ts";
import { PANEL_PORT, readPanelMessage } from "@/shared/messaging.ts";
import { TONES, type ErrorCode, type Tone } from "@/shared/protocol.ts";
import {
  getSettings,
  hideRating,
  isRatingHidden,
  saveSettings,
  stashOutputWindowContent,
  type Settings,
} from "@/shared/storage.ts";
import { countCodePoints } from "@/shared/text.ts";
import { shorten } from "./api.ts";
import { StarRating } from "./components/StarRating.tsx";
import { initialPanelState, panelReducer } from "./state.ts";

// One column, top to bottom: the text going in, how to shorten it, the text coming out,
// and the rating strip pinned underneath. The panel holds one run — the one on screen —
// and keeps nothing after it is closed.
//
// Everything the user reads here is an English literal. The panel is not localised: the
// only strings that go through chrome.i18n are the ones Chrome itself draws — the name,
// the description and the icon tooltip.

// What the browser says about its user's languages, for the flags in the picker: the UI
// language first, then the accept languages. Read once — it does not change while the
// panel is open.
const BROWSER_TAGS: readonly string[] = [chrome.i18n.getUILanguage(), ...navigator.languages];

export function App() {
  const [state, dispatch] = useReducer(panelReducer, initialPanelState);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ratingHidden, setRatingHidden] = useState(true);

  // Read inside callbacks that outlive the render they were created in.
  const settingsRef = useRef<Settings | null>(null);
  // Which run the panel is showing. Events from a run that has been replaced are
  // dropped, so a late delta cannot write into the next run's result.
  const runId = useRef(0);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const renderedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      const loaded = await getSettings();
      settingsRef.current = loaded;
      setSettings(loaded);
      setRatingHidden(await isRatingHidden());
    })();

    // The port is the panel's lifetime as far as the service worker is concerned, and it
    // carries the job the worker prepared. A worker restart drops it, so the panel dials
    // back a second later.
    function connect(): void {
      if (disposed) {
        return;
      }
      const port = chrome.runtime.connect({ name: PANEL_PORT });
      port.onMessage.addListener((message: unknown) => {
        const job = readPanelMessage(message);
        if (job) {
          dispatch({ type: "job", job });
        }
      });
      port.onDisconnect.addListener(() => {
        setTimeout(connect, 1000);
      });
    }
    connect();

    return () => {
      disposed = true;
    };
  }, []);

  // A new run starts at the top of the output area. While it streams, the area is not
  // scrolled along with the text: the reader keeps the place they are looking at.
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = 0;
    }
  }, [state.run]);

  // The result with its picture markers resolved: one string, read by the renderer, the
  // counter and both halves of Copy, so none of them can disagree about what is shown.
  const shown = hydrate(state.result, state.resultImages, state.streaming);

  async function start(): Promise<void> {
    const id = ++runId.current;
    dispatch({ type: "start" });
    const current = settingsRef.current ?? (await getSettings());

    await shorten(
      { text: state.input, lang: current.lang, tone: current.tone, source: state.source },
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

  // A change applies to the next run, not to the text already on screen: running it
  // again costs a request out of the daily quota, and the Shorten button is what spends
  // it. Both values are written to storage as they are picked.
  async function changeSettings(patch: Partial<Settings>): Promise<void> {
    const updated = { ...(settingsRef.current ?? (await getSettings())), ...patch };
    settingsRef.current = updated;
    setSettings(updated);
    await saveSettings(patch);
  }

  async function openInWindow(): Promise<void> {
    await stashOutputWindowContent({
      markdown: shown,
      lang: settingsRef.current?.lang ?? "en",
      images: state.resultImages,
    });
    await chrome.windows.create({
      url: chrome.runtime.getURL("output.html"),
      type: "popup",
      width: 720,
      height: 600,
    });
  }

  const inputLength = countCodePoints(state.input);
  const outputLength = countCodePoints(markdownToPlainText(shown));
  // `shown` and not `state.result`: what the panel has to show is what is on screen, and
  // the head of a stream can be half a marker, which is nothing yet.
  const finished = !state.streaming && shown !== "" && state.error === null;
  // service_disabled is the one error that holds the button down: the service said no,
  // and it will say no again until something changes. Editing the field lifts it.
  const canShorten =
    !state.streaming &&
    inputLength >= MIN_INPUT &&
    inputLength <= MAX_INPUT &&
    state.error?.code !== "service_disabled";
  const lang = settings?.lang ?? "en";

  return (
    <div className="flex h-full flex-col">
      <main className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <section className="flex min-h-0 flex-1 flex-col gap-1.5">
          <FieldRow>
            <Label htmlFor="input-text">Input text</Label>
            <CharCount value={inputLength} />
          </FieldRow>
          {/* The field stays editable while the answer is being written: correcting the
              text and running it again is the ordinary next step, not an edge case. */}
          <Textarea
            id="input-text"
            value={state.input}
            onChange={(event) => dispatch({ type: "edit", text: event.target.value })}
            // field-sizing-fixed: the field takes the height the column gives it and
            // scrolls inside, instead of growing with its content and pushing the
            // controls off the panel.
            className="min-h-0 flex-1 field-sizing-fixed resize-none text-sm leading-relaxed"
          />
          <InputHint length={inputLength} truncated={state.truncated} unreadable={state.unreadable} />
        </section>

        <section className="flex flex-col gap-2">
          {/* Both pickers on one line, each carrying its own name inside the closed
              control as a muted prefix in front of the value: "Output language  🇺🇸
              English", "Tone  🔤 Simplified". Each control is as wide as its text and
              the two share what is left of the line equally (flex-auto), so both read
              whole whenever they can; when something still has to give, the value
              truncates before the prefix does. */}
          <div className="flex gap-2">
            <Select value={lang} onValueChange={(value) => void changeSettings({ lang: value })} disabled={!settings}>
              <SelectTrigger className="min-w-0 flex-auto" aria-label="Output language">
                <PrefixLabel>Output language</PrefixLabel>
                <SelectValue className="min-w-0 flex-1 text-left" />
              </SelectTrigger>
              <SelectContent>
                {/* textValue: the typeahead matches on it — typing "p" jumps to Persian,
                    Polish, Portuguese. Without it Radix reads the item's text, which
                    starts with the flag, and no letter matches anything. */}
                {LANGUAGES.map((language) => (
                  <SelectItem key={language.code} value={language.code} textValue={language.label}>
                    <Emoji>{languageFlag(language, BROWSER_TAGS)}</Emoji>
                    {language.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={settings?.tone ?? "simplified"}
              onValueChange={(value) => void changeSettings({ tone: value as Tone })}
              disabled={!settings}
            >
              <SelectTrigger className="min-w-0 flex-auto" aria-label="Tone">
                <PrefixLabel>Tone</PrefixLabel>
                <SelectValue className="min-w-0 flex-1 text-left" />
              </SelectTrigger>
              <SelectContent>
                {TONES.map((tone) => (
                  <SelectItem key={tone.id} value={tone.id} textValue={tone.label}>
                    <Emoji>{tone.emoji}</Emoji>
                    {tone.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* The only way to spend a request. Nothing else in the extension sends one. */}
          <Button className="w-full" disabled={!canShorten} onClick={() => void start()}>
            {state.streaming ? "Shortening…" : "Shorten"}
          </Button>

          {state.error && (
            <Alert>
              <AlertDescription>{errorText(state.error)}</AlertDescription>
            </Alert>
          )}
        </section>

        <section className="flex min-h-0 flex-1 flex-col gap-1.5">
          <FieldRow>
            <Label>Shortened text</Label>
            <CharCount value={outputLength} />
          </FieldRow>
          {/* The result and, once it is complete, the two things to do with it. The
              buttons are a strip along the bottom of the field, each taking half of its
              width, and they show while the pointer is over the field or one of them has
              focus. Words, not icons: the panel is narrow, and nothing here needs a
              tooltip to be understood. */}
          <div className="group relative min-h-0 flex-1">
            <div
              ref={outputRef}
              className={cn(
                "h-full overflow-y-auto rounded-md border bg-transparent px-3 py-2 text-sm leading-relaxed dark:bg-input/30",
                // Room for the last line to scroll out from under the strip.
                finished && "pb-10",
              )}
            >
              {state.streaming && shown === "" ? (
                <div className="flex flex-col gap-2 py-1" aria-label="Waiting for the first words">
                  {/* Darker than the component's default: the default accent is a shade
                      off the background in the light theme and the pulse halves it. */}
                  <Skeleton className="h-3.5 w-full bg-muted-foreground/20" />
                  <Skeleton className="h-3.5 w-11/12 bg-muted-foreground/20" />
                  <Skeleton className="h-3.5 w-4/6 bg-muted-foreground/20" />
                </div>
              ) : shown === "" ? (
                <p className="text-muted-foreground">The shortened text will appear here.</p>
              ) : (
                <div ref={renderedRef}>
                  <MarkdownView markdown={shown} lang={lang} images={state.resultImages} />
                </div>
              )}
            </div>
            {finished && (
              <div className="absolute inset-x-px bottom-px flex divide-x overflow-hidden rounded-b-md border-t bg-background/90 opacity-0 backdrop-blur-sm transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 dark:bg-popover/90">
                <Button variant="ghost" size="sm" className="flex-1 rounded-none" onClick={() => void openInWindow()}>
                  Open in window
                </Button>
                <CopyButton markdown={shown} rendered={renderedRef} className="flex-1 rounded-none" />
              </div>
            )}
          </div>
        </section>
      </main>

      {!ratingHidden && (
        <StarRating
          onHide={() => {
            setRatingHidden(true);
            void hideRating();
          }}
        />
      )}
    </div>
  );
}

// A label with what belongs on its line — the character count — at the far end.
function FieldRow({ children }: { children: ReactNode }) {
  return <div className="flex min-h-8 items-center justify-between gap-2">{children}</div>;
}

// The name of a picker, written inside its closed control in front of the value. The
// control's accessible name is set separately (aria-label), so this is presentation.
function PrefixLabel({ children }: { children: string }) {
  return <span className="shrink-0 text-muted-foreground">{children}</span>;
}

// A flag or a pictogram in front of a picker entry. Decoration: the label says it all,
// so the screen reader skips it.
function Emoji({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="me-1.5">
      {children}
    </span>
  );
}

// How long the text is, in the same code points the server counts.
function CharCount({ value }: { value: number }) {
  return <span className="text-xs tabular-nums text-muted-foreground">{value.toLocaleString("en-US")}</span>;
}

// One line under the field, and only when there is something to say. The order is the
// priority: the page could not be read, the text is too short, too long, or was cut.
function InputHint({ length, truncated, unreadable }: { length: number; truncated: boolean; unreadable: boolean }) {
  if (unreadable) {
    return <Hint>This page has no readable text to shorten. Paste the text here instead.</Hint>;
  }
  if (length > 0 && length < MIN_INPUT) {
    return <Hint>Add {characters(MIN_INPUT - length)} more to shorten this text.</Hint>;
  }
  if (length > MAX_INPUT) {
    return <Hint>This text is {characters(length - MAX_INPUT)} over the limit.</Hint>;
  }
  if (truncated) {
    return <Hint>The page was long, so only its first {characters(MAX_INPUT)} were read.</Hint>;
  }
  return null;
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

// `message` only ever arrives with service_disabled: hand-written English, shown as is.
// Every other code carries no text, and the wording for it is here.
function errorText(error: { code: ErrorCode; message?: string }): string {
  if (error.code === "service_disabled" && error.message) {
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
    // The model's verdict, not a failure: what came in was not a text — search results,
    // a menu, noise. The input stays in the field for the user to fix or replace.
    case "nothing_to_shorten":
      return "There is nothing to shorten here: this does not look like a text.";
  }
}

function characters(value: number): string {
  return `${value.toLocaleString("en-US")} ${value === 1 ? "character" : "characters"}`;
}
