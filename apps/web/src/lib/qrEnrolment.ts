/**
 * Reading an enrolment QR out of a screenshot (PLAN-015 Phase B #7).
 *
 * The workflow this exists for: somebody screenshotted their authenticator QR (or was handed the
 * image) and now needs the base32 key to type in by hand, because the screen that showed it is
 * gone. Decoding happens **in the browser** — the image is not uploaded anywhere, because a QR
 * screenshot is that user's own credential material and there is no reason for it to leave the
 * machine, and because the server would otherwise need an image-decoding dependency to do the same
 * arithmetic.
 *
 * `BarcodeDetector` is used when the browser has it (Chrome and Edge do), with `jsQR` as the
 * fallback for the ones that do not.
 */
import jsQR from "jsqr";

export interface DecodedEnrolment {
  /** The base32 secret from the otpauth URI, spaced for readability. */
  secret: string;
  /** Who the QR says it is for, when the URI carries it. */
  label: string | null;
  issuer: string | null;
  /** The full URI, so a caller can show it rather than second-guess it. */
  uri: string;
}

/** Pulls the parts out of an `otpauth://totp/...` URI. Returns null for anything else. */
export function parseOtpAuth(uri: string): DecodedEnrolment | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== "otpauth:") return null;
  if (url.host.toLowerCase() !== "totp") return null;
  const secret = (url.searchParams.get("secret") || "").replace(/\s+/g, "").toUpperCase();
  if (!secret) return null;
  const rawLabel = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return {
    secret,
    label: rawLabel || null,
    issuer: url.searchParams.get("issuer") || rawLabel.split(":").map(p => p.trim())[0] || null,
    uri,
  };
}

/** Reads the image into pixels. Kept separate so the decode path is testable in one place. */
async function imageDataFrom(file: File): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  // A very large screenshot is scaled down: a QR needs a few hundred pixels, and decoding a
  // 4000px screenshot pixel by pixel is the difference between instant and not.
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot read the image");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width, height };
}

/** The raw QR text, from the browser's own detector when it has one, otherwise jsQR. */
async function decodeQrText(file: File): Promise<string | null> {
  const Detector = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
  if (Detector) {
    try {
      const detector = new Detector({ formats: ["qr_code"] });
      const bitmap = await createImageBitmap(file);
      const found = await detector.detect(bitmap);
      const value = found?.[0]?.rawValue;
      if (value) return value;
    } catch {
      // A detector that exists but refuses this image is not a reason to fail: fall through to jsQR.
    }
  }
  const { data, width, height } = await imageDataFrom(file);
  const result = jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
  return result?.data ?? null;
}

/**
 * The decoded enrolment from a screenshot, or a reason it could not be read. A screenshot that
 * contains no QR, or a QR that is not a TOTP enrolment, is an ordinary outcome and not an error.
 */
export async function readEnrolmentFromImage(file: File): Promise<{ ok: true; enrolment: DecodedEnrolment } | { ok: false; reason: string }> {
  if (!file.type.startsWith("image/")) return { ok: false, reason: "That is not an image file" };
  let text: string | null;
  try {
    text = await decodeQrText(file);
  } catch (err) {
    return { ok: false, reason: `The image could not be read (${(err as Error).message})` };
  }
  if (!text) return { ok: false, reason: "No QR code was found in that image" };
  const enrolment = parseOtpAuth(text);
  if (!enrolment) return { ok: false, reason: "That QR code is not an authenticator enrolment (it is not an otpauth:// TOTP code)" };
  return { ok: true, enrolment };
}

/** Groups the secret in fours, the way an authenticator app's manual entry expects it. */
export function formatSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}
