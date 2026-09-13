import { MIN_INPUT } from "../shared/limits.ts";
import { readExtractRequest, type ExtractResult } from "../shared/messaging.ts";
import { countCodePoints, normalizeText } from "../shared/text.ts";

// The resident half of the content script. It runs on every page the user opens, heavy
// ones included, so until the first mouseup it does nothing at all: no DOM, no
// observers, no reading. An extension that visibly slows other people's sites gets
// uninstalled before its description is read.
//
// Readability is the other half and lives in extract.js, pulled in by a dynamic import
// only when there is a page to extract.

let iconHost: HTMLDivElement | null = null;

// Kept in step with the width and height in the button's own CSS below.
const ICON_SIZE = 28;

document.addEventListener("mouseup", onMouseUp, true);
document.addEventListener("scroll", hideIcon, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideIcon();
  }
});
document.addEventListener("mousedown", (event) => {
  if (iconHost && !event.composedPath().includes(iconHost)) {
    hideIcon();
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const request = readExtractRequest(message);
  if (!request) {
    return false;
  }
  void respondWithText(request.mode).then(sendResponse);
  return true; // the response is asynchronous
});

async function respondWithText(mode: "selection" | "page"): Promise<ExtractResult> {
  // An empty selection is an answer, not a failure: the page was reachable and nothing
  // was selected in it. The two have to be told apart on the other end — the toolbar
  // icon does nothing at all when nothing is selected, and says the page could not be
  // read when it could not. Only a page we never reached comes back `ok: false`, and on
  // those this listener is not running in the first place.
  if (mode === "selection") {
    const normalized = normalizeText(selectionText());
    return { ok: true, text: normalized.text, truncated: normalized.truncated };
  }

  const raw = await extractPageText();
  if (!raw) {
    return { ok: false };
  }
  const normalized = normalizeText(raw);
  return { ok: true, text: normalized.text, truncated: normalized.truncated };
}

async function extractPageText(): Promise<string> {
  const { extractPage } = await import(chrome.runtime.getURL("extract.js"));
  return extractPage() as string;
}

function selectionText(): string {
  return window.getSelection()?.toString() ?? "";
}

function onMouseUp(event: MouseEvent): void {
  // Not in inputs and not in contenteditable: a selection there usually means editing,
  // not reading.
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, [contenteditable]")) {
    hideIcon();
    return;
  }

  const selection = window.getSelection();
  const text = selection?.toString() ?? "";
  if (!selection || selection.isCollapsed || countCodePoints(text) < MIN_INPUT) {
    hideIcon();
    return;
  }

  // The panel, if it is open, gets the selection straight away. The worker drops the
  // message when it is not, so nothing here depends on knowing that.
  //
  // The threshold is the icon's: below the minimum there is nothing to shorten anyway,
  // and picking up every stray word would overwrite text the user had put in the field
  // by hand.
  const normalized = normalizeText(text);
  void chrome.runtime
    .sendMessage({ type: "selection-changed", text: normalized.text, truncated: normalized.truncated })
    // The extension was reloaded and this script belongs to the build before it. There
    // is nothing to do about that here, and the page must not see an error for it.
    .catch(() => {});

  const end = selectionEnd(selection);
  if (end) {
    showIcon(end.caret, end.backward);
    return;
  }
  // No usable caret: fall back to the corner of the whole selection. Passing the block's
  // own box as the caret puts the icon at its top right — where it used to be for every
  // selection, and still a place the user can see it.
  showIcon(selection.getRangeAt(0).getBoundingClientRect(), false);
}

type SelectionEnd = {
  // A caret-shaped box at the point the selection was released: no width, the height of
  // the line it ended on.
  caret: DOMRect;
  // The drag ran towards the beginning of the document, so the point it ended at is the
  // left-hand end of the selection and the icon belongs to its left.
  backward: boolean;
};

// Where the selection ended, which is not the same as where it is. `anchorNode` is the
// end the drag started from and `focusNode` is the end it stopped at — so a selection
// made bottom-up and right-to-left has its focus at the top left, and that is where the
// icon goes. The corner of the bounding box cannot tell the two apart: it is the same
// box either way, and half the time the icon appeared at the end of the selection the
// user's hand had left several lines ago.
function selectionEnd(selection: Selection): SelectionEnd | null {
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  if (!anchorNode || !focusNode) {
    return null;
  }

  const caretRange = document.createRange();
  try {
    caretRange.setStart(focusNode, focusOffset);
  } catch {
    // An offset that node cannot take. Nothing here to place an icon by.
    return null;
  }
  caretRange.collapse(true);
  const caret = caretRange.getBoundingClientRect();
  // A collapsed range has no width by definition; no height means it has no position
  // either — the focus sits on an element rather than inside text.
  if (caret.height === 0) {
    return null;
  }

  // A range will not end before it starts: handed the two ends in the order the user
  // made them, it collapses onto the new end instead, and that collapse is the whole
  // signal. There is no direction flag on Selection to ask for.
  const direction = document.createRange();
  try {
    direction.setStart(anchorNode, anchorOffset);
    direction.setEnd(focusNode, focusOffset);
  } catch {
    // Ends in two different trees. Rare enough that the forward placement will do.
    return { caret, backward: false };
  }
  return { caret, backward: direction.collapsed };
}

// Shadow DOM with ordinary CSS. Tailwind never reaches a foreign page: this icon is the
// only thing the extension injects, and everything else happens in the side panel.
function showIcon(caret: DOMRect, backward: boolean): void {
  if (!iconHost) {
    iconHost = document.createElement("div");
    iconHost.style.position = "fixed";
    iconHost.style.zIndex = "2147483647";
    iconHost.style.width = "28px";
    iconHost.style.height = "28px";

    const shadow = iconHost.attachShadow({ mode: "closed" });
    const button = document.createElement("button");
    button.title = chrome.i18n.getMessage("floatingIconTitle");
    button.innerHTML = `
      <svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true">
        <g fill="currentColor">
          <rect x="7" y="9" width="18" height="3" rx="1.5"/>
          <rect x="7" y="14.5" width="12" height="3" rx="1.5"/>
          <rect x="7" y="20" width="6" height="3" rx="1.5"/>
        </g>
      </svg>`;
    const style = document.createElement("style");
    style.textContent = `
      button {
        all: unset;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        background: #1b1b1f;
        color: #ffffff;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
      }
      button:hover { background: #2f2f36; }
    `;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const text = selectionText();
      hideIcon();
      void chrome.runtime.sendMessage({ type: "selection-clicked", text });
    });

    shadow.append(style, button);
    document.documentElement.append(iconHost);
  }

  // Just outside the point the selection was released, on the side the drag was heading:
  // to its right going forwards, to its left going back. Either way the icon sits off the
  // selected text rather than over it, and within reach of the cursor that let it go.
  // Then nudged back inside the viewport, which is what keeps a selection ending at the
  // very edge of the window from putting the icon out of sight.
  const beside = backward ? caret.left - ICON_SIZE - 6 : caret.right + 6;
  const left = Math.min(Math.max(beside, 4), window.innerWidth - 32);
  const top = Math.min(Math.max(caret.top - 4, 4), window.innerHeight - 32);
  iconHost.style.left = `${left}px`;
  iconHost.style.top = `${top}px`;
  iconHost.style.display = "block";
}

function hideIcon(): void {
  if (iconHost) {
    iconHost.style.display = "none";
  }
}
