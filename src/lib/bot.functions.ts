import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { ADMIN_USERNAMES, isAdmin, isTrainer, normalizeUsername, userDb } from "@/config/user-db";
import { getUserSupabase } from "./user-supabase.server";
import { sendTelegramMessage } from "./telegram-send.server";

// ---------- OTP flow ----------

function gen4(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export const requestOtp = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        identifier: z.string().min(1).max(64),
        mode: z.enum(["username"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = getUserSupabase();
    const u = userDb.users;
    const raw = data.identifier.trim();
    const username = normalizeUsername(raw);

    const { data: user, error: uerr } = await supabase
      .from(u.table)
      .select("*")
      .ilike(u.username, username)
      .maybeSingle();

    if (uerr) return { ok: false as const, error: uerr.message };
    if (!user) {
      return {
        ok: false as const,
        error: "Username not found. Please open @GtechAI_Bot on Telegram, press Start, then try again.",
      };
    }

    const userRec = user as unknown as Record<string, unknown>;
    const tgId = userRec[u.telegramId] as number;
    const realUsername = (userRec[u.username] as string) ?? raw;

    // (OTP daily limit removed — users can request as many codes as needed.)


    const code = gen4();
    // 2-minute expiry
    const expires = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const { error: oerr } = await supabase.from("otp_codes").insert({
      telegram_id: tgId,
      username: realUsername,
      code,
      expires_at: expires,
    });
    if (oerr) return { ok: false as const, error: oerr.message };

    const sent = await sendTelegramMessage(
      tgId,
      `🔐 <b>GTech AI OTP</b>\n\nYour verification code is:\n<code>${code}</code>\n\nIt expires in <b>2 minutes</b>.\nIf you didn't request this, ignore this message.`,
    );
    if (!sent.ok) {
      return {
        ok: false as const,
        error: `Could not deliver OTP via Telegram. ${sent.error ?? ""}\nMake sure you've pressed Start on @GtechAI_Bot.`,
      };
    }
    return { ok: true as const, username: realUsername, telegramId: tgId };
  });

export const verifyOtp = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        identifier: z.string().min(1).max(64),
        code: z.string().regex(/^\d{4}$/),
        mode: z.enum(["username"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = getUserSupabase();
    const u = userDb.users;
    const raw = data.identifier.trim();
    const username = normalizeUsername(raw);

    const { data: user } = await supabase
      .from(u.table)
      .select("*")
      .ilike(u.username, username)
      .maybeSingle();

    if (!user) return { ok: false as const, error: "User not found." };
    const userRec = user as unknown as Record<string, unknown>;
    const tgId = userRec[u.telegramId] as number;
    const realUsername = (userRec[u.username] as string) ?? raw;

    const { data: otp } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("telegram_id", tgId)
      .eq("consumed", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otp)
      return { ok: false as const, error: "No active OTP. Please request a new code." };
    if (new Date(otp.expires_at as string).getTime() < Date.now())
      return { ok: false as const, error: "OTP expired (2 min limit). Please request a new code." };
    if ((otp.attempts as number) >= 5)
      return { ok: false as const, error: "Too many attempts. Request a new code." };
    if ((otp.code as string) !== data.code) {
      await supabase
        .from("otp_codes")
        .update({ attempts: (otp.attempts as number) + 1 })
        .eq("id", otp.id);
      return { ok: false as const, error: "Incorrect code." };
    }
    await supabase.from("otp_codes").update({ consumed: true }).eq("id", otp.id);

    const { data: session, error: serr } = await supabase
      .from("chat_sessions")
      .insert({
        telegram_username: realUsername,
        telegram_user_id: tgId,
        verified: true,
      })
      .select("id")
      .single();
    if (serr) return { ok: false as const, error: serr.message };
    return {
      ok: true as const,
      sessionId: session.id as string,
      username: realUsername,
      userId: tgId,
      isAdmin: isAdmin(realUsername),
      isTrainer: isTrainer(realUsername),
    };
  });

export const saveMessage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = getUserSupabase();
    const { error } = await supabase.from("chat_messages").insert({
      session_id: data.sessionId,
      role: data.role,
      content: data.content,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const getChatHistory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const supabase = getUserSupabase();
    const { data: rows, error } = await supabase
      .from("chat_messages")
      .select("role,content,created_at")
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) return { ok: false as const, error: error.message, messages: [] };
    return { ok: true as const, messages: rows ?? [] };
  });

