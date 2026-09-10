CREATE TABLE public.cg_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tg_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  balance INTEGER NOT NULL DEFAULT 0,
  referred_by BIGINT,
  referral_count INTEGER NOT NULL DEFAULT 0,
  pending_action TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.cg_users TO service_role;
ALTER TABLE public.cg_users ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.cg_ads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_tg BIGINT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  reward INTEGER NOT NULL DEFAULT 5,
  budget_left INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.cg_ads TO service_role;
ALTER TABLE public.cg_ads ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_cg_ads_active ON public.cg_ads (is_active, created_at);

CREATE TABLE public.cg_completions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ad_id UUID NOT NULL REFERENCES public.cg_ads(id) ON DELETE CASCADE,
  tg_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ad_id, tg_id)
);
GRANT ALL ON public.cg_completions TO service_role;
ALTER TABLE public.cg_completions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.cg_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tg_id BIGINT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.cg_transactions TO service_role;
ALTER TABLE public.cg_transactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_cg_tx_user ON public.cg_transactions (tg_id, created_at DESC);

CREATE TABLE public.cg_telegram_updates (
  update_id BIGINT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.cg_telegram_updates TO service_role;
ALTER TABLE public.cg_telegram_updates ENABLE ROW LEVEL SECURITY;