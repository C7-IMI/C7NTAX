import { useEffect, useState } from "react";
import api from "../api";

/**
 * The address this browser is connecting from, as the API sees it.
 *
 * One request per page load, shared by every caller: the sign-in screen and the account menu ask the
 * same question, and the answer cannot change while the page is open. A failure is silence — the line
 * it feeds simply does not render — because a diagnostic convenience is not worth an error message.
 */
let pending: Promise<string | null> | null = null;

function fetchOnce(): Promise<string | null> {
  if (!pending) {
    pending = api
      .get("/auth/client-ip")
      .then(res => (typeof res.data?.ip === "string" && res.data.ip ? (res.data.ip as string) : null))
      .catch(() => null);
  }
  return pending;
}

export function useClientIp(): string | null {
  const [ip, setIp] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void fetchOnce().then(value => {
      if (mounted) setIp(value);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return ip;
}
