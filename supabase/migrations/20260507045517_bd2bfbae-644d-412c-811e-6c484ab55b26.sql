CREATE POLICY "guests can read tasks"
ON public.qc_tasks
FOR SELECT
TO anon
USING (true);

CREATE POLICY "guests can create unowned tasks"
ON public.qc_tasks
FOR INSERT
TO anon
WITH CHECK (owner_id IS NULL);

CREATE POLICY "guests can update unowned tasks"
ON public.qc_tasks
FOR UPDATE
TO anon
USING (owner_id IS NULL)
WITH CHECK (owner_id IS NULL);

CREATE POLICY "guests can read issues"
ON public.qc_issues
FOR SELECT
TO anon
USING (true);