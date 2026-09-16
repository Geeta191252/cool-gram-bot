CREATE TABLE IF NOT EXISTS public.cg_bot_chats (
  chat_id BIGINT PRIMARY KEY,
  title TEXT,
  username TEXT,
  type TEXT,
  status TEXT NOT NULL DEFAULT 'administrator',
  added_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.cg_bot_chats TO service_role;

ALTER TABLE public.cg_bot_chats ENABLE ROW LEVEL SECURITY;