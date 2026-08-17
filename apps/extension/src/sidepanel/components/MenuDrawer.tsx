import { t } from "../../shared/i18n.ts";
import type { Dialog } from "../../shared/storage.ts";
import { Button, CloseIcon, GearIcon, TrashIcon } from "./ui.tsx";

// The burger: previous dialogs newest first, a new dialog, deletion of one and of all,
// and the gear. The daily quota is not shown anywhere — the user meets the limit only
// when they hit it.
export function MenuDrawer({
  history,
  onOpen,
  onDelete,
  onClear,
  onNew,
  onSettings,
  onClose,
}: {
  history: Dialog[];
  onOpen: (dialog: Dialog) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onNew: () => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Button variant="ghost" onClick={onClose} aria-label={t("close")}>
          <CloseIcon />
        </Button>
        <span className="flex-1 text-sm font-semibold text-ink">{t("historyTitle")}</span>
        <Button variant="ghost" onClick={onSettings} aria-label={t("settingsTitle")}>
          <GearIcon />
        </Button>
      </div>

      <div className="flex gap-2 border-b border-line px-3 py-2">
        <Button variant="outline" onClick={onNew}>
          {t("newDialog")}
        </Button>
        {history.length > 0 && (
          <Button variant="ghost" onClick={onClear}>
            {t("clearHistory")}
          </Button>
        )}
      </div>

      <ul className="flex-1 overflow-y-auto">
        {history.length === 0 && <li className="px-3 py-4 text-sm text-ink-soft">{t("historyEmpty")}</li>}
        {history.map((dialog) => (
          <li key={dialog.id} className="flex items-start gap-1 border-b border-line/60 px-3 py-2">
            <button
              onClick={() => onOpen(dialog)}
              className="flex-1 text-start text-sm text-ink hover:underline"
            >
              <span className="line-clamp-2">{dialog.summary || dialog.sourceText}</span>
              <span className="mt-0.5 block text-xs text-ink-soft">
                {new Date(dialog.createdAt).toLocaleString()}
              </span>
            </button>
            <Button variant="ghost" onClick={() => onDelete(dialog.id)} aria-label={t("deleteDialog")}>
              <TrashIcon />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
