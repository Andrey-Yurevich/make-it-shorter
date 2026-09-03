import { normalizeLang } from "./lang.ts";
import { isTone, type Source, type Tone } from "./protocol.ts";

// Everything lives in chrome.storage.local. storage.sync is deliberately not used: the
// quota is tied to the device on purpose, and syncing the device id would defeat it.

export type Settings = {
  lang: string;
  tone: Tone;
};

// One run of the panel. It lives in memory for as long as the panel shows it and is
// written nowhere: the panel holds one dialog, the current one, and the refresh button
// replaces it. Nothing about the user's text touches storage on either side of the wire.
export type Dialog = {
  id: string;
  createdAt: number;
  source: Source;
  pageUrl?: string;
  sourceText: string;
  truncated: boolean;
  summary: string;
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

// Both settings are read from storage on every panel open and written on every change,
// so a tone picked once stays picked: across panel opens, browser restarts and extension
// updates. Only a value the current build does not know falls back to the default.
export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(["lang", "tone"]);
  const lang =
    typeof stored.lang === "string" ? stored.lang : normalizeLang(chrome.i18n.getUILanguage());
  const tone: Tone = isTone(stored.tone) ? stored.tone : "original";
  return { lang, tone };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export async function isRatingHidden(): Promise<boolean> {
  const stored = await chrome.storage.local.get("rated");
  return stored.rated === true;
}

export async function hideRating(): Promise<void> {
  await chrome.storage.local.set({ rated: true });
}
