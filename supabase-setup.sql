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

drop policy if exists "Anyone can insert flowers" on public.flowers;
create policy "Anyone can insert flowers"
on public.flowers
for insert
to anon, authenticated
with check (true);

insert into storage.buckets (id, name, public)
values ('flower-images', 'flower-images', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "Public flower image read access" on storage.objects;
create policy "Public flower image read access"
on storage.objects
for select
to public
using (bucket_id = 'flower-images');

-- Drawings are uploaded to pending/ for the classifier, then removed right after.
drop policy if exists "Remove pending flower images" on storage.objects;
create policy "Remove pending flower images"
on storage.objects
for delete
to anon, authenticated
using (bucket_id = 'flower-images' and name like 'pending/%');

drop policy if exists "Public flower image uploads" on storage.objects;
create policy "Public flower image uploads"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'flower-images');
