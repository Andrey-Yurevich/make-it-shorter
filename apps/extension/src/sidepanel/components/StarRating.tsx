import { useState } from "react";
import { RATE_US_URL } from "../../shared/limits.ts";
import { CloseIcon, StarIcon, cn } from "./ui.tsx";

// Five stars, on a strip along the bottom of the panel. A click hands the number to the landing
// page and the widget is gone for good; what the landing page does with it is not this
// extension's business.
export function StarRating({ onHide }: { onHide: () => void }) {
  const [hovered, setHovered] = useState(0);

  function rate(stars: number): void {
    chrome.tabs.create({ url: `${RATE_US_URL}?stars=${stars}` });
    onHide();
  }

  return (
    <div className="flex items-center gap-0.5 border-t border-line px-3 py-1.5" onMouseLeave={() => setHovered(0)}>
      <span className="flex-1 text-xs text-ink-soft">Rate us</span>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onMouseEnter={() => setHovered(star)}
          onClick={() => rate(star)}
          aria-label={`Rate us ${star} out of 5`}
          className={cn("p-0.5", star <= hovered ? "text-ink" : "text-line")}
        >
          <StarIcon />
        </button>
      ))}
      <button type="button" onClick={onHide} aria-label="Close" className="p-0.5 text-ink-soft">
        <CloseIcon className="size-3" />
      </button>
    </div>
  );
}
