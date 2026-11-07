create extension if not exists pgcrypto;

create table if not exists public.flowers (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  created_at timestamptz not null default timezone('utc', now()),
  x double precision not null,
  y double precision not null,
  size double precision not null,
  tilt double precision not null
);

-- Which garden a drawing belongs to: the shared nice garden or the secret garden.
alter table public.flowers
  add column if not exists garden text not null default 'nice'
  check (garden in ('nice', 'secret'));

create index if not exists flowers_garden_created_at_idx
  on public.flowers (garden, created_at desc);

alter table public.flowers enable row level security;

drop policy if exists "Anyone can read flowers" on public.flowers;
create policy "Anyone can read flowers"
on public.flowers
for select
to anon, authenticated
using (true);

-- Visitors can only read. The backend saves accepted flowers with the service-role key, which
-- bypasses row level security, so a drawing can't reach the garden without passing the classifier.
drop policy if exists "Anyone can insert flowers" on public.flowers;

-- Small PNG drawings only, so the public bucket can't be used to host other files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flower-images', 'flower-images', true, 1048576, array['image/png'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public flower image read access" on storage.objects;
create policy "Public flower image read access"
on storage.objects
for select
to public
using (bucket_id = 'flower-images');

-- Only the backend uploads and removes images (pending/ for the classifier, flowers/ once
-- accepted), so visitors get no upload or delete access.
drop policy if exists "Remove pending flower images" on storage.objects;
drop policy if exists "Public flower image uploads" on storage.objects;