async function requireVerified(sessionId: string) {
  const supabase = getUserSupabase();
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("telegram_username,telegram_user_id,verified")
    .eq("id", sessionId)
    .single();
  if (error || !data) throw new Error("Session not found");
  if (!data.verified) throw new Error("Telegram login required for this action");
  return data as {
    telegram_username: string;
    telegram_user_id: number | null;
    verified: boolean;
  };
}

export const getUserData = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const session = await requireVerified(data.sessionId);
      const supabase = getUserSupabase();
      const u = userDb.users;
      const d_ = userDb.deposits;
      const w = userDb.withdrawals;
      const username = session.telegram_username;
      const tgId = session.telegram_user_id;
      const [userRes, depRes, wdRes] = await Promise.all([
        supabase.from(u.table).select("*").eq(u.username, username).maybeSingle(),
        supabase
          .from(d_.table)
          .select("*")
          .eq(d_.telegramId, tgId as number)
          .order(d_.createdAt, { ascending: false })
          .limit(20),
        supabase
          .from(w.table)
          .select("*")
          .eq(w.telegramId, tgId as number)
          .order(w.createdAt, { ascending: false })
          .limit(20),
      ]);
      return {
        ok: true as const,
        username,
        user: userRes.data ?? null,
        deposits: depRes.data ?? [],
        withdrawals: wdRes.data ?? [],
        balance:
          (userRes.data as Record<string, unknown> | null)?.[u.balance] ?? null,
        errors: {
          user: userRes.error?.message ?? null,
          deposits: depRes.error?.message ?? null,
          withdrawals: wdRes.error?.message ?? null,
        },
      };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "error",
      };
    }
  });

// ---------- Trainer-only knowledge base ----------

async function requireTrainer(sessionId: string) {
  const session = await requireVerified(sessionId);
  if (!isTrainer(session.telegram_username)) {
    throw new Error("Forbidden: trainer only (@Yashu_Gtech)");
  }
  return session;
}

export const listTrainingDocs = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    try {
      await requireTrainer(data.sessionId);
      const supabase = getUserSupabase();
      const { data: rows, error } = await supabase
        .from("training_docs")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) return { ok: false as const, error: error.message };
      return { ok: true as const, rows: rows ?? [] };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "error" };
    }
  });

export const upsertTrainingDoc = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        id: z.string().uuid().optional(),
        title: z.string().min(1).max(200),
        content: z.string().min(1).max(20000),
        tags: z.array(z.string().max(40)).max(20).optional(),
        active: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const session = await requireTrainer(data.sessionId);
      const supabase = getUserSupabase();
      const payload = {
        title: data.title,
        content: data.content,
        tags: data.tags ?? [],
        active: data.active ?? true,
        created_by: session.telegram_username,
        updated_at: new Date().toISOString(),
      };
      if (data.id) {
        const { error } = await supabase
          .from("training_docs")
          .update(payload)
          .eq("id", data.id);
        if (error) return { ok: false as const, error: error.message };
      } else {
        const { error } = await supabase.from("training_docs").insert(payload);
        if (error) return { ok: false as const, error: error.message };
      }
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "error" };
    }
  });

export const deleteTrainingDoc = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({ sessionId: z.string().uuid(), id: z.string().uuid() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      await requireTrainer(data.sessionId);
      const supabase = getUserSupabase();
      const { error } = await supabase
        .from("training_docs")
        .delete()
        .eq("id", data.id);
      if (error) return { ok: false as const, error: error.message };
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "error" };
    }
  });

export const verifyTxn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        hash: z.string().min(6).max(128),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const session = await requireVerified(data.sessionId);
      const supabase = getUserSupabase();
      const d_ = userDb.deposits;
      const w = userDb.withdrawals;
      const tgId = session.telegram_user_id;
      const [dep, wd] = await Promise.all([
        supabase
          .from(d_.table)
          .select("*")
          .eq(d_.txnHash, data.hash)
          .eq(d_.telegramId, tgId as number)
          .maybeSingle(),
        supabase
          .from(w.table)
          .select("*")
          .eq(w.txnHash, data.hash)
          .eq(w.telegramId, tgId as number)
          .maybeSingle(),
      ]);
      const record = dep.data ?? wd.data;
      if (!record) {
        return {
          ok: true as const,
          found: false,
          message: `TXN ${data.hash} was not found in your deposits or withdrawals.`,
        };
      }
      return {
        ok: true as const,
        found: true,
        type: dep.data ? "deposit" : "withdrawal",
        record,
      };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "error",
      };
    }
  });

