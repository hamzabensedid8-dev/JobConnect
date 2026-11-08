-- ===========================================================================
-- JobConnect v3 — contrats (générateur PDF depuis la console admin)
-- ===========================================================================

create table if not exists public.contracts (
  id bigserial primary key,
  contract_number text not null unique,
  application_id bigint references public.applications(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,

  -- parties
  employer_name text,
  employer_address text,
  employer_contact text,
  employee_name text,
  employee_address text,
  employee_passport text,
  employee_nationality text,
  employee_contact text,
  employee_birth_date date,

  -- poste
  position text,
  contract_type text,
  country text,
  city text,
  duration_months integer,
  start_date date,
  end_date date,
  weekly_hours integer,
  trial_period text,

  -- rémunération
  salary text,
  salary_period text,
  benefits text,
  housing text,
  transport text,

  -- honoraires
  is_free boolean not null default false,
  fee_cents integer not null default 0,
  recruiter_price_cents integer not null default 0,
  total_cents integer not null default 0,
  currency text not null default 'USD',
  payment_reference text,

  -- clauses
  additional_clauses text,
  signing_place text,
  signing_date date,

  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contracts enable row level security;
create index if not exists contracts_application_idx on public.contracts (application_id);
create index if not exists contracts_created_idx on public.contracts (created_at desc);

-- Numérotation : JC-CT-<année>-<6 caractères>
create or replace function public.jc_next_contract_number()
returns text language sql as $$
  select 'JC-CT-' || to_char(now(), 'YYYY') || '-' ||
         upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
$$;

-- Le suivi public d'une demande peut être rattaché à un contrat.
alter table public.applications
  add column if not exists contract_number text;
