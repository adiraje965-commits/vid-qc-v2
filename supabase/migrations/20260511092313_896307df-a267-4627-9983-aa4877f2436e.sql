
-- Tag qc_tasks with source kind and pre-live version link
ALTER TABLE public.qc_tasks
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'live_url',
  ADD COLUMN IF NOT EXISTS prelive_version_id uuid;

CREATE INDEX IF NOT EXISTS qc_tasks_source_kind_idx ON public.qc_tasks(source_kind);
CREATE INDEX IF NOT EXISTS qc_tasks_prelive_version_idx ON public.qc_tasks(prelive_version_id);

-- prelive_assets
CREATE TABLE IF NOT EXISTS public.prelive_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid,
  campaign_name text NOT NULL,
  business_key text,
  persona text,
  channel text,
  aspect_ratio text,
  target_runtime_sec integer,
  languages text[] NOT NULL DEFAULT '{}',
  key_claims text[] NOT NULL DEFAULT '{}',
  mandatory_disclaimers text[] NOT NULL DEFAULT '{}',
  notes text,
  brief_pdf_path text,
  thumbnail_url text,
  latest_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.prelive_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners and admins read prelive_assets"
  ON public.prelive_assets FOR SELECT TO authenticated
  USING (auth.uid() = owner_id OR public.is_admin(auth.uid()));

CREATE POLICY "users insert own prelive_assets"
  ON public.prelive_assets FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "owners and admins update prelive_assets"
  ON public.prelive_assets FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id OR public.is_admin(auth.uid()));

CREATE POLICY "owners and admins delete prelive_assets"
  ON public.prelive_assets FOR DELETE TO authenticated
  USING (auth.uid() = owner_id OR public.is_admin(auth.uid()));

CREATE TRIGGER prelive_assets_updated_at
  BEFORE UPDATE ON public.prelive_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- prelive_versions
CREATE TABLE IF NOT EXISTS public.prelive_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.prelive_assets(id) ON DELETE CASCADE,
  version_label text NOT NULL,
  version_index integer NOT NULL,
  playbook_url text NOT NULL,
  resolved_video_url text,
  resolved_thumbnail_url text,
  duration_sec numeric,
  change_notes text,
  qc_task_id uuid,
  status text NOT NULL DEFAULT 'resolving',
  resolve_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, version_index)
);

CREATE INDEX IF NOT EXISTS prelive_versions_asset_idx ON public.prelive_versions(asset_id);
CREATE INDEX IF NOT EXISTS prelive_versions_qc_task_idx ON public.prelive_versions(qc_task_id);

ALTER TABLE public.prelive_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read prelive_versions via asset access"
  ON public.prelive_versions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.prelive_assets a
                 WHERE a.id = asset_id
                   AND (a.owner_id = auth.uid() OR public.is_admin(auth.uid()))));

CREATE POLICY "insert prelive_versions for own asset"
  ON public.prelive_versions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.prelive_assets a
                      WHERE a.id = asset_id
                        AND (a.owner_id = auth.uid() OR public.is_admin(auth.uid()))));

CREATE POLICY "update prelive_versions for own asset"
  ON public.prelive_versions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.prelive_assets a
                 WHERE a.id = asset_id
                   AND (a.owner_id = auth.uid() OR public.is_admin(auth.uid()))));

CREATE POLICY "delete prelive_versions for own asset"
  ON public.prelive_versions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.prelive_assets a
                 WHERE a.id = asset_id
                   AND (a.owner_id = auth.uid() OR public.is_admin(auth.uid()))));

CREATE TRIGGER prelive_versions_updated_at
  BEFORE UPDATE ON public.prelive_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for brief PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('pre-live-briefs', 'pre-live-briefs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "users read own brief pdfs"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pre-live-briefs'
         AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_admin(auth.uid())));

CREATE POLICY "users upload own brief pdfs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pre-live-briefs'
              AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users update own brief pdfs"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'pre-live-briefs'
         AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_admin(auth.uid())));

CREATE POLICY "users delete own brief pdfs"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'pre-live-briefs'
         AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_admin(auth.uid())));
