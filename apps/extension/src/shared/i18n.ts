import { localeDirForUI } from "./lang.ts";

export function t(key: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(key, substitutions);
}

// Button labels live in _locales/<dir>/buttons.json, keyed by catalog id. Chrome
// resolves messages.json by itself but knows nothing about this file, so the panel
// fetches it: the interface language decides which one, and English is the fallback
// for a locale that is somehow unreadable.
//
// The labels never travel over the network and are never generated at runtime — the
// server deals in ids and does not know what a button is called.
export async function loadButtonLabels(): Promise<Record<string, string>> {
  const dir = localeDirForUI(chrome.i18n.getUILanguage());
  const labels = await fetchLabels(dir);
  if (labels) {
    return labels;
  }
  return (await fetchLabels("en")) ?? {};
}

async function fetchLabels(dir: string): Promise<Record<string, string> | null> {
  try {
    const response = await fetch(chrome.runtime.getURL(`_locales/${dir}/buttons.json`));
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as Record<string, string>;
  } catch {
    return null;
  }
}
