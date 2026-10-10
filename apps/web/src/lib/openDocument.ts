/**
 * Open one of the API's printable documents — an invoice, a quote, a statement — in a tab, or hand it
 * over as a file when the browser blocks the tab.
 *
 * Three things this does that a plain `window.open(url)` cannot, and each is the reason it is one
 * function rather than the same twenty lines in three screens:
 *
 * · **The credential never goes in a URL.** The document routes need the caller's token, and a token in
 *   a query string lands in the browser's history, in any proxy's log and in the server's own access
 *   log. The fetch carries it in a header and the tab is pointed at a `blob:` URL instead.
 * · **The tab is opened synchronously**, before the await. A popup raised after an await has lost the
 *   click's activation and is blocked, which is how "the button did nothing" happens.
 * · **A blocked popup still produces the document** — it falls back to a download rather than silence.
 */
import { getAuthToken } from "../api";

export async function openApiDocument(
  path: string,
  { filename, failure }: { filename: string; failure: string },
): Promise<void> {
  const token = getAuthToken();
  const win = window.open("", "_blank");
  if (win) win.opener = null;
  try {
    const response = await fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!response.ok) {
      win?.close();
      const { default: toast } = await import("react-hot-toast");
      toast.error(failure);
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    if (win) {
      win.location.href = url;
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    win?.close();
    const { default: toast } = await import("react-hot-toast");
    toast.error(failure);
  }
}
