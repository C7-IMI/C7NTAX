/**
 * Colour literals the UI needs but Tailwind classes cannot express.
 *
 * The customer portal's accent is *data*: a provider sets it per client, so it arrives at runtime
 * and can never be a class name. These are the fallback for when nothing has been configured and
 * the foreground that sits on top of whatever has been. Keeping them in one module means the
 * design-token guard's rule — no raw hex in a `.tsx` — can hold without the same literal being
 * repeated at every use.
 */
export const DEFAULT_ACCENT_COLOUR = "#22d3ee";

/** Foreground for text and icons placed on an accent-coloured surface. */
export const ON_ACCENT_COLOUR = "#04121b";

/** The example a colour field shows, so the expected format is obvious. */
export const ACCENT_COLOUR_HINT = "#2563eb";

/** `#rrggbb`, the only colour format the configuration API accepts. */
export const HEX_COLOUR_PATTERN = /^#[0-9a-f]{6}$/i;