// ---------- Admin requests (with photo support) ----------

export const createAdminRequest = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        subject: z.string().max(200).optional(),
        message: z.string().min(2).max(4000),
        photoUrl: z.string().url().optional(),
        assignedAdmin: z
          .enum(ADMIN_USERNAMES as unknown as [string, ...string[]])
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const session = await requireVerified(data.sessionId);
      const supabase = getUserSupabase();
      const { error } = await supabase.from("admin_requests").insert({
        telegram_username: session.telegram_username,
        telegram_user_id: session.telegram_user_id,
        subject: data.subject ?? null,
        message: data.message,
        photo_url: data.photoUrl ?? null,
        assigned_admin: data.assignedAdmin ?? null,
        status: "pending",
      });
      if (error) return { ok: false as const, error: error.message };
      return { ok: true as const };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "error",
      };
    }
  });

// ---------- User queries (history only — users no longer raise manually) ----------

export const getUserQueries = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const session = await requireVerified(data.sessionId);
      const supabase = getUserSupabase();
      const { data: rows, error } = await supabase
        .from("admin_requests")
        .select(
          "id,subject,message,status,photo_url,ai_analysis,ai_summary,admin_reply,reply_photo_url,replied_at,replied_by,source,created_at",
        )
        .ilike("telegram_username", session.telegram_username)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return { ok: false as const, error: error.message };
      return { ok: true as const, rows: rows ?? [] };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "error" };
    }
  });

export const reopenUserQuery = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        id: z.string().uuid(),
        message: z.string().min(2).max(4000),
        imageBase64: z
          .string()
          .min(40)
          .max(8_000_000)
          .regex(/^data:image\/(png|jpe?g|webp|gif);base64,/)
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const session = await requireVerified(data.sessionId);
      const supabase = getUserSupabase();
      const { data: existing, error: fetchError } = await supabase
        .from("admin_requests")
        .select("id,telegram_username,subject,message,status,photo_url")
        .eq("id", data.id)
        .ilike("telegram_username", session.telegram_username)
        .maybeSingle();

      if (fetchError) return { ok: false as const, error: fetchError.message };
      if (!existing) return { ok: false as const, error: "Query not found." };

      let followupPhotoUrl: string | null = existing.photo_url ?? null;
      if (data.imageBase64) {
        followupPhotoUrl = await uploadQueryPhoto(
          data.imageBase64,
          `${session.telegram_username}/reopened`,
        );
      }

      const mergedMessage = [
        String(existing.message ?? ""),
        "— User follow-up / reopen —",
        data.message,
      ].filter(Boolean).join("\n\n");

      const { error } = await supabase
        .from("admin_requests")
        .update({
          message: mergedMessage,
          photo_url: followupPhotoUrl,
          status: "pending",
          admin_reply: null,
          reply_photo_url: null,
          replied_at: null,
          replied_by: null,
          ai_summary: null,
          source: "user_reopened",
        })
        .eq("id", data.id);

      if (error) return { ok: false as const, error: error.message };
      return {
        ok: true as const,
        photoUrl: followupPhotoUrl,
        aiSummary: null,
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "error" };
    }
  });

// ---------- User-raised ticket (AI summarizes, forwards to BOTH admins) ----------

async function summarizeTicketWithAI(
  subject: string,
  details: string,
): Promise<string | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are GTech Support's triage assistant. Read the user's ticket and write a tight 3-5 line briefing for an admin: (1) what the user wants, (2) likely root cause, (3) recommended admin action. Use plain text, no greetings, no fluff.",
          },
          {
            role: "user",
            content: `Subject: ${subject || "(none)"}\n\nUser details:\n${details}`,
          },
        ],
        max_tokens: 350,
      }),
    });
    if (!resp.ok) return null;
    const j = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return j.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

