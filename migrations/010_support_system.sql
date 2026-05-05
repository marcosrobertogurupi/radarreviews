-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE ticket_status AS ENUM (
  'open', 'ai_triaged', 'in_progress', 'waiting_tenant',
  'escalated', 'resolved', 'closed', 'reopened',
  'ai_responding', 'ai_resolved', 'needs_human', 'learning'
);
CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE ticket_channel  AS ENUM ('portal', 'whatsapp', 'email', 'admin');
CREATE TYPE audit_action    AS ENUM (
  'created', 'status_changed', 'priority_changed', 'assigned',
  'message_added', 'attachment_added', 'sla_breached',
  'escalated', 'resolved', 'closed', 'reopened', 'csat_rated'
);

-- ============================================================
-- CATEGORIAS DE TICKET
-- ============================================================
CREATE TABLE ticket_categories (
  id        UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name      TEXT    NOT NULL UNIQUE,
  keywords  TEXT[]  DEFAULT '{}',
  color_hex TEXT    DEFAULT '#6366f1',
  icon      TEXT    DEFAULT 'tag',
  active    BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO ticket_categories (name, keywords, color_hex, icon) VALUES
  ('Conectores',     ARRAY['sincronizar','conector','google','facebook','tripadvisor'], '#3b82f6', 'plug'),
  ('Relatórios',     ARRAY['relatório','pdf','exportar','gráfico'],                    '#8b5cf6', 'chart'),
  ('Cobrança',       ARRAY['pagamento','fatura','assinatura','plano','cobrado'],        '#f59e0b', 'credit-card'),
  ('Acesso',         ARRAY['login','senha','acesso','conta','email'],                   '#ef4444', 'lock'),
  ('Funcionalidade', ARRAY['bug','erro','não funciona','problema','falha'],             '#10b981', 'bug'),
  ('Dúvida',         ARRAY['como','dúvida','tutorial','explicar','ajuda'],              '#6b7280', 'help-circle');

-- ============================================================
-- REGRAS DE SLA POR PLANO
-- ============================================================
CREATE TABLE ticket_sla_rules (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id             UUID            REFERENCES plans(id) ON DELETE SET NULL,
  priority            ticket_priority NOT NULL,
  first_response_mins INTEGER         NOT NULL,
  resolution_mins     INTEGER         NOT NULL,
  escalation_mins     INTEGER         NOT NULL,
  escalation_level    SMALLINT        NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, priority)
);

INSERT INTO ticket_sla_rules (plan_id, priority, first_response_mins, resolution_mins, escalation_mins, escalation_level)
VALUES
  (NULL, 'low',      480, 4320, 1440, 1),
  (NULL, 'medium',   240, 2880,  720, 1),
  (NULL, 'high',      60, 1440,  360, 2),
  (NULL, 'critical',  30,  480,  120, 3);

-- ============================================================
-- TABELA PRINCIPAL DE TICKETS
-- ============================================================
CREATE TABLE support_tickets (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by        UUID            NOT NULL REFERENCES auth.users(id),
  assigned_to       UUID            REFERENCES auth.users(id),
  ticket_number     SERIAL,
  subject           TEXT            NOT NULL,
  description       TEXT            NOT NULL,
  channel           ticket_channel  NOT NULL DEFAULT 'portal',
  category_id       UUID            REFERENCES ticket_categories(id),
  tags              TEXT[]          DEFAULT '{}',
  priority          ticket_priority NOT NULL DEFAULT 'medium',

  -- Campos preenchidos pela IA na triagem
  ai_sentiment      TEXT            CHECK (ai_sentiment IN ('positive','neutral','negative','frustrated')),
  ai_summary        TEXT,

  -- Campos do Agente de IA Autônomo
  ai_confidence     NUMERIC(4,3),
  ai_attempt_count  SMALLINT        NOT NULL DEFAULT 0,
  ai_doc_used_id    UUID,           -- FK adicionada na migration 011
  ai_handled        BOOLEAN         NOT NULL DEFAULT FALSE,
  ai_draft_response TEXT,

  -- Estado
  status            ticket_status   NOT NULL DEFAULT 'open',
  is_sla_breached   BOOLEAN         NOT NULL DEFAULT FALSE,
  escalation_level  SMALLINT        NOT NULL DEFAULT 0,

  -- Timestamps
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  first_response_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  sla_deadline      TIMESTAMPTZ,

  -- CSAT
  csat_score        SMALLINT        CHECK (csat_score BETWEEN 1 AND 5),
  csat_comment      TEXT,
  csat_at           TIMESTAMPTZ,

  -- WhatsApp
  whatsapp_thread_id TEXT,

  CONSTRAINT ticket_number_tenant_unique UNIQUE (tenant_id, ticket_number)
);

CREATE INDEX idx_tickets_tenant_status ON support_tickets(tenant_id, status);
CREATE INDEX idx_tickets_assigned      ON support_tickets(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_tickets_sla_deadline  ON support_tickets(sla_deadline) WHERE status NOT IN ('resolved','closed','ai_resolved');
CREATE INDEX idx_tickets_created_at    ON support_tickets(created_at DESC);

-- ============================================================
-- MENSAGENS / THREAD
-- ============================================================
CREATE TABLE ticket_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   UUID        REFERENCES auth.users(id),
  author_role TEXT        NOT NULL CHECK (author_role IN ('tenant_user','agent','ai','system')),
  body        TEXT        NOT NULL,
  is_internal BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_ticket ON ticket_messages(ticket_id, created_at);

-- ============================================================
-- ANEXOS
-- ============================================================
CREATE TABLE ticket_attachments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  message_id   UUID        REFERENCES ticket_messages(id) ON DELETE SET NULL,
  uploaded_by  UUID        NOT NULL REFERENCES auth.users(id),
  filename     TEXT        NOT NULL,
  mime_type    TEXT        NOT NULL,
  size_bytes   INTEGER     NOT NULL,
  storage_path TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AUDITORIA IMUTÁVEL
-- ============================================================
CREATE TABLE ticket_audit_log (
  id          BIGSERIAL    PRIMARY KEY,
  ticket_id   UUID         NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  actor_id    UUID         REFERENCES auth.users(id),
  actor_role  TEXT         NOT NULL DEFAULT 'system',
  action      audit_action NOT NULL,
  from_value  TEXT,
  to_value    TEXT,
  metadata    JSONB        DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_ticket ON ticket_audit_log(ticket_id, created_at);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE support_tickets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_audit_log   ENABLE ROW LEVEL SECURITY;

-- Tenants veem apenas seus tickets; admins veem tudo
CREATE POLICY tickets_select ON support_tickets
  FOR SELECT USING (tenant_id = auth_tenant_id() OR check_is_admin());

CREATE POLICY tickets_insert ON support_tickets
  FOR INSERT WITH CHECK (tenant_id = auth_tenant_id());

-- Mensagens: tenant vê apenas mensagens públicas dos seus tickets
CREATE POLICY messages_select ON ticket_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM support_tickets t
      WHERE t.id = ticket_id
        AND (t.tenant_id = auth_tenant_id() OR check_is_admin())
    )
    AND (is_internal = FALSE OR check_is_admin())
  );

-- Audit log: somente admins leem; nenhum role faz update/delete
CREATE POLICY audit_select ON ticket_audit_log
  FOR SELECT USING (check_is_admin());

-- ============================================================
-- TRIGGERS updated_at
-- ============================================================
CREATE TRIGGER set_ticket_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
