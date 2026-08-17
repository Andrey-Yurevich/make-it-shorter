import { t } from "../../shared/i18n.ts";
import { Button, LogoIcon, MenuIcon } from "./ui.tsx";

export function Header({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="flex items-center gap-2 border-b border-line px-3 py-2">
      <Button variant="ghost" onClick={onMenu} title={t("menuTitle")} aria-label={t("menuTitle")}>
        <MenuIcon />
      </Button>
      <LogoIcon className="text-ink" />
      <span className="text-sm font-semibold text-ink">make it shorter</span>
    </header>
  );
}
