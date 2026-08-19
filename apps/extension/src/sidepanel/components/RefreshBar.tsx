import { t } from "../../shared/i18n.ts";
import { Button, cn } from "./ui.tsx";

// The only control at the bottom of the panel, and the only way to spend a request from
// inside it: it reads the active tab again and summarises what it finds. That is what
// makes it useful on a page whose content has changed — a feed, a thread, a document
// being edited — and it is a plain button rather than an automatic re-run because
// re-running costs money and one of the fifty daily requests.
export function RefreshBar({ disabled, onRefresh }: { disabled: boolean; onRefresh: () => void }) {
  return (
    <div className="border-t border-line px-3 py-2">
      <Button className="w-full" disabled={disabled} onClick={onRefresh} title={t("actionTitle")}>
        <RefreshIcon className={cn(disabled && "animate-spin")} />
        {t("actionTitle")}
      </Button>
    </div>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} fill="currentColor" aria-hidden="true">
      <path d="M12 5V2L7.5 6.5 12 11V8a5 5 0 1 1-5 5H5a7 7 0 1 0 7-8z" />
    </svg>
  );
}
