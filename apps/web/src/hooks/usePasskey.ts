/**
 * Passkey (WebAuthn) client helpers — PLAN-002 §6.1.
 *
 * Registration and sign-in are the same three steps in both directions: ask the server for
 * options, let the browser's authenticator answer them, hand the answer back for verification.
 * The management calls exist so a user can see what they have registered, rename it, and remove
 * a device they no longer hold.
 */
import { useCallback, useEffect, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import api from "../api";

export interface PasskeyInfo {
  id: string;
  credentialId: string;
  deviceName: string | null;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

const supported = (): boolean =>
  typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";

export function usePasskey({ autoLoad = false }: { autoLoad?: boolean } = {}) {
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSupported = supported();

  const refresh = useCallback(async () => {
    const { data } = await api.get<PasskeyInfo[]>("/auth/webauthn/credentials");
    setPasskeys(Array.isArray(data) ? data : []);
    return data as PasskeyInfo[];
  }, []);

  useEffect(() => {
    if (!autoLoad || !isSupported) return;
    void refresh().catch(() => { /* the page decides how to degrade */ });
  }, [autoLoad, isSupported, refresh]);

  /** Register this device. The label is the browser's own description unless one is given. */
  const registerPasskey = useCallback(async (deviceName?: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data: options } = await api.post("/auth/webauthn/register/options");
      const credential = await startRegistration({ optionsJSON: options });
      const { data } = await api.post("/auth/webauthn/register/verify", { ...credential, deviceName });
      setPasskeys(prev => [data as PasskeyInfo, ...prev.filter(p => p.id !== (data as PasskeyInfo).id)]);
      return data as PasskeyInfo;
    } catch (err: unknown) {
      const message = describe(err, "Passkey registration failed");
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Returns the token for the caller to adopt; the hook does not own the session. */
  const loginWithPasskey = useCallback(async (email: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post("/auth/webauthn/login/options", { email });
      const assertion = await startAuthentication({ optionsJSON: data.options });
      const verify = await api.post("/auth/webauthn/login/verify", { userId: data.userId, response: assertion });
      return verify.data.token as string;
    } catch (err: unknown) {
      const message = describe(err, "Passkey sign-in failed");
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const renamePasskey = useCallback(async (id: string, deviceName: string) => {
    const { data } = await api.patch(`/auth/webauthn/credentials/${id}`, { deviceName });
    setPasskeys(prev => prev.map(p => (p.id === id ? (data as PasskeyInfo) : p)));
    return data as PasskeyInfo;
  }, []);

  const removePasskey = useCallback(async (id: string) => {
    await api.delete(`/auth/webauthn/credentials/${id}`);
    setPasskeys(prev => prev.filter(p => p.id !== id));
  }, []);

  return { passkeys, loading, error, isSupported, refresh, registerPasskey, loginWithPasskey, renamePasskey, removePasskey };
}

/** Cancellation is not a failure worth alarming anyone about. */
function describe(err: unknown, fallback: string): string {
  const named = err as { name?: string; message?: string; response?: { data?: { error?: string | { message?: string } } } };
  if (named?.name === "NotAllowedError") return "The passkey prompt was dismissed or timed out — try again, or use your password.";
  if (named?.name === "NotSupportedError") return "This browser or device cannot use passkeys.";
  // Raised when the authenticator already holds a credential for this account (the server
  // sends it in excludeCredentials), which is a state to explain rather than an error to print.
  if (named?.name === "InvalidStateError") return "This device already has a passkey for your account — remove it from the list first if you need to register it again.";
  const body = named?.response?.data?.error;
  return (typeof body === "string" ? body : body?.message) || named?.message || fallback;
}
