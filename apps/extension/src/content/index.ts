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
  const raw = mode === "selection" ? selectionText() : await extractPageText();
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

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  showIcon(rect);
}

// Shadow DOM with ordinary CSS. Tailwind never reaches a foreign page: this icon is the
// only thing the extension injects, and everything else happens in the side panel.
function showIcon(rect: DOMRect): void {
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

  // Placed to the right of the selection's end, nudged back inside the viewport.
  const left = Math.min(Math.max(rect.right + 6, 4), window.innerWidth - 32);
  const top = Math.min(Math.max(rect.top - 4, 4), window.innerHeight - 32);
  iconHost.style.left = `${left}px`;
  iconHost.style.top = `${top}px`;
  iconHost.style.display = "block";
}

function hideIcon(): void {
  if (iconHost) {
    iconHost.style.display = "none";
  }
}
