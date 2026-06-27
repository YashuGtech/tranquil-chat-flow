// Developer panel server functions: add/list/disable/delete AI keys + view stats.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getUserSupabase } from "@/lib/user-supabase.server";
import { isTrainer, isAdmin } from "@/config/user-db";
import { listKeysWithStats } from "@/lib/ai-keys.server";
import { buildAiCandidatePool } from "@/lib/ai-pool";


async function getSession(sessionId: string) {
  const sb = getUserSupabase();
  const { data } = await sb
    .from("chat_sessions")
    .select("telegram_username,telegram_user_id,verified")
    .eq("id", sessionId)
    .single();
  return data as
    | { telegram_username: string; telegram_user_id: number | null; verified: boolean }
    | null;
}

async function requireDeveloper(sessionId: string) {
  const s = await getSession(sessionId);
  if (!s?.verified || !isTrainer(s.telegram_username)) {
    return null;
  }
  return s;
}

/** Developer: list keys (with full key string). Stats included. */
export const devListKeys = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await requireDeveloper(data.sessionId);
    if (!s) return { ok: false as const, error: "Developer only", rows: [] };
    const stats = await listKeysWithStats();
    return { ok: true as const, rows: stats };
  });

/** Admin (read-only): same stats but key value is hidden. */
export const adminListKeyStats = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await getSession(data.sessionId);
    if (!s?.verified || !isAdmin(s.telegram_username)) {
      return { ok: false as const, error: "Admin only", rows: [] };
    }
    const stats = await listKeysWithStats();
    return { ok: true as const, rows: stats };
  });

/** Admin: toggle a key on/off (no key value exposure). */
export const adminToggleKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      sessionId: z.string().uuid(),
      id: z.string().uuid(),
      active: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const s = await getSession(data.sessionId);
    if (!s?.verified || !isAdmin(s.telegram_username)) {
      return { ok: false as const, error: "Admin only" };
    }
    const sb = getUserSupabase();
    const { error } = await sb
      .from("ai_api_keys")
      .update({ active: data.active })
      .eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const devAddKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        provider: z.enum(["gemini", "nvidia"]),
        label: z.string().min(1).max(80),
        api_key: z.string().min(8).max(400),
        model: z.string().max(120).optional(),
        rpm_limit: z.number().int().positive().max(10000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const s = await requireDeveloper(data.sessionId);
    if (!s) return { ok: false as const, error: "Developer only" };
    const sb = getUserSupabase();
    const { error } = await sb.from("ai_api_keys").insert({
      provider: data.provider,
      label: data.label.trim(),
      api_key: data.api_key.trim(),
      model: data.model?.trim() || null,
      rpm_limit: data.rpm_limit ?? (data.provider === "gemini" ? 15 : 1000),
      active: true,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const devToggleKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      sessionId: z.string().uuid(),
      id: z.string().uuid(),
      active: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const s = await requireDeveloper(data.sessionId);
    if (!s) return { ok: false as const, error: "Developer only" };
    const sb = getUserSupabase();
    await sb.from("ai_api_keys").update({ active: data.active }).eq("id", data.id);
    return { ok: true as const };
  });

export const devDeleteKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid(), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const s = await requireDeveloper(data.sessionId);
    if (!s) return { ok: false as const, error: "Developer only" };
    const sb = getUserSupabase();
    await sb.from("ai_api_keys").delete().eq("id", data.id);
    return { ok: true as const };
  });

/**
 * Developer: send a one-shot test prompt to a specific API key (DB or env)
 * and return the raw upstream response. Used to verify a key works and to
 * debug why a particular model (e.g. Gemma) isn't responding.
 */
export const devTestKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        // DB key uuid OR an env-pool id like "env:Gemma #1"
        keyId: z.string().min(1).max(200),
        prompt: z.string().min(1).max(2000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const s = await requireDeveloper(data.sessionId);
    if (!s) return { ok: false as const, error: "Developer only" };

    let apiKey = "";
    let endpoint = "";
    let model = "";
    let label = "";
    let supportsTools = true;

    if (data.keyId.startsWith("env:")) {
      const wanted = data.keyId.slice(4);
      const cand = buildAiCandidatePool().find((c) => c.label === wanted);
      if (!cand) return { ok: false as const, error: "Env key not found" };
      apiKey = cand.apiKey;
      endpoint = cand.endpoint;
      model = cand.model;
      label = cand.label;
      supportsTools = cand.supportsTools;
    } else {
      const sb = getUserSupabase();
      const { data: row } = await sb
        .from("ai_api_keys")
        .select("*")
        .eq("id", data.keyId)
        .single();
      if (!row) return { ok: false as const, error: "Key not found" };
      apiKey = row.api_key;
      endpoint =
        row.provider === "gemini"
          ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
          : "https://integrate.api.nvidia.com/v1/chat/completions";
      model =
        row.model ||
        (row.provider === "gemini" ? "gemma-3-27b-it" : "nvidia/nemotron-nano-3-8b-v1");
      label = row.label;
      supportsTools = !/^gemma/i.test(model);
    }

    const started = Date.now();
    let status = 0;
    let bodyText = "";
    let reply = "";
    let networkError: string | null = null;
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: data.prompt }],
          stream: false,
          max_tokens: 1024,
          temperature: 0.7,
        }),
      });
      status = resp.status;
      bodyText = await resp.text();
      try {
        const j = JSON.parse(bodyText);
        reply = j?.choices?.[0]?.message?.content ?? "";
      } catch {}
    } catch (e) {
      networkError = e instanceof Error ? e.message : String(e);
    }
    const ms = Date.now() - started;

    return {
      ok: true as const,
      label,
      endpoint,
      model,
      supportsTools,
      status,
      ms,
      reply,
      bodyPreview: bodyText.slice(0, 4000),
      networkError,
    };
  });

