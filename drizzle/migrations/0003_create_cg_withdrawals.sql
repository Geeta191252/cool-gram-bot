CREATE TABLE IF NOT EXISTS public.cg_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tg_id bigint NOT NULL,
  username text,
  amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
GRANT ALL ON public.cg_withdrawals TO service_role;
ALTER TABLE public.cg_withdrawals ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_cg_withdrawals_status ON public.cg_withdrawals (status, created_at);