-- ============================================================
-- PRD 4: daily_brief_state tracking table
-- Run in Supabase SQL Editor before deploying the daily brief
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_brief_state (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  key        text        NOT NULL UNIQUE,
  value      integer     NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE daily_brief_state ENABLE ROW LEVEL SECURITY;
-- Service role bypasses RLS automatically — no anon policies needed

-- Seed initial state
INSERT INTO daily_brief_state (key, value) VALUES
  ('medicare_index',   0),
  ('monday_index',     0),
  ('tuesday_index',    0),
  ('wednesday_index',  0),
  ('thursday_index',   0),
  ('friday_index',     0),
  ('saturday_index',   0),
  ('sunday_index',     0)
ON CONFLICT (key) DO NOTHING;

-- Verify
SELECT key, value FROM daily_brief_state ORDER BY key;
