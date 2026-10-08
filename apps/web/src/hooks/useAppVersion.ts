import { useEffect, useState } from "react";
import api from "../api";

export interface AppVersion {
  version: string;
  date: string | null;
  title: string | null;
}

/**
 * The version of the running build, as its newest BuildNotes entry names it.
 *
 * Fetched once per page load and shared by every caller: the whole point of the label is that it
 * identifies the build, which cannot change while the page is open. A failure is silence, so a build
 * whose notes cannot be read shows no label rather than an error in the account menu.
 */
let pending: Promise<AppVersion | null> | null = null;

function fetchOnce(): Promise<AppVersion | null> {
  if (!pending) {
    pending = api
      .get("/system/version")
      .then(res => {
        const version = res.data?.version;
        if (typeof version !== "string" || !version) return null;
        return {
          version,
          date: typeof res.data?.date === "string" ? res.data.date : null,
          title: typeof res.data?.title === "string" ? res.data.title : null,
        };
      })
      .catch(() => null);
  }
  return pending;
}

export function useAppVersion(): AppVersion | null {
  const [version, setVersion] = useState<AppVersion | null>(null);

  useEffect(() => {
    let mounted = true;
    void fetchOnce().then(value => {
      if (mounted) setVersion(value);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return version;
}
