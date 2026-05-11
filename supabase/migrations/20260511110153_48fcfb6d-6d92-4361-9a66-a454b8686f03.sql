
-- prelive_assets: anon access for unowned rows
CREATE POLICY "guests can read prelive_assets" ON public.prelive_assets FOR SELECT TO anon USING (true);
CREATE POLICY "guests can insert unowned prelive_assets" ON public.prelive_assets FOR INSERT TO anon WITH CHECK (owner_id IS NULL);
CREATE POLICY "guests can update unowned prelive_assets" ON public.prelive_assets FOR UPDATE TO anon USING (owner_id IS NULL) WITH CHECK (owner_id IS NULL);

-- Also allow authenticated reads of unowned rows so signed-in users see guest-created assets
CREATE POLICY "authenticated read unowned prelive_assets" ON public.prelive_assets FOR SELECT TO authenticated USING (owner_id IS NULL);
CREATE POLICY "authenticated update unowned prelive_assets" ON public.prelive_assets FOR UPDATE TO authenticated USING (owner_id IS NULL) WITH CHECK (owner_id IS NULL);
CREATE POLICY "authenticated insert prelive_assets nullable" ON public.prelive_assets FOR INSERT TO authenticated WITH CHECK (owner_id IS NULL);

-- prelive_versions: anon access via parent asset
CREATE POLICY "guests read prelive_versions" ON public.prelive_versions FOR SELECT TO anon USING (
  EXISTS (SELECT 1 FROM public.prelive_assets a WHERE a.id = prelive_versions.asset_id AND a.owner_id IS NULL)
);
CREATE POLICY "guests insert prelive_versions" ON public.prelive_versions FOR INSERT TO anon WITH CHECK (
  EXISTS (SELECT 1 FROM public.prelive_assets a WHERE a.id = prelive_versions.asset_id AND a.owner_id IS NULL)
);
CREATE POLICY "guests update prelive_versions" ON public.prelive_versions FOR UPDATE TO anon USING (
  EXISTS (SELECT 1 FROM public.prelive_assets a WHERE a.id = prelive_versions.asset_id AND a.owner_id IS NULL)
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.prelive_assets a WHERE a.id = prelive_versions.asset_id AND a.owner_id IS NULL)
);

CREATE POLICY "authenticated read unowned prelive_versions" ON public.prelive_versions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.prelive_assets a WHERE a.id = prelive_versions.asset_id AND a.owner_id IS NULL)
);
CREATE POLICY "authenticated insert prelive_versions unowned" ON public.prelive_versions FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.prelive_assets a WHERE a.id = prelive_versions.asset_id AND a.owner_id IS NULL)
);
CREATE POLICY "authenticated update prelive_versions unowned" ON public.prelive_versions FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.prelive_assets a WHERE a.id = prelive_versions.asset_id AND a.owner_id IS NULL)
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.prelive_assets a WHERE a.id = prelive_versions.asset_id AND a.owner_id IS NULL)
);
