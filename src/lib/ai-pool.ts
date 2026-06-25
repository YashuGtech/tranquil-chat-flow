// Env-driven multi-key AI candidate pool.
//
// Reads VITE_* env vars (public, anyone can edit in .env) and produces an
// ordered list of AI candidates the /api/chat route walks until one succeeds:
//
//   1. VITE_GEMMA_KEYS    → Google Gemma (OpenAI-compatible Gemini endpoint)
//   2. VITE_NVIDIA_KEYS   → Nvidia NIM Nemotron
//   3. LOVABLE_API_KEY    → Lovable AI Gateway (managed Gemini) — final net
//
// On Workers, import.meta.env.VITE_* is statically inlined at build time so
// these values are always available server-side too. process.env.* is read
// at request time for any runtime-injected secrets (LOVABLE_API_KEY).

export type AiProviderKind = "gemma" | "nvidia" | "lovable";

export interface AiCandidate {
  kind: AiProviderKind;
  label: string;
  apiKey: string;
  endpoint: string;
  model: string;
  /** Gemma OpenAI-compat endpoint rejects `tools` — chat must omit them. */
  supportsTools: boolean;
}

const GEMMA_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const LOVABLE_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";

function splitKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function readEnv(name: string): string | undefined {
  // import.meta.env wins (build-time inline for VITE_*), but fall back to
  // process.env so server-only secrets and runtime overrides still resolve.
  const fromMeta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const v = fromMeta?.[name];
  if (v) return v;
  if (typeof process !== "undefined" && process.env) return process.env[name];
  return undefined;
}

export function buildAiCandidatePool(): AiCandidate[] {
  const out: AiCandidate[] = [];

  const gemmaModel = readEnv("VITE_GEMMA_MODEL") || "gemma-3-27b-it";
  const gemmaKeys = splitKeys(readEnv("VITE_GEMMA_KEYS"));
  gemmaKeys.forEach((k, i) =>
    out.push({
      kind: "gemma",
      label: `Gemma #${i + 1}`,
      apiKey: k,
      endpoint: GEMMA_ENDPOINT,
      model: gemmaModel,
      supportsTools: false,
    }),
  );

  const nvidiaModel =
    readEnv("VITE_NVIDIA_MODEL") || "nvidia/nemotron-nano-3-8b-v1";
  const nvidiaKeys = splitKeys(readEnv("VITE_NVIDIA_KEYS"));
  nvidiaKeys.forEach((k, i) =>
    out.push({
      kind: "nvidia",
      label: `Nvidia #${i + 1}`,
      apiKey: k,
      endpoint: NVIDIA_ENDPOINT,
      model: nvidiaModel,
      supportsTools: true,
    }),
  );

  const lovableKey = readEnv("LOVABLE_API_KEY");
  const lovableModel =
    readEnv("VITE_LOVABLE_MODEL") || "google/gemini-2.5-flash";
  if (lovableKey) {
    out.push({
      kind: "lovable",
      label: "Lovable AI Gateway",
      apiKey: lovableKey,
      endpoint: LOVABLE_ENDPOINT,
      model: lovableModel,
      supportsTools: true,
    });
  }

  // Legacy single-key Gemini fallback (kept for backward compat with the
  // original .env file). Only added if not already represented in Gemma.
  const legacyGeminiKey = readEnv("GEMINI_API_KEY");
  if (legacyGeminiKey && !gemmaKeys.includes(legacyGeminiKey)) {
    out.push({
      kind: "gemma",
      label: "Gemini (legacy)",
      apiKey: legacyGeminiKey,
      endpoint: GEMMA_ENDPOINT,
      model: readEnv("GEMINI_MODEL") || "gemini-2.5-flash",
      supportsTools: false,
    });
  }

  return out;
}
