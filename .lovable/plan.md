## GTech Support Bot — Plan

A premium, mobile-first AI chat trained on the GTC White Paper + gtechnetwork (X) profile, with Telegram-based auth, your own Supabase backend, admin dashboard, and live TXN verification.

### 1. Knowledge ingestion (one-time)
- Parse `GTC_White_Paper (2).pdf` and scrape https://x.com/gtechnetwork (public posts/bio) at build time.
- Store as a static `gtech-knowledge.ts` module (markdown chunks) injected into the AI system prompt. No vector DB needed for v1 — content fits in context.
- System prompt persona: **professional crypto + forex expert**, GTech-focused, concise, premium tone. Allowed to do open-source research via Lovable AI Gemini's built-in web grounding when the user asks live questions.

### 2. Auth — two-tier
- **Guest mode**: user types their `@telegram_username` → can chat freely (general crypto/forex Q&A + GTech info).
- **Verified mode** (required for balance / deposits / withdrawals / contact admin / TXN verify): official **Telegram Login Widget** validates the user cryptographically against `TELEGRAM_BOT_TOKEN`. Verified username + Telegram user ID stored in `chat_sessions`.
- Admin dashboard access is gated to usernames `Gtechnetwork_support` and `ITLGsyoungestAmbassador77` (case-insensitive, from verified Telegram payload only).

### 3. Your Supabase backend
You'll be prompted (via the secrets form) to paste:
- `USER_SUPABASE_URL`
- `USER_SUPABASE_ANON_KEY`
- `USER_SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN` (from @BotFather — needed for Login Widget verification)

A separate Supabase client (`user-supabase.server.ts`) talks to YOUR project from server functions only. Your service role key never reaches the browser.

### 4. SQL you run on your Supabase (provided in chat + as `sql/setup.sql`)
```sql
-- Sessions / chat history / admin requests
create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  telegram_username text not null,
  telegram_user_id bigint,
  verified boolean default false,
  created_at timestamptz default now()
);
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references chat_sessions(id) on delete cascade,
  role text check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz default now()
);
create table if not exists admin_requests (
  id uuid primary key default gen_random_uuid(),
  telegram_username text not null,
  telegram_user_id bigint,
  subject text,
  message text not null,
  status text default 'open',
  assigned_admin text,    -- 'Gtechnetwork_support' | 'ITLGsyoungestAmbassador77'
  created_at timestamptz default now()
);
create index on chat_messages(session_id, created_at);
create index on admin_requests(status, created_at desc);
```
The bot also expects these read-only tables to already exist in your Supabase (we will SELECT only — names configurable in `src/config/user-db.ts`):
- `users(telegram_username, balance, ...)`
- `deposits(telegram_username, amount, txn_hash, status, created_at)`
- `withdrawals(telegram_username, amount, txn_hash, status, created_at)`

If your column/table names differ, tell me and I'll map them.

### 5. TXN hash verification
Server function `verify_txn(hash)`:
1. Looks up the hash in your `deposits`/`withdrawals` tables.
2. If GTC is on a public chain, also queries the relevant explorer API (Etherscan/BscScan-style — needs `EXPLORER_API_KEY` if you want on-chain confirm).
3. Returns confirmed/pending/not-found to the chat.

### 6. AI chat (Lovable AI Gateway, Gemini, streaming)
- TanStack server route `/api/chat` streams responses (no client-side keys).
- System prompt = persona + GTech knowledge + tool descriptions.
- Tool calls the model can use: `get_balance`, `get_deposits`, `get_withdrawals`, `verify_txn`, `create_admin_request`, `web_research` (Gemini grounding). Verified-only tools refuse with a "please complete Telegram login" message in guest mode.

### 7. Admin dashboard
- Route `/admin` (Telegram Login Widget gate; only the two allowed usernames pass).
- Tabs: **Contact Requests** (live list, mark resolved), **Users** (search by @username → balance, deposit/withdrawal history, full chat transcript).

### 8. UI / design — premium, mobile-first
- Dark glass + neon-gold accent (GTech brand feel), oklch tokens in `src/styles.css`.
- 3D withdrawal animation: CSS `transform-style: preserve-3d` coin flip + particle burst on successful withdraw confirmation, plus subtle parallax floating GTC logo in chat header. Reduced-motion respected.
- Typing indicator, message bubbles, smooth slide-in, message timestamps. Sticky composer with safe-area insets for iOS.
- Lovable AI streaming → token-by-token rendering for speed.

### 9. Tech details
- Stack stays TanStack Start. No Edge Functions.
- Server functions: `chat.stream`, `verify_txn`, `get_user_data`, `create_admin_request`, `verify_telegram_login`.
- All write paths validate input with Zod and re-check the Telegram HMAC before trusting `telegram_username`.
- Chat history persisted to your Supabase via `chat_messages`; full history sent to the model each turn (recent 30 messages capped).

### 10. Build order
1. Add secrets form (Supabase keys + Telegram bot token).
2. Generate `sql/setup.sql` and show it in chat for you to run.
3. Knowledge ingestion (PDF parse + X scrape → static module).
4. Telegram Login Widget + verification server fn.
5. User-Supabase client + read helpers (balance/deposits/withdrawals).
6. AI chat streaming route + tool calling.
7. Premium UI with 3D withdrawal animation.
8. Admin dashboard.
9. QA on mobile viewport.

### Open items I'd like you to confirm after approving
- Exact table/column names in your Supabase for `users` / `deposits` / `withdrawals` (so I map them right the first time).
- Whether GTC TXN hashes should be verified on a specific chain explorer (and if so which — BSC, ETH, custom?).
