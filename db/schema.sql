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
  business_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agency_id BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS biz_doc_file_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pos_file_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_source TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_agency_id BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_join_code TEXT;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_business_number_key;
DROP INDEX IF EXISTS users_business_number_unique_except_test_idx;
CREATE UNIQUE INDEX IF NOT EXISTS users_business_number_unique_except_test_idx
  ON users (business_number)
  WHERE business_number IS NOT NULL
    AND business_number <> ''
    AND regexp_replace(business_number, '[^0-9]', '', 'g') <> '1234512345';
ALTER TABLE users ALTER COLUMN franchise_id DROP NOT NULL;
UPDATE users SET login_id = email WHERE login_id IS NULL;

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  masked_number TEXT NOT NULL,
  card_name TEXT NOT NULL,
  card_company TEXT,
  alias TEXT NOT NULL,
  payer_name TEXT,
  payer_email TEXT,
  payer_tel TEXT,
  card_identity TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE cards ADD COLUMN IF NOT EXISTS card_company TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS payer_name TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS payer_email TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS payer_tel TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS card_identity TEXT;

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
  export_ready_at TIMESTAMPTZ,
  export_batch_id TEXT,
  export_row_no INTEGER,
  exported_at TIMESTAMPTZ,
  txid TEXT,
  txid_uploaded_at TIMESTAMPTZ,
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
  pg TEXT,
  pg_tx_id TEXT,
  auth_code TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pg TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pg_tx_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS auth_code TEXT;

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

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT,
  actor_role TEXT NOT NULL DEFAULT '',
  actor_login_id TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  entity_name TEXT NOT NULL DEFAULT '',
  before_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_fields TEXT[] NOT NULL DEFAULT '{}',
  request_method TEXT NOT NULL DEFAULT '',
  request_path TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action, created_at DESC);

CREATE TABLE IF NOT EXISTS agencies (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 3,
  parent_id BIGINT REFERENCES agencies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  address TEXT,
  login_id TEXT UNIQUE,
  password_hash TEXT,
  owner TEXT,
  phone TEXT,
  fee_rate NUMERIC(6, 3) NOT NULL DEFAULT 0,
  delivery_note TEXT,
  join_code TEXT UNIQUE,
  contract_file_key TEXT REFERENCES stored_files(file_key) ON DELETE SET NULL,
  settle_bank_name TEXT,
  settle_account_no TEXT,
  settle_account_holder TEXT,
  settle_doc_file_key TEXT REFERENCES stored_files(file_key) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agencies ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 3;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS delivery_note TEXT;

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
  approved_at TIMESTAMPTZ,
  export_ready_at TIMESTAMPTZ,
  export_batch_id TEXT,
  export_row_no INTEGER,
  exported_at TIMESTAMPTZ,
  txid TEXT,
  txid_uploaded_at TIMESTAMPTZ,
  req_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_agencies (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  coverage_area TEXT,
  phone TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7);
ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7);
ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS coverage_area TEXT;
ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS description TEXT;

CREATE TABLE IF NOT EXISTS benefit_cards (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT NOT NULL DEFAULT '',
  rank_no INTEGER,
  card_company TEXT NOT NULL,
  card_name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  discount_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  annual_fee TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  source_card_idx TEXT,
  image_url TEXT,
  event_title TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, card_company, card_name)
);

CREATE INDEX IF NOT EXISTS idx_benefit_cards_active_rank ON benefit_cards(active, rank_no, id);

