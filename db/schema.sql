CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  name TEXT NOT NULL,
  franchise_name TEXT,
  franchise_id BIGSERIAL UNIQUE,
  role TEXT NOT NULL DEFAULT 'OWNER',
  balance NUMERIC(14, 0) NOT NULL DEFAULT 0,
  phone TEXT,
  address TEXT,
  tel TEXT,
  business_number TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agency_id BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS biz_doc_file_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pos_file_key TEXT;
ALTER TABLE users ALTER COLUMN franchise_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  masked_number TEXT NOT NULL,
  card_name TEXT NOT NULL,
  card_company TEXT,
  alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE cards ADD COLUMN IF NOT EXISTS card_company TEXT;

CREATE TABLE IF NOT EXISTS account_requests (
  request_id TEXT PRIMARY KEY,
  franchise_id BIGINT NOT NULL,
  franchise_name TEXT NOT NULL,
  business_number TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  bank_name TEXT,
  delivery_agency_name TEXT,
  account_no TEXT,
  representative_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  document_url TEXT,
  assigned_virtual_account JSONB,
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY,
  franchise_id BIGINT NOT NULL,
  type TEXT NOT NULL,
  amount NUMERIC(14, 0) NOT NULL,
  fee NUMERIC(14, 0) NOT NULL,
  total_amount NUMERIC(14, 0) NOT NULL,
  method TEXT NOT NULL,
  card_details TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stored_files (
  file_key TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  public_url TEXT,
  uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agencies (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  parent_id BIGINT REFERENCES agencies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  address TEXT,
  login_id TEXT UNIQUE,
  password_hash TEXT,
  owner TEXT,
  phone TEXT,
  fee_rate NUMERIC(6, 3) NOT NULL DEFAULT 0,
  join_code TEXT UNIQUE,
  contract_file_key TEXT REFERENCES stored_files(file_key) ON DELETE SET NULL,
  settle_bank_name TEXT,
  settle_account_no TEXT,
  settle_account_holder TEXT,
  settle_doc_file_key TEXT REFERENCES stored_files(file_key) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_accounts (
  id BIGSERIAL PRIMARY KEY,
  franchise_id BIGINT NOT NULL,
  agency_id BIGINT REFERENCES agencies(id) ON DELETE SET NULL,
  agency_name TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  account_no TEXT NOT NULL,
  file_key TEXT REFERENCES stored_files(file_key) ON DELETE SET NULL,
  account_status TEXT NOT NULL DEFAULT 'PENDING',
  rejection_reason TEXT,
  req_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_agencies (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS pg_settlements (
  id BIGSERIAL PRIMARY KEY,
  settled_at TIMESTAMPTZ NOT NULL,
  approval_no TEXT NOT NULL UNIQUE,
  pg TEXT NOT NULL,
  pg_tx_id TEXT NOT NULL UNIQUE,
  franchise_id BIGINT,
  franchise_name TEXT NOT NULL,
  payment_amt NUMERIC(14, 0) NOT NULL,
  svc_fee NUMERIC(14, 0) NOT NULL,
  net_amt NUMERIC(14, 0) NOT NULL,
  agency_id BIGINT,
  agency_name TEXT,
  customer_id TEXT,
  bank_code TEXT,
  account_no TEXT,
  delivery_agency TEXT,
  status TEXT NOT NULL DEFAULT 'SETTLED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interest_free_installments (
  card_company TEXT PRIMARY KEY,
  months INTEGER[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS talk_posts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  franchise_id BIGINT,
  franchise_name TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  price NUMERIC(14, 0) NOT NULL DEFAULT 0,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_agency ON users(agency_id);
CREATE INDEX IF NOT EXISTS idx_transactions_franchise_created ON transactions(franchise_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_requests_status ON account_requests(status);
CREATE INDEX IF NOT EXISTS idx_delivery_accounts_franchise ON delivery_accounts(franchise_id);
CREATE INDEX IF NOT EXISTS idx_pg_settlements_settled_at ON pg_settlements(settled_at DESC);
CREATE INDEX IF NOT EXISTS idx_pg_settlements_agency ON pg_settlements(agency_id);
CREATE INDEX IF NOT EXISTS idx_interest_free_installments_active ON interest_free_installments(active, display_order);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_talk_posts_active_created ON talk_posts(status, created_at DESC);

ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
