import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { addKeystroke, matchIndex, type Typing } from "../../shared/typeahead.ts";
import { cn } from "./ui.tsx";

export type PickerOption = { value: string; label: string };

// The two controls under the input field are the same thing twice: a button showing the
// value the user picked and a list that drops out of it. A native <select> would have
// been shorter, but it cannot be styled to match the rest of the panel, and on Windows
// it draws a list this narrow with its own scrollbar and its own font.
//
// Losing <select> costs its keyboard behaviour, which has to be written out here: sixty-
// odd languages are unusable if the only way through them is the scrollbar.
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
  // The option the keyboard is on. Separate from the chosen value: moving through the
  // list settles nothing until Enter, the same as in the control this replaces.
  const [active, setActive] = useState(-1);
  const typed = useRef<Typing>({ text: "", at: 0 });
  const list = useRef<HTMLUListElement>(null);
  const optionId = useId();

  // The button says exactly what the user chose. A value with no option behind it can
  // only come from settings written by an older build, and its own code reads better
  // than a blank button.
  const selected = options.findIndex((option) => option.value === value);
  const selectedLabel = selected === -1 ? value : options[selected].label;

  // Follow the keyboard. "nearest" scrolls only when the option is off screen, so
  // walking through neighbours does not jerk the list around on every step.
  useEffect(() => {
    if (open && active >= 0) {
      list.current?.children[active]?.scrollIntoView({ block: "nearest" });
    }
  }, [open, active]);

  function show(): void {
    setOpen(true);
    setActive(selected);
  }

  function hide(): void {
    setOpen(false);
    setActive(-1);
    typed.current = { text: "", at: 0 };
  }

  function choose(index: number): void {
    onChange(options[index].value);
    hide();
  }

  // Where the typing lands. The rules are in shared/typeahead.ts; what is left here is
  // the part that needs a component — remembering the keystrokes and moving the
  // highlight. A search that matches nothing leaves the highlight alone: jumping to the
  // top on a typo would lose the user's place as surely as filtering would.
  function jump(char: string, base: number): void {
    typed.current = addKeystroke(typed.current, char, Date.now());
    const index = matchIndex(
      options.map((option) => option.label),
      typed.current.text,
      base,
    );
    if (index !== -1) {
      setActive(index);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "Escape") {
      hide();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + options.length) % options.length);
      return;
    }

    // Enter and Space on a focused button fire a click, which is exactly right while the
    // list is shut — it opens it. With the list open and the keyboard on an option, that
    // click would close the list instead of taking the option, so it is stopped here.
    if (event.key === "Enter" || event.key === " ") {
      if (open && active >= 0) {
        event.preventDefault();
        choose(active);
      }
      return;
    }

    // One printable character is a search. Combinations belong to the browser — Cmd+W is
    // not a request for Welsh.
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!open) {
        show();
      }
      jump(event.key, active === -1 ? selected : active);
    }
  }

  return (
    <div className="relative flex-1">
      <button
        type="button"
        onClick={() => (open ? hide() : show())}
        onKeyDown={onKeyDown}
        // The value is the whole of the button, so the name of the control has to come
        // from here — a <label> cannot name a button.
        aria-label={`${label}: ${selectedLabel}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        // What a screen reader should read out as the keyboard moves, given that focus
        // itself never leaves this button.
        aria-activedescendant={open && active >= 0 ? `${optionId}-${active}` : undefined}
        className="flex w-full items-center justify-between gap-1 rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink hover:bg-surface-muted"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronIcon className={cn("shrink-0", open && "rotate-180")} />
      </button>

      {open && (
        <>
          {/* Anywhere outside closes it, including a click on the other picker. */}
          <div className="fixed inset-0 z-30" onClick={hide} />
          <ul
            ref={list}
            role="listbox"
            aria-label={label}
            className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg"
          >
            {options.map((option, index) => (
              <li key={option.value}>
                <button
                  type="button"
                  id={`${optionId}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  // Out of the tab order on purpose: the keyboard drives this list from
                  // the button above, and a second way in would leave two carets in one
                  // control disagreeing about where the user is.
                  tabIndex={-1}
                  onClick={() => choose(index)}
                  onMouseMove={() => setActive(index)}
                  className={cn(
                    "block w-full px-3 py-1.5 text-start text-sm text-ink",
                    index === active && "bg-surface-muted",
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
