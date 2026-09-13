ALTER TABLE public.cg_ads ADD COLUMN IF NOT EXISTS boost_days integer;

CREATE TABLE IF NOT EXISTS public.cg_boost_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id uuid NOT NULL REFERENCES public.cg_ads(id) ON DELETE CASCADE,
  tg_id bigint NOT NULL,
  total_days integer NOT NULL DEFAULT 7,
  days_claimed integer NOT NULL DEFAULT 0,
  last_claim_at timestamptz NOT NULL DEFAULT now(),
  reminded_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_id, tg_id)
);

GRANT ALL ON public.cg_boost_claims TO service_role;
ALTER TABLE public.cg_boost_claims ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_cg_boost_claims_due
  ON public.cg_boost_claims (status, last_claim_at);