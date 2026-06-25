import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramAuthPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

// Telegram Login Widget verification.
// https://core.telegram.org/widgets/login#checking-authorization
export function verifyTelegramAuth(payload: TelegramAuthPayload): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not configured");

  const { hash, ...rest } = payload;
  const dataCheckString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${(rest as Record<string, unknown>)[k]}`)
    .join("\n");

  const secret = createHash("sha256").update(token).digest();
  const hmac = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  try {
    const a = Buffer.from(hmac, "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length) return false;
    if (!timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - payload.auth_date > 86400) return false;
  return true;
}