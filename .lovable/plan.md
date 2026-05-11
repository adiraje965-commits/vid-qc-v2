## Remove sign-in wall from Pre-Live

The app's `ProtectedRoute` is already a passthrough (open app), and the live `/new` flow works anonymously because `qc_tasks` allows `owner_id IS NULL` for `anon`. Pre-Live broke that pattern by requiring a logged-in user in two places:

1. **Client gate** in `src/pages/PreLiveNew.tsx`: `if (!user) { toast("Sign in first"); return; }` — blocks submit.
2. **RLS** on `prelive_assets` / `prelive_versions`: only `authenticated` role with `auth.uid() = owner_id` can insert/select. Anonymous visitors get rejected by the database even if the client gate is removed.

### Changes

**Frontend (`src/pages/PreLiveNew.tsx`)**
- Drop the `if (!user)` guard.
- Insert `prelive_assets` with `owner_id: user?.id ?? null` (mirrors `qc_tasks` guest pattern).
- Insert `qc_tasks` with `owner_id: user?.id ?? null`.
- Pass `ownerId={user?.id ?? null}` to `BriefForm` (already nullable).

**Frontend (`src/pages/PreLiveList.tsx`, `PreLiveAsset.tsx`, `PreLiveDiff.tsx`)**
- Remove any `user`-required guards so anonymous visitors can list/view/diff.

**Database migration** — extend RLS to mirror `qc_tasks` guest policies:
- `prelive_assets`: add `anon` SELECT (`true`), `anon` INSERT (`owner_id IS NULL`), `anon` UPDATE (`owner_id IS NULL`).
- `prelive_versions`: add `anon` SELECT/INSERT/UPDATE gated by parent asset where `owner_id IS NULL`.
- Keep existing authenticated-owner policies untouched.

**Storage (`pre-live-briefs` bucket)** — only relevant if a guest uploads a brief PDF. Current policies likely require auth. Two options:
- (a) Skip PDF upload for guests (simplest — `BriefForm` already handles `ownerId === null` by hiding/disabling upload, will verify), or
- (b) Add an `anon` policy to allow uploads under a `guest/` prefix.
  Default to (a) unless you want guests to upload PDFs.

### Out of scope
- No changes to auth provider, redirect URIs, or `AuthContext`.
- No changes to live `/new` flow or `qc_tasks` policies.
- Signed-in users keep working exactly as today; their rows are owned and private.

### Verification
- Anonymous: open `/prelive/new` in an incognito preview, submit a Playbook URL → asset + v1 created, redirect to asset page, Deep Review runs.
- Signed-in: same flow, row has `owner_id` set, only owner/admin can see it.
