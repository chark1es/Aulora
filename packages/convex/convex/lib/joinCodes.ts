/** How long an emailed join code stays valid. */
export const JOIN_CODE_TTL_MINUTES = 10;

/** Wrong guesses allowed against one emailed code before it is burned. */
export const JOIN_CODE_MAX_ATTEMPTS = 5;

/** Digits in an emailed join code. */
export const JOIN_CODE_DIGITS = 6;

/** Codes a person can request per window. */
export const JOIN_CODE_REQUEST_LIMIT = 3;
export const JOIN_CODE_REQUEST_WINDOW_MS = 10 * 60_000;
