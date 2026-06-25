import process from "node:process";

const BUCKET = "query-photos";
const PUBLIC_PREFIX = "/storage/v1/object/public/" + BUCKET + "/";

function getSecret(): string {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.TELEGRAM_BOT_TOKEN || "fallback-img-secret";
  return k;
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Extract the storage object path from a Supabase public URL. Returns null if not one. */
export function extractStoragePath(url: string | null | undefined): string | null {
  if (!url) return null;
  const idx = url.indexOf(PUBLIC_PREFIX);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + PUBLIC_PREFIX.length));
}

/** Build a signed proxy URL for a storage path or public URL. Returns null if not signable. */
export async function buildSignedImageHref(input: string | null | undefined): Promise<string | null> {
  const path = extractStoragePath(input);
  if (!path) return null;
  const sig = await hmacHex(getSecret(), path);
  return `/api/img?p=${encodeURIComponent(path)}&sig=${sig}`;
}

export async function verifyImageSig(path: string, sig: string): Promise<boolean> {
  const expected = await hmacHex(getSecret(), path);
  if (expected.length !== sig.length) return false;
  let r = 0;
  for (let i = 0; i < expected.length; i++) r |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return r === 0;
}

export const STORAGE_BUCKET = BUCKET;