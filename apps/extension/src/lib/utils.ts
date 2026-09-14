import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn/ui's class helper, at the path its generated components import it from.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
