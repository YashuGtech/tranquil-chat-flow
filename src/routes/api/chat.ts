import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { GTECH_KNOWLEDGE } from "@/lib/gtech-knowledge";
import { getUserSupabase } from "@/lib/user-supabase.server";
import { userDb, ADMIN_USERNAMES } from "@/config/user-db";
import { consumeQuota, getQuota, LIMIT_REACHED_MESSAGE } from "@/lib/quota.server";
import { pickAvailableKey, recordUsage, recordEnvUsage } from "@/lib/ai-keys.server";
import { buildAiCandidatePool } from "@/lib/ai-pool";



const bodySchema = z.object({
  sessionId: z.string().uuid(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(40),
});

const USER_CHAR_LIMIT = 4000;

const BALANCE_QUERY_RE = /\b(balance|gaming account balance|my account balance|show my balance|account balance)\b/i;
const PRICE_QUERY_RE = /\b(price|rate|value|market cap|chart|quote)\b/i;
const FOREX_PAIR_RE = /\b(EUR|USD|GBP|JPY|AUD|CAD|CHF|NZD|CNY|INR|SGD|HKD|SEK|NOK|MXN|ZAR|TRY|BRL|RUB|KRW)\s*[\/\-]?\s*(EUR|USD|GBP|JPY|AUD|CAD|CHF|NZD|CNY|INR|SGD|HKD|SEK|NOK|MXN|ZAR|TRY|BRL|RUB|KRW)\b/i;

const tools = [
  {
    type: "function",
    function: {
      name: "get_user_data",
      description:
        "Get the verified Telegram user's balance, recent deposits and withdrawals.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "verify_txn",
      description: "Verify a transaction hash against the user's deposits and withdrawals.",
      parameters: {
        type: "object",
        properties: { hash: { type: "string", description: "On-chain TXN hash" } },
        required: ["hash"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_crypto_price",
      description:
        "Live web lookup for the current USD price + 24h change of any cryptocurrency. ALWAYS use this when the user asks about the price, rate, value, or chart of bitcoin, ethereum, BNB, solana, GTC, or any coin. Do not answer prices from memory.",
      parameters: {
        type: "object",
        properties: {
          coin: {
            type: "string",
            description:
              "Coin id or common name (e.g. 'bitcoin', 'btc', 'ethereum', 'eth', 'gtc network', 'solana').",
          },
        },
        required: ["coin"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the live web for current information (news, events, prices not covered by get_crypto_price, recent updates). Use whenever the user asks about anything that might be newer than your training data.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_admin_request",
      description: "Forward a message from the user to an admin.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string" },
          message: { type: "string" },
          assigned_admin: { type: "string", enum: [...ADMIN_USERNAMES] },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
  },
];

async function getSession(sessionId: string) {
  const sb = getUserSupabase();
  const { data } = await sb
    .from("chat_sessions")
    .select("telegram_username,telegram_user_id,verified")
    .eq("id", sessionId)
    .single();
  return data;
}

// --- Coin id resolution for CoinGecko (free, no key) ---
const COIN_ALIASES: Record<string, string> = {
  btc: "bitcoin", bitcoin: "bitcoin",
  eth: "ethereum", ethereum: "ethereum", ether: "ethereum",
  sol: "solana", solana: "solana",
  bnb: "binancecoin", binance: "binancecoin",
  ada: "cardano", cardano: "cardano",
  xrp: "ripple", ripple: "ripple",
  doge: "dogecoin", dogecoin: "dogecoin",
  ton: "the-open-network",
  matic: "matic-network", polygon: "matic-network",
  trx: "tron", tron: "tron",
  usdt: "tether", tether: "tether",
  usdc: "usd-coin",
  gtc: "gitcoin", gitcoin: "gitcoin",
};

// Map a CoinGecko id / common name to a TradingView symbol (Binance USDT pair).
const TV_SYMBOL_FOR_COIN: Record<string, string> = {
  bitcoin: "BINANCE:BTCUSDT",
  ethereum: "BINANCE:ETHUSDT",
  solana: "BINANCE:SOLUSDT",
  binancecoin: "BINANCE:BNBUSDT",
  cardano: "BINANCE:ADAUSDT",
  ripple: "BINANCE:XRPUSDT",
  dogecoin: "BINANCE:DOGEUSDT",
  "the-open-network": "BINANCE:TONUSDT",
  "matic-network": "BINANCE:MATICUSDT",
  tron: "BINANCE:TRXUSDT",
  tether: "BINANCE:USDTUSD",
  "usd-coin": "BINANCE:USDCUSDT",
  gitcoin: "BINANCE:GTCUSDT",
};
function tvSymbolForCoinId(id: string): string | null {
  return TV_SYMBOL_FOR_COIN[id] ?? null;
}
function tvSymbolForForex(pair: string): string {
  const clean = pair.replace(/[^A-Za-z]/g, "").toUpperCase();
  return `FX:${clean}`;
}
function resolveCoinId(input: string): string {
  const k = input.trim().toLowerCase().replace(/\s+/g, "-");
  return COIN_ALIASES[k] ?? COIN_ALIASES[k.replace(/-/g, "")] ?? k;
}

function detectCoinFromText(input: string): string | null {
  const normalized = input.toLowerCase();
  const aliases = Object.keys(COIN_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "[-\\s]?");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(normalized)) {
      return alias;
    }
  }
  return null;
}

function normalizeModelName(model: string | undefined, useLovable: boolean): string {
  const raw = (model || "").trim();
  if (!raw) {
    return useLovable ? "google/gemini-3-flash-preview" : "gemini-2.5-flash";
  }
  if (useLovable) {
    if (raw.includes("/")) return raw;
    if (raw.startsWith("gemini-")) return "google/gemini-3-flash-preview";
    return raw;
  }
  return raw.replace(/^google\//, "");
}

function formatFastPathPrice(payload: Record<string, unknown>): string | null {
  if (typeof payload.price_usd !== "number") return null;
  const coinId = String(payload.coin ?? "");
  const tv = tvSymbolForCoinId(coinId);
  // Per product spec: do NOT show numeric price text in chat — just render
  // the live TradingView quote bubble. If no TV symbol mapped, return null
  // and let the AI handle it.
  if (!tv) return null;
  return `Live **${coinId.replace(/-/g, " ")}** quote:\n[[TV:${tv}]]`;
}

function formatFastPathBalance(payload: Record<string, unknown>): string | null {
  if (!("balance" in payload)) return null;
  const balance = payload.balance;
  const deposits = Array.isArray(payload.deposits) ? payload.deposits.length : 0;
  const withdrawals = Array.isArray(payload.withdrawals) ? payload.withdrawals.length : 0;
  return [
    `Your current gaming account balance is **${balance ?? "unavailable"}**.`,
    `Recent activity: **${deposits} deposits** · **${withdrawals} withdrawals**`,
    "If you want, I can also help verify a TXN hash or explain the latest account activity.",
  ].join("\n");
}

async function maybeHandleFastPath(message: string | undefined, sessionId: string): Promise<string | null> {
  const text = (message ?? "").trim();
  if (!text) return null;

  if (BALANCE_QUERY_RE.test(text)) {
    try {
      const raw = await execTool("get_user_data", {}, sessionId);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.error) return null;
      return formatFastPathBalance(parsed);
    } catch {
      return null;
    }
  }

  // Forex pair lookup → render TradingView live quote widget.
  const forex = text.match(FOREX_PAIR_RE);
  if (forex && PRICE_QUERY_RE.test(text)) {
    const base = forex[1].toUpperCase();
    const quote = forex[2].toUpperCase();
    if (base !== quote) {
      const sym = tvSymbolForForex(`${base}${quote}`);
      return [
        `Live **${base}/${quote}** quote (TradingView):`,
        `[[TV:${sym}]]`,
      ].join("\n");
    }
  }

  if (PRICE_QUERY_RE.test(text) || /\b(live|tradeview|tradingview|popup|chart|quote)\b/i.test(text)) {
    const coin = detectCoinFromText(text);
    if (!coin) return null;
    // Resolve to a TradingView symbol — skip CoinGecko entirely so the
    // bubble shows even if the price-API request fails or is rate-limited.
    const resolved = resolveCoinId(coin);
    const tv = tvSymbolForCoinId(resolved);
    const label = resolved.replace(/-/g, " ");
    if (tv) {
      return `Here is the current live price of **${label}**:\n[[TV:${tv}]]\n\nPrices update every second. Tap the bubble to open the full chart in TradingView.`;
    }
    const ticker = resolved.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (ticker) {
      return `Here is the current live price of **${label}**:\n[[TV:BINANCE:${ticker}USDT]]\n\nPrices update every second. Tap the bubble to open the full chart in TradingView.`;
    }
    return null;
  }

  return null;
}

async function fetchCryptoPrice(coin: string): Promise<string> {
  try {
    const id = resolveCoinId(coin);
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) return JSON.stringify({ error: `lookup failed (${r.status})`, coin });
    const j = (await r.json()) as Record<string, { usd?: number; usd_24h_change?: number; usd_market_cap?: number }>;
    const row = j[id];
    if (!row || typeof row.usd !== "number") {
      return JSON.stringify({ error: "coin not found on CoinGecko", coin, tried: id });
    }
    return JSON.stringify({
      coin: id,
      price_usd: row.usd,
      change_24h_pct: row.usd_24h_change ?? null,
      market_cap_usd: row.usd_market_cap ?? null,
      source: "coingecko.com (live)",
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "fetch failed", coin });
  }
}

async function webSearch(query: string): Promise<string> {
  // Free DuckDuckGo instant-answer + abstract endpoint.
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`;
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) return JSON.stringify({ error: `search failed (${r.status})` });
    const j = (await r.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };
    const topics = (j.RelatedTopics ?? [])
      .filter((t) => t.Text)
      .slice(0, 5)
      .map((t) => ({ text: t.Text, url: t.FirstURL }));
    return JSON.stringify({
      query,
      heading: j.Heading ?? null,
      abstract: j.AbstractText ?? null,
      url: j.AbstractURL ?? null,
      results: topics,
      source: "duckduckgo.com",
    });
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "search failed" });
  }
}

async function execTool(
  name: string,
  args: Record<string, unknown>,
  sessionId: string,
): Promise<string> {
  if (name === "get_crypto_price") {
    return fetchCryptoPrice(String(args.coin ?? ""));
  }
  if (name === "web_search") {
    return webSearch(String(args.query ?? ""));
  }

  const session = await getSession(sessionId);
  if (!session) return JSON.stringify({ error: "Session not found" });
  if (!session.verified) {
    return JSON.stringify({ error: "Telegram login required." });
  }
  const sb = getUserSupabase();
  const username = session.telegram_username as string;
  const tgId = session.telegram_user_id as number | null;

  if (name === "get_user_data") {
    const u = userDb.users, d = userDb.deposits, w = userDb.withdrawals;
    const loadUser = async () => {
      if (tgId) {
        const byId = await sb.from(u.table).select("*").eq(u.telegramId, tgId).maybeSingle();
        if (byId.data || byId.error) return byId;
      }
      return sb.from(u.table).select("*").ilike(u.username, username).maybeSingle();
    };
    const [user, dep, wd] = await Promise.all([
      loadUser(),
      tgId ? sb.from(d.table).select("*").eq(d.telegramId, tgId).order(d.createdAt, { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
      tgId ? sb.from(w.table).select("*").eq(w.telegramId, tgId).order(w.createdAt, { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
    ]);
    return JSON.stringify({
      username,
      balance: (user.data as Record<string, unknown> | null)?.[u.balance] ?? null,
      user: user.data,
      deposits: dep.data ?? [],
      withdrawals: wd.data ?? [],
    });
  }

  if (name === "verify_txn") {
    const hash = String(args.hash ?? "");
    if (!hash) return JSON.stringify({ error: "missing hash" });
    const d = userDb.deposits, w = userDb.withdrawals;
    const [dep, wd] = await Promise.all([
      tgId ? sb.from(d.table).select("*").eq(d.txnHash, hash).eq(d.telegramId, tgId).maybeSingle() : Promise.resolve({ data: null }),
      tgId ? sb.from(w.table).select("*").eq(w.txnHash, hash).eq(w.telegramId, tgId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const rec = dep.data ?? wd.data;
    if (!rec) return JSON.stringify({ found: false, hash });
    return JSON.stringify({ found: true, type: dep.data ? "deposit" : "withdrawal", record: rec });
  }

  if (name === "create_admin_request") {
    const { error } = await sb.from("admin_requests").insert({
      telegram_username: username,
      telegram_user_id: session.telegram_user_id,
      subject: (args.subject as string) ?? null,
      message: String(args.message ?? ""),
      assigned_admin: (args.assigned_admin as string) ?? null,
      status: "pending",
    });
    if (error) return JSON.stringify({ ok: false, error: error.message });
    return JSON.stringify({
      ok: true,
      note: "Your query has been forwarded to the GTech AI support team. Status: pending. You can track it in My Queries.",
    });
  }

  return JSON.stringify({ error: `unknown tool ${name}` });
}

async function loadTrainingKnowledge(): Promise<string> {
  try {
    const sb = getUserSupabase();
    const { data } = await sb
      .from("training_docs")
      .select("title,content,tags")
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (!data || data.length === 0) return "";
    const blocks = data.map(
      (d: { title: string; content: string; tags?: string[] | null }) =>
        `### ${d.title}${d.tags?.length ? ` (${d.tags.join(", ")})` : ""}\n${d.content}`,
    );
    return `\n\n## Trainer-Curated Knowledge (live)\n${blocks.join("\n\n")}`;
  } catch {
    return "";
  }
}

