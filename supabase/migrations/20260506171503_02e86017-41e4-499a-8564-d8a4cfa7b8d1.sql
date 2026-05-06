insert into storage.buckets (id, name, public) values ('transcribe-audio', 'transcribe-audio', true) on conflict (id) do nothing;

create policy "Public read transcribe-audio"
on storage.objects for select
using (bucket_id = 'transcribe-audio');

create policy "Service role write transcribe-audio"
on storage.objects for insert
with check (bucket_id = 'transcribe-audio');

create policy "Service role delete transcribe-audio"
on storage.objects for delete
using (bucket_id = 'transcribe-audio');