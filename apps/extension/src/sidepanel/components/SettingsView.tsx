import { t } from "../../shared/i18n.ts";
import { SUMMARY_LANGS } from "../../shared/lang.ts";
import type { Ratio } from "../../shared/protocol.ts";
import type { Settings } from "../../shared/storage.ts";
import { Button, CloseIcon } from "./ui.tsx";

const RATIOS: Ratio[] = ["light", "normal", "tight"];

// Two settings and no more. The language of the summary is a request field; the
// language of the interface and of the button labels is Chrome's business and is not
// set here.
export function SettingsView({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Button variant="ghost" onClick={onClose} aria-label={t("close")}>
          <CloseIcon />
        </Button>
        <span className="text-sm font-semibold text-ink">{t("settingsTitle")}</span>
      </div>

      <div className="flex flex-col gap-4 px-3 py-3">
        <label className="flex flex-col gap-1 text-sm text-ink">
          {t("settingsLanguage")}
          <select
            value={settings.lang}
            onChange={(event) => onChange({ lang: event.target.value })}
            className="rounded-lg border border-line px-2 py-1.5 text-sm"
          >
            {SUMMARY_LANGS.map((code) => (
              <option key={code} value={code}>
                {languageName(code)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-ink">
          {t("settingsRatio")}
          <select
            value={settings.ratio}
            onChange={(event) => onChange({ ratio: event.target.value as Ratio })}
            className="rounded-lg border border-line px-2 py-1.5 text-sm"
          >
            {RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {t(`ratio_${ratio}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

// Endonyms from the browser, so the list reads the same whatever the interface language
// is. Intl.DisplayNames is in Chrome and needs no data of ours.
function languageName(code: string): string {
  const names = new Intl.DisplayNames([code], { type: "language" });
  return names.of(code) ?? code;
}
