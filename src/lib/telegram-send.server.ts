import { getUserSupabase } from "./user-supabase.server";

const TG_API = "https://api.telegram.org";

async function getBotToken(): Promise<string | null> {
  // 1. Try environment variable first
  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  if (envToken) return envToken;

  // 2. Fallback: Supabase bot_config table
  try {
    const sb = getUserSupabase();
    const { data } = await sb
      .from("bot_config")
      .select("value")
      .eq("key", "telegram_bot_token")
      .single();
    return (data as Record<string, string> | null)?.value ?? null;
  } catch {
    return null;
  }
}

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = await getBotToken();
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" };
  try {
    const resp = await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const json = (await resp.json()) as { ok: boolean; description?: string };
    if (!json.ok) {
      return {
        ok: false,
        error:
          json.description ??
          "Telegram refused the message. The user must press Start on @GtechAI_Bot first.",
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}
