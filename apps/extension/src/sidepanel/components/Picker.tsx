import { useState } from "react";
import { cn } from "./ui.tsx";

export type PickerOption = { value: string; label: string };

// The two controls in the top row are the same thing twice: a button showing the current
// value and a list that drops out of it. A native <select> would have been shorter, but
// it can only show the option text on the button, and the button has to read "RUS🇷🇺"
// while the list reads "русский".
export function Picker({
  badge,
  title,
  value,
  options,
  onChange,
}: {
  badge: string;
  title: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex-1">
      <button
        onClick={() => setOpen(!open)}
        title={title}
        aria-label={title}
        aria-expanded={open}
        className="flex w-full items-center justify-center gap-1 rounded-lg border border-line px-2 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted"
      >
        <span className="truncate">{badge}</span>
        <ChevronIcon className={cn("shrink-0", open && "rotate-180")} />
      </button>

      {open && (
        <>
          {/* Anywhere outside closes it, including a click on the other picker. */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <ul className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
            {options.map((option) => (
              <li key={option.value}>
                <button
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "block w-full px-3 py-1.5 text-start text-sm text-ink hover:bg-surface-muted",
                    option.value === value && "font-semibold",
                  )}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-3 text-ink-soft transition-transform", className)}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6z" />
    </svg>
  );
}
