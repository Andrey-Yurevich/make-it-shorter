import { t } from "../../shared/i18n.ts";
import { LANG_BADGES, SUMMARY_LANGS, languageName } from "../../shared/lang.ts";
import type { Ratio } from "../../shared/protocol.ts";
import type { Settings } from "../../shared/storage.ts";
import { Picker } from "./Picker.tsx";

const RATIOS: Ratio[] = ["light", "normal", "tight"];

// The whole of the settings, in the top row, two buttons wide. There is no settings
// screen behind them: with two values to set, a screen to set them on was furniture.
//
// A change applies to the next run, not to the summary already on screen — re-running it
// costs a request out of the daily quota, so it is the refresh button that spends it,
// deliberately, and not a change of mind about the language.
export function Toolbar({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-2">
      <Picker
        badge={LANG_BADGES[settings.lang] ?? settings.lang.toUpperCase()}
        title={t("settingsLanguage")}
        value={settings.lang}
        options={SUMMARY_LANGS.map((code) => ({ value: code, label: languageName(code) }))}
        onChange={(lang) => onChange({ lang })}
      />
      <Picker
        badge={t(`ratio_${settings.ratio}`)}
        title={t("settingsRatio")}
        value={settings.ratio}
        options={RATIOS.map((ratio) => ({ value: ratio, label: t(`ratio_${ratio}`) }))}
        onChange={(ratio) => onChange({ ratio: ratio as Ratio })}
      />
    </div>
  );
}