async function summarizeReopenedQueryWithAI(
  subject: string,
  originalMessage: string,
  followup: string,
): Promise<string | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "You are GTech Support's reopen-summary assistant. Summarize the user's latest follow-up for admins in 3 short bullet-style lines: current problem, what changed since the last answer, and exact admin action needed. Plain text only.",
          },
          {
            role: "user",
            content:
              `Subject: ${subject || "(none)"}\n\nOriginal query:\n${originalMessage}\n\nUser follow-up / reopen message:\n${followup}`,
          },
        ],
        max_tokens: 220,
      }),
    });
    if (!resp.ok) return null;
    const j = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return j.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

// ---------- Photo AI helpers ----------

const PHOTO_DAILY_LIMIT = 200;
const TICKET_DAILY_LIMIT_PER_USER = 4;

async function getTodayPhotoCount(): Promise<number> {
  const supabase = getUserSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("photo_usage")
    .select("count")
    .eq("day", today)
    .maybeSingle();
  return (data?.count as number | undefined) ?? 0;
}

async function bumpPhotoCount(): Promise<void> {
  const supabase = getUserSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const current = await getTodayPhotoCount();
  await supabase
    .from("photo_usage")
    .upsert(
      { day: today, count: current + 1, updated_at: new Date().toISOString() },
      { onConflict: "day" },
    );
}

async function uploadQueryPhoto(base64DataUrl: string, pathPrefix: string): Promise<string | null> {
  const supabase = getUserSupabase();
  const match = base64DataUrl.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/);
  if (!match) return null;
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const raw = match[2];
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  const filename = `${pathPrefix}/${Date.now()}.${ext}`;
  const up = await supabase.storage
    .from("query-photos")
    .upload(filename, bytes, {
      contentType: `image/${ext === "jpg" ? "jpeg" : ext}`,
      upsert: false,
    });
  if (up.error) return null;
  const { data: pub } = supabase.storage.from("query-photos").getPublicUrl(filename);
  return pub.publicUrl;
}

async function analyzeImageWithAI(
  base64DataUrl: string,
  caption: string,
): Promise<string | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are GTech Support's vision assistant. Briefly describe what the user's screenshot/photo shows in 3-5 short lines: identify the issue (transaction, error, UI screen, wallet, app state). Be specific. End with a one-line suggested next step. No fluff.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `User caption: ${caption || "(none)"}` },
              { type: "image_url", image_url: { url: base64DataUrl } },
            ],
          },
        ],
        max_tokens: 400,
      }),
    });
    if (!resp.ok) return null;
    const j = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return j.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

// AI validity check: real support issue vs time-pass / spam / test.
// Returns { valid:boolean, reason:string }
async function validateTicketWithAI(
  subject: string,
  details: string,
  hasPhoto: boolean,
  photoAnalysis: string | null,
): Promise<{ valid: boolean; reason: string }> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return { valid: true, reason: "ai-skip" }; // fail-open if no key
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a strict ticket triage gate for GTech crypto support. Decide if a user ticket is a GENUINE support request related to their account, deposits, withdrawals, mining, presale, transactions, KYC, login, app errors, or similar. REJECT messages that are: random test strings, gibberish, jokes, greetings only, abuse, off-topic chit-chat, or obvious time-pass. If a photo is attached, the photo analysis must also relate to a real issue. Respond ONLY as compact JSON: {\"valid\":true|false,\"reason\":\"...\"} — reason is a short user-friendly sentence (<=140 chars).",
          },
          {
            role: "user",
            content: `Subject: ${subject || "(none)"}\n\nDetails: ${details}\n\nPhoto attached: ${hasPhoto ? "yes" : "no"}${photoAnalysis ? `\nPhoto AI analysis: ${photoAnalysis}` : ""}`,
          },
        ],
        max_tokens: 120,
      }),
    });
    if (!resp.ok) return { valid: true, reason: "ai-skip" };
    const j = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const txt = j.choices?.[0]?.message?.content ?? "";
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return { valid: true, reason: "ai-skip" };
    const parsed = JSON.parse(m[0]) as { valid?: boolean; reason?: string };
    return {
      valid: parsed.valid !== false,
      reason: (parsed.reason ?? "").toString().slice(0, 200) || "",
    };
  } catch {
    return { valid: true, reason: "ai-skip" };
  }
}

