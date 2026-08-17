import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ButtonHTMLAttributes } from "react";

// The handful of shadcn/ui-shaped primitives the panel actually uses. They are written
// here rather than generated: the panel has one button, one icon button and five icons,
// and a component library's worth of files would be furniture around them.

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

type IconProps = { className?: string };

export function MenuIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5", className)} fill="currentColor" aria-hidden="true">
      <rect x="4" y="6" width="16" height="2" rx="1" />
      <rect x="4" y="11" width="16" height="2" rx="1" />
      <rect x="4" y="16" width="16" height="2" rx="1" />
    </svg>
  );
}

export function LogoIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-5", className)} fill="currentColor" aria-hidden="true">
      <rect x="7" y="9" width="18" height="3" rx="1.5" />
      <rect x="7" y="14.5" width="12" height="3" rx="1.5" />
      <rect x="7" y="20" width="6" height="3" rx="1.5" />
    </svg>
  );
}

export function SendIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} fill="currentColor" aria-hidden="true">
      <path d="M4 12 20 4l-4 8 4 8z" />
    </svg>
  );
}

export function GearIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} fill="currentColor" aria-hidden="true">
      <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5zm9 3.5-2.1-.6a7 7 0 0 0-.6-1.5l1.1-1.9-2.4-2.4-1.9 1.1a7 7 0 0 0-1.5-.6L13 3.5h-2l-.6 2.1a7 7 0 0 0-1.5.6L7 5.1 4.6 7.5l1.1 1.9a7 7 0 0 0-.6 1.5L3 12v2l2.1.6a7 7 0 0 0 .6 1.5l-1.1 1.9 2.4 2.4 1.9-1.1a7 7 0 0 0 1.5.6l.6 2.1h2l.6-2.1a7 7 0 0 0 1.5-.6l1.9 1.1 2.4-2.4-1.1-1.9a7 7 0 0 0 .6-1.5l2.1-.6z" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} fill="currentColor" aria-hidden="true">
      <path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} fill="currentColor" aria-hidden="true">
      <path d="M9 3h6l1 2h4v2H4V5h4zM6 8h12l-1 13H7z" />
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
