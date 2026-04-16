create extension if not exists pgcrypto;

create table if not exists public.registration_data (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  registration_number text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_registration_data_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_registration_data_updated_at on public.registration_data;
create trigger set_registration_data_updated_at
before update on public.registration_data
for each row
execute function public.set_registration_data_updated_at();

alter table public.registration_data enable row level security;

drop policy if exists "registration_data_select_own" on public.registration_data;
create policy "registration_data_select_own"
on public.registration_data
for select
using (auth.uid() = user_id);

drop policy if exists "registration_data_insert_own" on public.registration_data;
create policy "registration_data_insert_own"
on public.registration_data
for insert
with check (auth.uid() = user_id);

drop policy if exists "registration_data_update_own" on public.registration_data;
create policy "registration_data_update_own"
on public.registration_data
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
