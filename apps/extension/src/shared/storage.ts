import { normalizeLang } from "./lang.ts";
import { DEFAULT_TONE, isTone, type Tone } from "./protocol.ts";

// Everything lives in chrome.storage.local, under four keys and no others: deviceId,
// lang, tone, rated. No text of the user's is ever written here, in any form — the
// panel holds one result in memory and loses it when it closes. storage.sync is
// deliberately not used: the quota is tied to the device on purpose, and syncing the
// device id would defeat it.

export type Settings = {
  lang: string;
  tone: Tone;
};

// crypto.randomUUID() on first use. Gone from storage — recreated silently on the next
// call: the user cleared browser data, they did not break anything.
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
// updates. A stored language is normalised on the way out — a build that split pt-BR
// from pt-PT left "pt-BR" behind, and it folds onto "pt" here. A tone the current build
// does not know falls back to the default.
export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(["lang", "tone"]);
  const lang = normalizeLang(typeof stored.lang === "string" ? stored.lang : chrome.i18n.getUILanguage());
  const tone: Tone = isTone(stored.tone) ? stored.tone : DEFAULT_TONE;
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

// The hand-over to the output window goes through chrome.storage.session: memory only,
// never the disk, so the rule that no text is stored anywhere holds. The window reads the
// key once and removes it.
const OUTPUT_WINDOW_KEY = "outputWindow";

export type OutputWindowContent = { markdown: string; lang: string };

export async function stashOutputWindowContent(content: OutputWindowContent): Promise<void> {
  await chrome.storage.session.set({ [OUTPUT_WINDOW_KEY]: content });
}

export async function takeOutputWindowContent(): Promise<OutputWindowContent | null> {
  const stored = await chrome.storage.session.get(OUTPUT_WINDOW_KEY);
  await chrome.storage.session.remove(OUTPUT_WINDOW_KEY);
  const content: unknown = stored[OUTPUT_WINDOW_KEY];
  if (typeof content !== "object" || content === null) {
    return null;
  }
  const fields = content as Record<string, unknown>;
  if (typeof fields.markdown !== "string") {
    return null;
  }
  return { markdown: fields.markdown, lang: typeof fields.lang === "string" ? fields.lang : "en" };
}