// Analysis-only: AI reads the user's photo and replies in chat.
// Does NOT create an admin_request anymore — users must explicitly raise a ticket.
export const analyzeAndForwardPhoto = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        imageBase64: z
          .string()
          .min(40)
          .max(8_000_000)
          .regex(/^data:image\/(png|jpe?g|webp|gif);base64,/),
        caption: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      await requireVerified(data.sessionId);

      const todayCount = await getTodayPhotoCount();
      let aiAnalysis: string | null = null;
      if (todayCount < PHOTO_DAILY_LIMIT) {
        aiAnalysis = await analyzeImageWithAI(data.imageBase64, data.caption ?? "");
        if (aiAnalysis) await bumpPhotoCount();
      }

      const userReply = aiAnalysis
        ? `📷 I can see your photo. Here's what I understood:\n\n${aiAnalysis}\n\nIf you need a human admin to act on this, tap the 🎫 ticket button and attach the same photo — I'll forward it then.`
        : `📷 I received your photo but couldn't analyse it right now. If you need admin help, please open a ticket and attach the photo.`;

      return { ok: true as const, reply: userReply };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "error" };
    }
  });

// Count tickets a user has raised today
async function getUserTicketCountToday(username: string): Promise<number> {
  const supabase = getUserSupabase();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("admin_requests")
    .select("id", { count: "exact", head: true })
    .ilike("telegram_username", username)
    .eq("source", "user_ticket")
    .gte("created_at", start.toISOString());
  return count ?? 0;
}

export const raiseTicket = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        subject: z.string().min(2).max(200),
        details: z.string().min(5).max(4000),
        imageBase64: z
          .string()
          .min(40)
          .max(8_000_000)
          .regex(/^data:image\/(png|jpe?g|webp|gif);base64,/)
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const session = await requireVerified(data.sessionId);
      const supabase = getUserSupabase();

      // 1) Per-user daily limit
      const used = await getUserTicketCountToday(session.telegram_username);
      if (used >= TICKET_DAILY_LIMIT_PER_USER) {
        return {
          ok: false as const,
          error: `Daily limit reached. You can raise ${TICKET_DAILY_LIMIT_PER_USER} queries per day. Please try again tomorrow.`,
        };
      }

      // 2) If photo attached: upload only — no AI vision/summary for tickets.
      //    The raw user query and photo are forwarded as-is to admins.
      let photoUrl: string | null = null;
      if (data.imageBase64) {
        photoUrl = await uploadQueryPhoto(data.imageBase64, session.telegram_username);
      }

      // 3) Insert ticket with the raw user-typed message — no AI summary,
      //    no vision summary. Admins see exactly what the user typed.
      const { data: inserted, error } = await supabase
        .from("admin_requests")
        .insert({
          telegram_username: session.telegram_username,
          telegram_user_id: session.telegram_user_id,
          subject: data.subject,
          message: data.details,
          photo_url: photoUrl,
          ai_analysis: null,
          ai_summary: null,
          assigned_admin: null,
          source: "user_ticket",
          status: "pending",
        })
        .select("id")
        .single();
      if (error) return { ok: false as const, error: error.message };

      const fullId = inserted.id as string;
      const shortId = `GT-${fullId.slice(0, 8).toUpperCase()}`;
      return { ok: true as const, queryId: fullId, shortId };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "error" };
    }
  });

// ---------- Admin panel functions ----------

const adminSessionSchema = z.object({ sessionId: z.string().uuid() });

async function requireAdmin(sessionId: string) {
  const session = await requireVerified(sessionId);
  if (!isAdmin(session.telegram_username)) {
    throw new Error("Forbidden: admin only");
  }
  return session;
}

export const adminListRequests = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => adminSessionSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      await requireAdmin(data.sessionId);
      const supabase = getUserSupabase();
      const { data: rows, error } = await supabase
        .from("admin_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return { ok: false as const, error: error.message };
      return { ok: true as const, rows: rows ?? [] };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "error",
      };
    }
  });

export const adminUpdateRequest = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        id: z.string().uuid(),
        status: z.enum(["pending", "answered"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      await requireAdmin(data.sessionId);
      const supabase = getUserSupabase();
      const { error } = await supabase
        .from("admin_requests")
        .update({ status: data.status })
        .eq("id", data.id);
      if (error) return { ok: false as const, error: error.message };
      return { ok: true as const };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "error",
      };
    }
  });

