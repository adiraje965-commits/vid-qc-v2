ALTER TABLE public.qc_tasks ADD COLUMN IF NOT EXISTS bucket_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.qc_issues ADD COLUMN IF NOT EXISTS criterion text;