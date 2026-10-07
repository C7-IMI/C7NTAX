/**
 * The API's own message, whichever shape it arrived in.
 *
 * Two envelopes are in the wild and both are deliberate:
 *   · middleware refuses before a route runs and answers `{ error: "…" }`
 *     (auth, rate limiting, the session timeout);
 *   · a route that calls `next(new AppError(…))` is rendered by the error handler as
 *     `{ error: { message, status } }`.
 *
 * Reading only one of them is how a form ends up telling somebody their input was
 * "[object Object]". Prefer the API's words over a generic failure, and fall back to
 * the caller's own message when the API sent nothing readable.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const error = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  if (typeof error === "string" && error) return error;
  const message = (error as { message?: unknown } | undefined)?.message;
  if (typeof message === "string" && message) return message;
  return fallback;
}
