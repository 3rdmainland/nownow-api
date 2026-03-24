-- Legal Documents & Acceptance Tracking
-- SA-compliant: CPA, POPIA, ECT Act

-- ── legal_documents ─────────────────────────────────────────────────
-- Stores versioned legal documents (T&Cs, Privacy Policy, Refund Policy, etc.)
-- Composite PK: slug + version. Only one version per slug may be published.

CREATE TABLE IF NOT EXISTS legal_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL,                -- e.g. 'terms-and-conditions', 'privacy-policy'
  version       INTEGER NOT NULL DEFAULT 1,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,                -- Markdown body
  is_published  BOOLEAN NOT NULL DEFAULT FALSE,
  created_by    UUID,                         -- admin_users.id
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (slug, version)
);

-- Fast lookup for published doc by slug
CREATE INDEX IF NOT EXISTS idx_legal_documents_published
  ON legal_documents (slug, is_published) WHERE is_published = TRUE;

-- ── legal_acceptances ───────────────────────────────────────────────
-- Immutable audit trail: who accepted which document version, when, from where.
-- No UPDATE or DELETE should ever be run against this table.

CREATE TABLE IF NOT EXISTS legal_acceptances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES legal_documents(id),
  customer_id     UUID,                       -- customers.id (nullable for guest)
  customer_phone  TEXT,                       -- phone for traceability
  ip_address      TEXT,
  user_agent      TEXT,
  accepted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_document
  ON legal_acceptances (document_id);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_customer
  ON legal_acceptances (customer_id);

-- Enable Row Level Security (read-only for service role)
ALTER TABLE legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;
