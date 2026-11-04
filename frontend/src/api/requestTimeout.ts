/**
 * How long the browser waits for an API response before showing an error.
 * Cloudflare gives up on the origin after 100 s and gunicorn on a request after
 * 30 s, so a response later than this is not worth keeping a spinner up for.
 */
export const API_REQUEST_TIMEOUT_MS = 60_000;
