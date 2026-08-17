import { HISTORY_LIMIT } from "./limits.ts";
import { normalizeLang } from "./lang.ts";
import type { Ratio, Source } from "./protocol.ts";

// Everything lives in chrome.storage.local. storage.sync is deliberately not used: the
// quota is tied to the device on purpose, and syncing the device id would defeat it.

export type Settings = {
  lang: string;
  ratio: Ratio;
};

export type DialogAction = {
  id: string;
  text: string;
};

export type Dialog = {
  id: string;
  createdAt: number;
  source: Source;
  pageUrl?: string;
  sourceText: string;
  truncated: boolean;
  summary: string;
  // Every answer is kept, expanded or not: they were generated and paid for, and the
  // user may open them a month later out of the history. A dialog restored from
  // history works fully offline — that is the whole point of generating them upfront.
  actions: DialogAction[];
};

// crypto.randomUUID() at install time. Gone from storage — recreated silently on the
// next call: the user cleared browser data, they did not break anything.
//
// The direct consequence, written down so nobody mistakes the quota for a defence: a
// daily limit costs one click to reset. The quota is a polite request aimed at ordinary
// users; real abuse is stopped by the rate limit on the WAF, and only by it.
export async function getDeviceId(): Promise<string> {
  const stored = await chrome.storage.local.get("deviceId");
  if (typeof stored.deviceId === "string" && stored.deviceId) {
    return stored.deviceId;
  }
  const deviceId = crypto.randomUUID();
  await chrome.storage.local.set({ deviceId });
  return deviceId;
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(["lang", "ratio"]);
  const lang =
    typeof stored.lang === "string" ? stored.lang : normalizeLang(chrome.i18n.getUILanguage());
  const ratio: Ratio =
    stored.ratio === "light" || stored.ratio === "tight" ? stored.ratio : "normal";
  return { lang, ratio };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export async function loadHistory(): Promise<Dialog[]> {
  const stored = await chrome.storage.local.get("history");
  return Array.isArray(stored.history) ? (stored.history as Dialog[]) : [];
}

// Newest first, oldest dropped past the limit. unlimitedStorage is not requested: a
// dialog weighs what its source text weighs, up to 30 000 characters, and fifty of
// those still fit the standard quota with room to spare.
export async function saveDialog(dialog: Dialog): Promise<Dialog[]> {
  const history = await loadHistory();
  const without = history.filter((entry) => entry.id !== dialog.id);
  const updated = [dialog, ...without].slice(0, HISTORY_LIMIT);
  await chrome.storage.local.set({ history: updated });
  return updated;
}

export async function deleteDialog(id: string): Promise<Dialog[]> {
  const history = await loadHistory();
  const updated = history.filter((entry) => entry.id !== id);
  await chrome.storage.local.set({ history: updated });
  return updated;
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ history: [] });
}

export async function isRatingHidden(): Promise<boolean> {
  const stored = await chrome.storage.local.get("rated");
  return stored.rated === true;
}

export async function hideRating(): Promise<void> {
  await chrome.storage.local.set({ rated: true });
}

// Written at startup for diagnostics only. The header is filled from the build-time
// constant, never from here — storage could hold a value from an older build.
export async function rememberCatalogVersion(version: number): Promise<void> {
  await chrome.storage.local.set({ catalogVersion: version });
}
