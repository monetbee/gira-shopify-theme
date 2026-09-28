-- GIRA Loyalty source of truth. PostgreSQL 15+.
-- Monetary amounts use ISO currency minor units. For JPY this is whole yen.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE reservation_status AS ENUM ('pending', 'code_issued', 'applied', 'consumed', 'released', 'expired', 'cancelled');
CREATE TYPE wallet_transaction_kind AS ENUM (
  'welcome_bonus', 'order_earned', 'earn_reversal',
  'redemption_reserved', 'redemption_released', 'redemption_consumed', 'redemption_restored',
  'manual_adjustment'
);
CREATE TYPE allocation_kind AS ENUM ('earn', 'redemption', 'earn_reversal', 'redemption_restore');

CREATE TABLE wallet_balances (
  shop_id text NOT NULL,
  customer_id bigint NOT NULL,
  available_sparks bigint NOT NULL DEFAULT 0 CHECK (available_sparks >= 0),
  reserved_sparks bigint NOT NULL DEFAULT 0 CHECK (reserved_sparks >= 0),
  lock_version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, customer_id)
);

CREATE TABLE wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id text NOT NULL,
  customer_id bigint NOT NULL,
  kind wallet_transaction_kind NOT NULL,
  delta_available bigint NOT NULL,
  delta_reserved bigint NOT NULL,
  balance_after_available bigint NOT NULL CHECK (balance_after_available >= 0),
  balance_after_reserved bigint NOT NULL CHECK (balance_after_reserved >= 0),
  idempotency_key text NOT NULL,
  reference_type text,
  reference_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, idempotency_key)
);
CREATE INDEX wallet_transactions_customer_created_idx ON wallet_transactions(shop_id, customer_id, created_at DESC);

CREATE TABLE redemption_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id text NOT NULL,
  customer_id bigint NOT NULL,
  sparks bigint NOT NULL CHECK (sparks >= 20 AND sparks % 20 = 0),
  currency char(3) NOT NULL DEFAULT 'JPY',
  requested_discount_minor bigint NOT NULL CHECK (requested_discount_minor >= 1),
  cart_fingerprint text NOT NULL,
  status reservation_status NOT NULL DEFAULT 'pending',
  discount_code_id text,
  discount_code text,
  order_id bigint,
  consumed_sparks bigint CHECK (consumed_sparks IS NULL OR (consumed_sparks >= 0 AND consumed_sparks <= sparks AND consumed_sparks % 20 = 0)),
  idempotency_key text NOT NULL,
  expires_at timestamptz NOT NULL,
  status_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, idempotency_key),
  UNIQUE (shop_id, discount_code_id)
);
CREATE INDEX redemption_reservations_expiry_idx ON redemption_reservations(status, expires_at);
CREATE INDEX redemption_reservations_customer_idx ON redemption_reservations(shop_id, customer_id, status);

-- Every order-line SPARKS attribution is append-only. A return adds a reversal
-- allocation; it never overwrites an original earn/redemption allocation.
CREATE TABLE order_spark_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id text NOT NULL,
  order_id bigint NOT NULL,
  order_line_item_id bigint NOT NULL,
  customer_id bigint NOT NULL,
  kind allocation_kind NOT NULL,
  sparks bigint NOT NULL CHECK (sparks >= 0),
  currency char(3) NOT NULL DEFAULT 'JPY',
  money_minor bigint NOT NULL CHECK (money_minor >= 0),
  reservation_id uuid REFERENCES redemption_reservations(id),
  related_allocation_id uuid REFERENCES order_spark_allocations(id),
  refund_id bigint,
  return_reason_code text,
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, idempotency_key)
);
CREATE INDEX order_spark_allocations_line_idx ON order_spark_allocations(shop_id, order_id, order_line_item_id);
CREATE INDEX order_spark_allocations_reservation_idx ON order_spark_allocations(reservation_id) WHERE reservation_id IS NOT NULL;

CREATE TABLE webhook_receipts (
  shop_id text NOT NULL,
  webhook_id uuid NOT NULL,
  topic text NOT NULL,
  api_version text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  PRIMARY KEY (shop_id, webhook_id)
);
CREATE INDEX webhook_receipts_unprocessed_idx ON webhook_receipts(received_at) WHERE processed_at IS NULL;

-- Enforce append-only ledger and allocation history at the database boundary.
CREATE OR REPLACE FUNCTION prohibit_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wallet_transactions_append_only
  BEFORE UPDATE OR DELETE ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION prohibit_history_mutation();
CREATE TRIGGER order_spark_allocations_append_only
  BEFORE UPDATE OR DELETE ON order_spark_allocations
  FOR EACH ROW EXECUTE FUNCTION prohibit_history_mutation();
