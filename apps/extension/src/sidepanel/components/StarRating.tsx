import { StarIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RATE_US_URL } from "@/shared/limits.ts";

// Five stars on a strip along the bottom of the panel. A click hands the number to the
// landing page and the strip is gone for good; what the landing page does with it is
// not this extension's business.
export function StarRating({ onHide }: { onHide: () => void }) {
  const [hovered, setHovered] = useState(0);

  function rate(stars: number): void {
    void chrome.tabs.create({ url: `${RATE_US_URL}?stars=${stars}` });
    onHide();
  }

  return (
    <div className="flex items-center gap-0.5 border-t px-3 py-1.5" onMouseLeave={() => setHovered(0)}>
      <span className="flex-1 text-xs text-muted-foreground">Rate us</span>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onMouseEnter={() => setHovered(star)}
          onClick={() => rate(star)}
          aria-label={`Rate us ${star} out of 5`}
          className={cn("p-0.5", star <= hovered ? "text-foreground" : "text-muted-foreground/40")}
        >
          <StarIcon className="size-4" fill="currentColor" />
        </button>
      ))}
      <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onHide} className="ms-1">
        <XIcon />
      </Button>
    </div>
  );
}
