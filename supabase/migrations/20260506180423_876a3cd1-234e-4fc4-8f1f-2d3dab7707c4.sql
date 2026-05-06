
-- 1. Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- 2. Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'reviewer', 'viewer');
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin')
$$;

CREATE POLICY "roles readable by authenticated" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- 3. Auto-create profile + first-user promotion to admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_count INT;
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
    -- assign all existing tasks to this first user
    UPDATE public.qc_tasks SET owner_id = NEW.id WHERE owner_id IS NULL;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'reviewer');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Extend qc_tasks
ALTER TABLE public.qc_tasks
  ADD COLUMN owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN approval_note TEXT,
  ADD COLUMN approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN approved_at TIMESTAMPTZ;
CREATE INDEX idx_qc_tasks_owner ON public.qc_tasks(owner_id);
CREATE INDEX idx_qc_tasks_tags ON public.qc_tasks USING GIN(tags);

-- Replace permissive RLS with auth-aware
DROP POLICY "public delete tasks" ON public.qc_tasks;
DROP POLICY "public insert tasks" ON public.qc_tasks;
DROP POLICY "public read tasks" ON public.qc_tasks;
DROP POLICY "public update tasks" ON public.qc_tasks;

CREATE POLICY "authenticated read tasks" ON public.qc_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated insert own tasks" ON public.qc_tasks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id OR owner_id IS NULL);
CREATE POLICY "owners and admins update tasks" ON public.qc_tasks FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id OR public.is_admin(auth.uid()));
CREATE POLICY "owners and admins delete tasks" ON public.qc_tasks FOR DELETE TO authenticated
  USING (auth.uid() = owner_id OR public.is_admin(auth.uid()));

-- Same for qc_issues
DROP POLICY "public delete issues" ON public.qc_issues;
DROP POLICY "public insert issues" ON public.qc_issues;
DROP POLICY "public read issues" ON public.qc_issues;
DROP POLICY "public update issues" ON public.qc_issues;

CREATE POLICY "authenticated read issues" ON public.qc_issues FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated write issues" ON public.qc_issues FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated update issues" ON public.qc_issues FOR UPDATE TO authenticated USING (true);
CREATE POLICY "authenticated delete issues" ON public.qc_issues FOR DELETE TO authenticated USING (true);

-- 5. Comments table
CREATE TABLE public.qc_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.qc_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  timestamp_sec NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.qc_comments ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_qc_comments_task ON public.qc_comments(task_id, created_at);
CREATE POLICY "authenticated read comments" ON public.qc_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "users insert own comments" ON public.qc_comments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own comments" ON public.qc_comments FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "users or admins delete comments" ON public.qc_comments FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- 6. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.qc_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.qc_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.qc_issues;
