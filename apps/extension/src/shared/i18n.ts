// The strings Chrome itself shows — the extension name, the context menu item, the
// icon tooltip — live in _locales/<dir>/messages.json and are read through here. The
// panel is English and does not use this.
export function t(key: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(key, substitutions);
}
