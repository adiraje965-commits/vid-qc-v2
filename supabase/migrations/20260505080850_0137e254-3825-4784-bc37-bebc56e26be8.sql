
CREATE TABLE public.qc_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  video_url text,
  thumbnail_url text,
  page_title text,
  page_markdown text,
  customer_intent text,
  topic_match_score int,
  status text NOT NULL DEFAULT 'processing',
  overall_score int,
  technical_score int,
  brand_score int,
  strategic_score int,
  contextual_score int,
  critical_count int DEFAULT 0,
  high_count int DEFAULT 0,
  medium_count int DEFAULT 0,
  low_count int DEFAULT 0,
  key_frames jsonb DEFAULT '[]'::jsonb,
  analysis_summary text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.qc_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.qc_tasks(id) ON DELETE CASCADE,
  bucket text NOT NULL,
  severity text NOT NULL,
  timestamp_sec numeric,
  title text NOT NULL,
  description text,
  suggested_fix text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_qc_issues_task ON public.qc_issues(task_id);
CREATE INDEX idx_qc_tasks_created ON public.qc_tasks(created_at DESC);

ALTER TABLE public.qc_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read tasks" ON public.qc_tasks FOR SELECT USING (true);
CREATE POLICY "public insert tasks" ON public.qc_tasks FOR INSERT WITH CHECK (true);
CREATE POLICY "public update tasks" ON public.qc_tasks FOR UPDATE USING (true);
CREATE POLICY "public delete tasks" ON public.qc_tasks FOR DELETE USING (true);

CREATE POLICY "public read issues" ON public.qc_issues FOR SELECT USING (true);
CREATE POLICY "public insert issues" ON public.qc_issues FOR INSERT WITH CHECK (true);
CREATE POLICY "public update issues" ON public.qc_issues FOR UPDATE USING (true);
CREATE POLICY "public delete issues" ON public.qc_issues FOR DELETE USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_qc_tasks_updated BEFORE UPDATE ON public.qc_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.qc_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.qc_issues;
