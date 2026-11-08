create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('candidate','recruiter','admin')),
  company text,
  country text,
  cv_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id bigserial primary key,
  recruiter_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  company text not null,
  description text not null,
  country text not null,
  city text,
  contract_type text not null,
  workplace text default 'On-site',
  salary text,
  category text,
  status text not null default 'pending' check (status in ('pending','published','rejected','closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.applications (
  id bigserial primary key,
  reference text not null unique,
  job_id bigint references public.jobs(id) on delete set null,
  candidate_id uuid references public.users(id) on delete set null,
  full_name text not null,
  email text not null,
  phone text,
  nationality text,
  residence_country text,
  target_country text not null,
  profession text not null,
  contract_type text not null,
  experience text,
  message text,
  cv_path text,
  status text not null default 'received'
    check (status in ('received','under_review','shortlisted','approved','rejected','completed')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  plan text not null check (plan in ('candidate_premium','recruiter_premium')),
  amount_cents integer not null,
  currency text not null default 'USD',
  status text not null default 'pending_payment',
  provider text,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_ref on public.applications(reference);
create index if not exists idx_app_candidate on public.applications(candidate_id);
create index if not exists idx_jobs_status on public.jobs(status);
create index if not exists idx_jobs_recruiter on public.jobs(recruiter_id);
create index if not exists idx_sub_user on public.subscriptions(user_id);

-- RLS: all access goes through the Worker using the service_role key.
alter table public.users enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.subscriptions enable row level security;

-- Private bucket for resumes.
insert into storage.buckets (id, name, public)
values ('cvs','cvs', false)
on conflict (id) do nothing;
