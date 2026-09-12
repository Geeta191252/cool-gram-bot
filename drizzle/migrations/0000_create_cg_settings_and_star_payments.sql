CREATE TABLE public.cg_settings (
  key TEXT PRIMARY KEY,
  value NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.cg_settings TO service_role;
ALTER TABLE public.cg_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.cg_star_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tg_id BIGINT NOT NULL,
  username TEXT,
  stars INTEGER NOT NULL,
  credited INTEGER NOT NULL,
  charge_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.cg_star_payments TO service_role;
ALTER TABLE public.cg_star_payments ENABLE ROW LEVEL SECURITY;
