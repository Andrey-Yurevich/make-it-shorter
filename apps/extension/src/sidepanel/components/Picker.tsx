import { useState } from "react";
import { cn } from "./ui.tsx";

export type PickerOption = { value: string; label: string };

// The two controls under the input field are the same thing twice: a button showing the
// value the user picked and a list that drops out of it. A native <select> would have
// been shorter, but it cannot be styled to match the rest of the panel, and on Windows
// it draws a list this narrow with its own scrollbar and its own font.
export function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // The button says exactly what the user chose. A value with no option behind it can
  // only come from settings written by an older build, and its own code reads better
  // than a blank button.
  const selected = options.find((option) => option.value === value)?.label ?? value;

  return (
    <div className="relative flex-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        // The value is the whole of the button, so the name of the control has to come
        // from here — a <label> cannot name a button.
        aria-label={`${label}: ${selected}`}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-1 rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink hover:bg-surface-muted"
      >
        <span className="truncate">{selected}</span>
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
                  type="button"
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
