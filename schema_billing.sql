-- ===========================================================================
-- JobConnect v4 — abonnements recruteur, prix par contrat, paiements, SLA
-- ===========================================================================

-- 1. Réglages plateforme (modifiables par l'admin)
create table if not exists public.settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
insert into public.settings (key, value) values
  ('jobconnect_fee_cents', '4900'),
  ('sla_target_min_minutes', '5'),
  ('sla_target_max_minutes', '20'),
  ('default_recruiter_price_cents', '15000'),
  ('currency', 'USD'),
  ('promo_price_cents', '4900'),
  ('recruiter_price_cents', '9500')
on conflict (key) do nothing;

-- 2. Statuts simplifies : pending / accepted / rejected (+ motif obligatoire)
alter table public.applications drop constraint if exists applications_status_check;
update public.applications set status = 'accepted' where status in ('approved','shortlisted','completed');
update public.applications set status = 'pending'  where status in ('received','under_review');
alter table public.applications add constraint applications_status_check
  check (status in ('pending','accepted','rejected'));

alter table public.applications add column if not exists decision_reason text;
alter table public.applications add column if not exists decided_at timestamptz;
alter table public.applications add column if not exists decided_by uuid references public.users(id) on delete set null;
alter table public.applications add column if not exists response_due_at timestamptz;
alter table public.applications add column if not exists first_response_at timestamptz;
alter table public.applications add column if not exists total_cents integer;
alter table public.applications add column if not exists fee_cents integer;
alter table public.applications add column if not exists recruiter_price_cents integer;
alter table public.applications add column if not exists currency text default 'USD';
alter table public.applications add column if not exists paid_at timestamptz;

-- Motif obligatoire quand la demande est rejetee
alter table public.applications drop constraint if exists applications_reason_required;
alter table public.applications add constraint applications_reason_required
  check (status <> 'rejected' or (decision_reason is not null and length(btrim(decision_reason)) >= 5));

-- 3. Prix configurables sur les contrats / offres
alter table public.jobs add column if not exists recruiter_price_cents integer not null default 15000;
alter table public.jobs add column if not exists currency text not null default 'USD';
alter table public.jobs add column if not exists visa_sponsorship boolean not null default false;
alter table public.jobs add column if not exists duration_months integer;
alter table public.jobs add column if not exists positions integer not null default 1;

-- 4. Abonnements recruteur : 95 USD/mois ou formule promotionnelle
alter table public.subscriptions drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions add constraint subscriptions_plan_check
  check (plan in ('recruiter_pro','recruiter_promo','candidate_premium'));
alter table public.subscriptions add column if not exists current_period_end timestamptz;
alter table public.subscriptions add column if not exists cancelled_at timestamptz;
alter table public.subscriptions add column if not exists stripe_customer_id text;
alter table public.subscriptions add column if not exists stripe_subscription_id text;
alter table public.subscriptions add column if not exists stripe_session_id text;

create unique index if not exists uq_active_recruiter_sub
  on public.subscriptions (user_id) where status = 'active';

-- 5. Paiements candidats (frais JobConnect + prix recruteur)
create table if not exists public.payments (
  id bigserial primary key,
  reference text not null unique,
  application_id bigint references public.applications(id) on delete cascade,
  payer_id uuid references public.users(id) on delete set null,
  kind text not null default 'application' check (kind in ('application','subscription')),
  fee_cents integer not null default 0,
  recruiter_price_cents integer not null default 0,
  total_cents integer not null,
  currency text not null default 'USD',
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  provider text default 'stripe',
  provider_session_id text,
  provider_payment_intent text,
  paid_at timestamptz,
  receipt_number text,
  receipt_url text,
  created_at timestamptz not null default now()
);
create index if not exists idx_payments_app on public.payments(application_id);
create index if not exists idx_payments_payer on public.payments(payer_id);
create unique index if not exists uq_payment_session on public.payments(provider_session_id);

-- 6. Journal des e-mails : jamais de faux "envoye"
create table if not exists public.email_log (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete set null,
  to_email text not null,
  template text not null,
  subject text not null,
  provider text,
  provider_message_id text,
  status text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_email_log_created on public.email_log(created_at desc);

-- 7. Journal d'audit admin
create table if not exists public.audit_log (
  id bigserial primary key,
  actor_id uuid references public.users(id) on delete set null,
  action text not null,
  target text,
  detail jsonb,
  created_at timestamptz not null default now()
);

alter table public.settings enable row level security;
alter table public.payments enable row level security;
alter table public.email_log enable row level security;
alter table public.audit_log enable row level security;

-- 8. Delai de reponse par defaut sur les demandes existantes
update public.applications set response_due_at = created_at + interval '20 minutes' where response_due_at is null;
