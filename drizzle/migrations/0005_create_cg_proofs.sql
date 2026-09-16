CREATE TABLE public.cg_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id UUID NOT NULL REFERENCES public.cg_ads(id),
  tg_id BIGINT NOT NULL,
  file_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (ad_id, tg_id)
);

GRANT ALL ON public.cg_proofs TO service_role;

ALTER TABLE public.cg_proofs ENABLE ROW LEVEL SECURITY;