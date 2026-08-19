// The built-in thresholds. They exist for one reason only: not to spend a request on
// text that is obviously unusable. The thresholds that actually decide are the server's,
// and the extension never learns them — it hears about them as too_short / too_long.
//
// That is why these are chosen on the soft side. A server tightening arrives on its own
// with the next request; a server loosening runs into whatever is compiled in here, so
// a value that is too strict cannot be undone from the server at all.
export const MIN_INPUT = 50;
export const MAX_INPUT = 30_000;

// One absolute deadline from the start of the request to `done`. The function itself is
// capped at 50s, so this covers "went quiet after three deltas" as well; a second timer
// on the gap between events would have to sit above the 25s phase 2 and would fire
// almost never before this one.
export const REQUEST_TIMEOUT_MS = 60_000;

export const API_URL = "https://api.make-it-shorter.net/v1/shorten";

export const RATE_US_URL = "https://make-it-shorter.net/rate-us";
export const WELCOME_URL = "https://make-it-shorter.net/welcome";
export const UNINSTALL_URL = "https://make-it-shorter.net/uninstall";
