// Map your existing Supabase column names here if they differ.
export const userDb = {
  users: {
    table: "users",
    username: "username",
    telegramId: "telegram_id",
    balance: "balance_gtc",
    phone: "phone",
  },
  deposits: {
    table: "deposits",
    telegramId: "telegram_id",
    amount: "amount",
    txnHash: "txn_hash",
    status: "status",
    createdAt: "created_at",
  },
  withdrawals: {
    table: "withdrawals",
    telegramId: "telegram_id",
    amount: "amount",
    txnHash: "txn_hash",
    status: "status",
    createdAt: "created_at",
  },
};

// Admin usernames — full admin dashboard access.
// @yashu_gtech is the developer of the Gtech Era2 ecosystem.
export const ADMIN_USERNAMES = [
  "gtechnetwork_support",
  "yashu_gtech",
] as const;

// Trainer accounts can add/edit the bot's training knowledge base.
export const TRAINER_USERNAMES = ["yashu_gtech"] as const;

export function normalizeUsername(u: string): string {
  return u.replace(/^@/, "").trim().toLowerCase();
}

export function isAdmin(u: string | null | undefined): boolean {
  if (!u) return false;
  return (ADMIN_USERNAMES as readonly string[]).includes(normalizeUsername(u));
}

export function isTrainer(u: string | null | undefined): boolean {
  if (!u) return false;
  return (TRAINER_USERNAMES as readonly string[]).includes(normalizeUsername(u));
}