export const adminLookupUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        username: z.string().min(1).max(64),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      await requireAdmin(data.sessionId);
      const supabase = getUserSupabase();
      const u = userDb.users;
      const d_ = userDb.deposits;
      const w = userDb.withdrawals;
      const username = normalizeUsername(data.username);
      const userRes = await supabase
        .from(u.table)
        .select("*")
        .eq(u.username, username)
        .maybeSingle();
      const tgId = (userRes.data as Record<string, unknown> | null)?.[
        u.telegramId
      ] as number | null;
      const [depRes, wdRes, msgRes] = await Promise.all([
        tgId
          ? supabase
              .from(d_.table)
              .select("*")
              .eq(d_.telegramId, tgId)
              .order(d_.createdAt, { ascending: false })
              .limit(50)
          : Promise.resolve({ data: [] as unknown[], error: null }),
        tgId
          ? supabase
              .from(w.table)
              .select("*")
              .eq(w.telegramId, tgId)
              .order(w.createdAt, { ascending: false })
              .limit(50)
          : Promise.resolve({ data: [] as unknown[], error: null }),
        supabase
          .from("chat_sessions")
          .select(
            "id,created_at,verified, chat_messages(role,content,created_at)",
          )
          .eq("telegram_username", username)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
      return {
        ok: true as const,
        username,
        user: userRes.data ?? null,
        deposits: depRes.data ?? [],
        withdrawals: wdRes.data ?? [],
        sessions: msgRes.data ?? [],
      };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "error",
      };
    }
  });

// ---------- API key management ----------
// Gemini key is the AI key for the chat bot — restricted to @Yashu_Gtech (trainer).
// Telegram token can be updated by any admin.
export const adminUpdateApiKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        key: z.string().min(1).max(500),
        type: z.enum(["gemini", "telegram"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const session = await requireAdmin(data.sessionId);
      if (data.type === "gemini" && !isTrainer(session.telegram_username)) {
        return {
          ok: false as const,
          error: "Forbidden — only @Yashu_Gtech can update the Gemini API key.",
        };
      }
      const supabase = getUserSupabase();
      const { error } = await supabase.from("bot_config").upsert({
        key: data.type === "gemini" ? "gemini_api_key" : "telegram_bot_token",
        value: data.key,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
      if (error) return { ok: false as const, error: error.message };
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "error" };
    }
  });

// ---------- Admin reply to a query (with optional image attachment) ----------
export const adminReplyRequest = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        id: z.string().uuid(),
        reply: z.string().min(1).max(4000),
        imageBase64: z
          .string()
          .min(40)
          .max(8_000_000)
          .regex(/^data:image\/(png|jpe?g|webp|gif);base64,/)
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const session = await requireAdmin(data.sessionId);
      const supabase = getUserSupabase();

      // Optional admin attachment → upload to the same bucket users see.
      const replyPhotoUrl = data.imageBase64
        ? await uploadQueryPhoto(data.imageBase64, `admin-replies/${session.telegram_username}`)
        : null;

      const { error } = await supabase
        .from("admin_requests")
        .update({
          admin_reply: data.reply,
          reply_photo_url: replyPhotoUrl,
          replied_at: new Date().toISOString(),
          replied_by: session.telegram_username,
          status: "answered",
        })
        .eq("id", data.id);
      if (error) return { ok: false as const, error: error.message };
      return { ok: true as const, replyPhotoUrl };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "error" };
    }
  });

// ---------- Admin: find a query by ID (full UUID or short GT-XXXXXXXX) ----------
export const adminFindRequest = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid(), query: z.string().min(2).max(64) }).parse(d),
  )
  .handler(async ({ data }) => {
    try {
      await requireAdmin(data.sessionId);
      const supabase = getUserSupabase();
      const q = data.query.trim();
      const cleaned = q.replace(/^GT-/i, "").toLowerCase();

      // Full UUID
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)) {
        const { data: row } = await supabase
          .from("admin_requests")
          .select("*")
          .eq("id", q)
          .maybeSingle();
        return { ok: true as const, rows: row ? [row] : [] };
      }
      // Short id (first 8 hex chars of uuid) — fetch recent and filter in-memory
      const { data: rows } = await supabase
        .from("admin_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      const filtered = (rows ?? []).filter((r: { id: string }) =>
        (r.id as string).toLowerCase().startsWith(cleaned),
      );
      return { ok: true as const, rows: filtered };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "error", rows: [] };
    }
  });