function buildSystemPrompt(verified: boolean, username: string | null, training: string) {
  return [
    GTECH_KNOWLEDGE,
    training,
    "",
    `Current user: ${username ? "@" + username : "(unknown)"}.`,
    `Verified Telegram login: ${verified ? "YES" : "NO"}.`,
    "You are **GTech AI** — a sharp, friendly crypto + forex expert for GTech Network (GTC).",
    verified
      ? "You MUST call get_user_data when the user asks about balance, gaming account balance, deposits, withdrawals, account history, or profile/account data. You MUST call verify_txn for TXN hashes. Use create_admin_request when the user wants admin help."
      : "User is NOT verified. If they ask about balance, deposits, withdrawals, TXN verification, or want to contact admin — politely tell them to verify via OTP to unlock those actions.",
    "REAL-TIME DATA RULES (IMPORTANT):",
    "• If the user asks about ANY crypto price, rate, value, market cap or 24h change → ALWAYS call `get_crypto_price` first. Never answer prices from memory.",
    "• For news, events, or anything that may have changed recently → call `web_search` first.",
    "• Cite the source briefly (e.g. 'via CoinGecko').",
    "Format: short paragraphs, bullet lists, **bold** key numbers. Mobile-first. Max ~500 words.",
    "FORMATTING RULES (STRICT): Never use Markdown headings — do NOT output the '#' character at the start of a line or anywhere as a heading marker (no '#', '##', '###', etc.). Use **bold** for emphasis instead. Avoid '#' entirely in replies (even for hashtags).",
    "WORDING: when reporting the user's GTC/account balance, ALWAYS phrase it as 'Your current gaming account balance is __________' (fill in the value). Never say 'wallet balance' — call it the **gaming account balance**.",
    "SCOPE: you only have access to the user's GTech gaming account (balance, deposits, withdrawals, TXN hashes). You do NOT have access to external wallets, exchanges, or bank accounts — politely say so if asked.",
    "Trust the Trainer-Curated Knowledge section over older facts when they conflict.",
  ].join("\n");
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch {
          return new Response(JSON.stringify({ error: "Invalid body" }), {
            status: 400, headers: { "content-type": "application/json" },
          });
        }

        const lastUserMsg = [...parsed.messages].reverse().find((m) => m.role === "user");
        if (lastUserMsg && lastUserMsg.content.length > USER_CHAR_LIMIT) {
          return new Response(
            JSON.stringify({ error: `Message too long. Please keep messages under ${USER_CHAR_LIMIT} characters.` }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        const session = await getSession(parsed.sessionId);
        const verified = !!session?.verified;
        const username = (session?.telegram_username as string) ?? null;
        const training = await loadTrainingKnowledge();

        // -- Daily message quota -------------------------------------------
        if (verified && username) {
          const pre = await getQuota(username);
          if (pre.totalLeft <= 0) {
            return new Response(
              JSON.stringify({
                error: LIMIT_REACHED_MESSAGE,
                quota: pre,
                limit_reached: true,
              }),
              { status: 429, headers: { "content-type": "application/json" } },
            );
          }
        }

        const fastPathReply = await maybeHandleFastPath(lastUserMsg?.content, parsed.sessionId);
        if (fastPathReply) {
          let quota = null;
          if (verified && username) {
            const c = await consumeQuota(username);
            quota = c.snapshot;
          }
          return new Response(
            JSON.stringify({ reply: fastPathReply, quota }),
            { headers: { "content-type": "application/json" } },
          );
        }

        // -- Build the ordered AI candidate pool ---------------------------
        // Order: DB-managed pool (Developer panel keys) → env Gemma keys
        //   → env Nvidia keys → Lovable AI Gateway.
        // We walk the entire list and only surface an error to the user
        // when EVERY candidate has failed. Any single key's HTTP/network
        // failure simply rotates to the next candidate silently.
        type Attempt = {
          label: string;
          apiKey: string;
          endpoint: string;
          model: string;
          supportsTools: boolean;
          pickedKeyId: string | null;
          envLabel: string | null;
        };

        const attempts: Attempt[] = [];
        const picked = await pickAvailableKey();
        let busyNotice: string | null = null;
        if (picked.picked) {
          const k = picked.picked;
          attempts.push({
            label: `DB pool (${k.key.provider})`,
            apiKey: k.key.api_key,
            endpoint: k.endpoint,
            model: k.model,
            supportsTools: !/^gemma/i.test(k.model),
            pickedKeyId: k.key.id,
            envLabel: null,
          });
          if (picked.waited) {
            busyNotice =
              "(All AI workers were busy — your reply was queued briefly until one was free.)";
          }
        }

        for (const c of buildAiCandidatePool()) {
          attempts.push({
            label: c.label,
            apiKey: c.apiKey,
            endpoint: c.endpoint,
            model: c.model,
            supportsTools: c.supportsTools,
            pickedKeyId: null,
            envLabel: c.label,
          });
        }

        if (attempts.length === 0) {
          return new Response(
            JSON.stringify({
              error:
                "No AI keys are configured. Add at least one VITE_GEMMA_KEYS / VITE_NVIDIA_KEYS entry in .env or a Developer-panel key.",
            }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }

        const baseConversation: Array<Record<string, unknown>> = [
          { role: "system", content: buildSystemPrompt(verified, username, training) },
          ...parsed.messages,
        ];

        const skippedReasons: string[] = [];
        let creditsExhausted = false;

        for (const attempt of attempts) {
          // Fresh conversation copy per attempt so a partial tool-call loop
          // on a failed provider doesn't poison the next provider's context.
          const conversation = baseConversation.map((m) => ({ ...m }));
          let attemptFailed = false;

          for (let round = 0; round < 4 && !attemptFailed; round++) {
            const reqBody: Record<string, unknown> = {
              model: attempt.model,
              messages: conversation,
              stream: false,
              max_tokens: 8192,
              temperature: 0.7,
            };
            if (attempt.supportsTools) reqBody.tools = tools;

            let resp: Response;
            try {
              resp = await fetch(attempt.endpoint, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${attempt.apiKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(reqBody),
              });
            } catch (e) {
              skippedReasons.push(
                `${attempt.label}: network error (${e instanceof Error ? e.message : "unknown"})`,
              );
              attemptFailed = true;
              break;
            }

            if (resp.status === 402) {
              creditsExhausted = true;
              skippedReasons.push(`${attempt.label}: credits exhausted (402)`);
              attemptFailed = true;
              break;
            }
            if (resp.status === 429 || resp.status === 401 || resp.status === 403 || !resp.ok) {
              const t = await resp.text().catch(() => "");
              console.warn(
                `[ai-pool] ${attempt.label} → HTTP ${resp.status}, rotating. ${t.slice(0, 240)}`,
              );
              skippedReasons.push(`${attempt.label}: HTTP ${resp.status}`);
              attemptFailed = true;
              break;
            }

            const json = (await resp.json().catch(() => null)) as {
              choices?: Array<{
                message?: {
                  content?: string;
                  tool_calls?: Array<{
                    id: string;
                    function: { name: string; arguments: string };
                  }>;
                };
              }>;
            } | null;
            const msg = json?.choices?.[0]?.message;
            if (!msg) {
              skippedReasons.push(`${attempt.label}: empty response`);
              attemptFailed = true;
              break;
            }

            if (msg.tool_calls && msg.tool_calls.length > 0) {
              conversation.push({
                role: "assistant",
                content: msg.content ?? "",
                tool_calls: msg.tool_calls,
              });
              for (const call of msg.tool_calls) {
                let args: Record<string, unknown> = {};
                try { args = JSON.parse(call.function.arguments || "{}"); } catch {}
                const out = await execTool(call.function.name, args, parsed.sessionId);
                conversation.push({
                  role: "tool",
                  tool_call_id: call.id,
                  content: out,
                });
              }
              continue;
            }

            // SUCCESS — sanitize, record usage, return reply.
            // Strip reasoning-model chain-of-thought wrappers so the user
            // never sees raw <thought>/<think>/<reasoning> dumps. Nemotron
            // and similar models emit these by default.
            const reply = (msg.content ?? "")
              .replace(/<\s*(thought|think|reasoning|analysis|scratchpad)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
              .replace(/<\s*(thought|think|reasoning|analysis|scratchpad)\s*>/gi, "")
              .replace(/<\s*\/\s*(thought|think|reasoning|analysis|scratchpad)\s*>/gi, "")
              .replace(/```(?:thought|thinking|reasoning)[\s\S]*?```/gi, "")
              .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
              .replace(/#/g, "")
              .trim();
            if (attempt.pickedKeyId) {
              try { await recordUsage(attempt.pickedKeyId); } catch {}
            }
            if (attempt.envLabel) {
              try { await recordEnvUsage(attempt.envLabel); } catch {}
            }
            let quota = null;
            if (verified && username) {
              const c = await consumeQuota(username);
              quota = c.snapshot;
            }
            if (!reply) {
              return new Response(
                JSON.stringify({
                  reply:
                    "Hmm, I couldn't put that into words just now. Please try rephrasing or ask again.",
                  quota,
                }),
                { headers: { "content-type": "application/json" } },
              );
            }
            const finalReply = busyNotice ? `${busyNotice}\n\n${reply}` : reply;
            return new Response(
              JSON.stringify({ reply: finalReply, quota }),
              { headers: { "content-type": "application/json" } },
            );
          }
          // attempt failed → loop to next candidate
        }

        // Every candidate failed. Tell the user — politely.
        console.error("[ai-pool] all candidates failed:", skippedReasons.join(" | "));
        const friendly = creditsExhausted
          ? "All AI providers are momentarily out of credit. Please try again shortly — the next free key will pick up automatically."
          : "All AI providers are busy right now. Please try again in a moment.";
        return new Response(
          JSON.stringify({ reply: friendly, busy: true }),
          { status: 200, headers: { "content-type": "application/json" } },
        );

      },
    },
  },
});
