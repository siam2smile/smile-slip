-- ระบบแต้มสะสม (loyalty points) — ข้อ 102 ใน CLAUDE.md
-- รันครั้งเดียวใน Supabase SQL Editor ของโปรเจกต์

ALTER TABLE pos_configs
  ADD COLUMN IF NOT EXISTS loyalty_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS loyalty_baht_per_point numeric,
  ADD COLUMN IF NOT EXISTS loyalty_expiry_months integer;

ALTER TABLE pos_products
  ADD COLUMN IF NOT EXISTS loyalty_baht_per_point numeric;

CREATE TABLE IF NOT EXISTS pos_loyalty_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  contact_id  text NOT NULL,
  entry_type  text NOT NULL CHECK (entry_type IN ('earn','redeem','adjust')),
  points      numeric NOT NULL,
  ref         text,
  note        text,
  branch_name text,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_loyalty_ledger_contact ON pos_loyalty_ledger (shop_id, contact_id);

CREATE TABLE IF NOT EXISTS pos_loyalty_rewards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  reward_no    text NOT NULL,
  name         text NOT NULL,
  points_cost  numeric NOT NULL,
  product_sku  text NOT NULL,
  product_qty  integer NOT NULL DEFAULT 1,
  is_active    boolean NOT NULL DEFAULT true,
  branch_name  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (shop_id, reward_no)
);
