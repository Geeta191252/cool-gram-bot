CREATE TABLE IF NOT EXISTS public.cg_cron_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.cg_cron_tokens TO service_role;
ALTER TABLE public.cg_cron_tokens ENABLE ROW LEVEL SECURITY;

INSERT INTO public.cg_cron_tokens (token)
SELECT encode(gen_random_bytes(24), 'hex')
WHERE NOT EXISTS (SELECT 1 FROM public.cg_cron_tokens);