CREATE TABLE IF NOT EXISTS pg_settlements (
  id BIGSERIAL PRIMARY KEY,
  settled_at TIMESTAMPTZ,
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

ALTER TABLE pg_settlements ALTER COLUMN settled_at DROP NOT NULL;

CREATE TABLE IF NOT EXISTS pg_providers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  mid TEXT,
  api_key TEXT,
  callback_url TEXT,
  status TEXT NOT NULL DEFAULT '활성',
  note TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interest_free_installments (
  policy_month DATE NOT NULL DEFAULT date_trunc('month', now())::date,
  card_company TEXT PRIMARY KEY,
  months INTEGER[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE interest_free_installments ADD COLUMN IF NOT EXISTS policy_month DATE;
UPDATE interest_free_installments
  SET policy_month = date_trunc('month', now())::date
  WHERE policy_month IS NULL;
ALTER TABLE interest_free_installments ALTER COLUMN policy_month SET DEFAULT date_trunc('month', now())::date;
ALTER TABLE interest_free_installments ALTER COLUMN policy_month SET NOT NULL;
ALTER TABLE interest_free_installments DROP CONSTRAINT IF EXISTS interest_free_installments_pkey;
ALTER TABLE interest_free_installments ADD PRIMARY KEY (policy_month, card_company);

CREATE TABLE IF NOT EXISTS agency_inquiries (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  delivery_agency TEXT,
  region TEXT,
  handler TEXT,
  status TEXT NOT NULL DEFAULT '상담 대기',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
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
  image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  trade_status TEXT NOT NULL DEFAULT 'SALE',
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS talk_chats (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES talk_posts(id) ON DELETE CASCADE,
  seller_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  buyer_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(post_id, buyer_user_id)
);

CREATE TABLE IF NOT EXISTS talk_messages (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL REFERENCES talk_chats(id) ON DELETE CASCADE,
  sender_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS talk_post_likes (
  post_id BIGINT NOT NULL REFERENCES talk_posts(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS talk_reports (
  id BIGSERIAL PRIMARY KEY,
  reporter_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  post_id BIGINT REFERENCES talk_posts(id) ON DELETE SET NULL,
  chat_id BIGINT REFERENCES talk_chats(id) ON DELETE SET NULL,
  message_id BIGINT REFERENCES talk_messages(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_agency ON users(agency_id);
CREATE INDEX IF NOT EXISTS idx_transactions_franchise_created ON transactions(franchise_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_requests_status ON account_requests(status);
CREATE INDEX IF NOT EXISTS idx_delivery_accounts_franchise ON delivery_accounts(franchise_id);
CREATE INDEX IF NOT EXISTS idx_account_requests_export_pending ON account_requests(status, exported_at, processed_at);
CREATE INDEX IF NOT EXISTS idx_delivery_accounts_export_pending ON delivery_accounts(account_status, exported_at, approved_at);
CREATE INDEX IF NOT EXISTS idx_pg_settlements_settled_at ON pg_settlements(settled_at DESC);
CREATE INDEX IF NOT EXISTS idx_pg_settlements_agency ON pg_settlements(agency_id);
CREATE INDEX IF NOT EXISTS idx_pg_providers_status ON pg_providers(status, display_order);
CREATE INDEX IF NOT EXISTS idx_interest_free_installments_active ON interest_free_installments(active, display_order);
CREATE INDEX IF NOT EXISTS idx_agency_inquiries_status ON agency_inquiries(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_talk_posts_active_created ON talk_posts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_talk_chats_user_updated ON talk_chats(buyer_user_id, seller_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_talk_messages_chat_created ON talk_messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_talk_reports_status_created ON talk_reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS board_posts (
  id BIGSERIAL PRIMARY KEY,
  board_type TEXT NOT NULL CHECK (board_type IN ('notices', 'guides')),
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '운영팀',
  content TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_board_posts_type_active ON board_posts(board_type, active, created_at DESC);

CREATE TABLE IF NOT EXISTS faqs (
  id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL DEFAULT '서비스 안내',
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_faqs_active_category ON faqs(active, category, display_order, id);

CREATE TABLE IF NOT EXISTS legal_documents (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('terms', 'privacy')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_file_name TEXT,
  applied BOOLEAN NOT NULL DEFAULT false,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_documents_type_applied ON legal_documents(type, applied, applied_at DESC, id DESC);

ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE delivery_agencies ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
