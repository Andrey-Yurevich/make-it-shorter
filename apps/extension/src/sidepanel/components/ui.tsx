import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ButtonHTMLAttributes } from "react";

// The handful of shadcn/ui-shaped primitives the panel actually uses. They are written
// here rather than generated: the panel has one button and two icons, and a component
// library's worth of files would be furniture around them. Icons used in one place only
// live next to their component.

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost";
};

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors",
        "disabled:cursor-default disabled:opacity-45",
        variant === "primary" && "bg-ink px-3 py-2 text-white enabled:hover:bg-ink/85",
        variant === "outline" &&
          "border border-line bg-surface px-3 py-1.5 text-ink enabled:hover:bg-surface-muted",
        variant === "ghost" && "px-2 py-1.5 text-ink-soft enabled:hover:bg-surface-muted",
        className,
      )}
    />
  );
}

// A grey bar that pulses where text is about to appear. Shape and size come from the
// caller; this only knows how to look like a placeholder. The colour is darker than the
// border grey on purpose: the bars sit on the muted surface, and the pulse halves their
// opacity, so anything lighter disappears into the field.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-ink/15", className)} />;
}

type IconProps = { className?: string };

export function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} fill="currentColor" aria-hidden="true">
      <path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z" />
    </svg>
  );
}

export function StarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} fill="currentColor" aria-hidden="true">
      <path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6.1-5.3-3-5.3 3 1.1-6.1L3.4 9.4l6-.8z" />
    </svg>
  );
}
