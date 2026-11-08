-- JobConnect v3 — messagerie (voir aussi schema.sql pour le socle)

create table if not exists public.conversations (
  id bigserial primary key,
  kind text not null check (kind in ('admin_candidate','admin_recruiter','recruiter_candidate')),
  candidate_id uuid references public.users(id) on delete cascade,
  recruiter_id uuid references public.users(id) on delete cascade,
  job_id bigint references public.jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint conv_participant_present check (
    (kind='admin_candidate' and candidate_id is not null) or
    (kind='admin_recruiter' and recruiter_id is not null) or
    (kind='recruiter_candidate' and candidate_id is not null and recruiter_id is not null)
  )
);

create unique index if not exists uq_conv_admin on public.conversations (candidate_id) where kind='admin_candidate';
create unique index if not exists uq_conv_admin_recruiter on public.conversations (recruiter_id) where kind='admin_recruiter';
create unique index if not exists uq_conv_recruiter on public.conversations (candidate_id, recruiter_id) where kind='recruiter_candidate';
create index if not exists idx_conv_candidate on public.conversations(candidate_id);
create index if not exists idx_conv_recruiter on public.conversations(recruiter_id);

create table if not exists public.messages (
  id bigserial primary key,
  conversation_id bigint not null references public.conversations(id) on delete cascade,
  sender_id uuid references public.users(id) on delete set null,
  sender_role text not null check (sender_role in ('candidate','recruiter','admin')),
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.users(id) on delete set null,
  read_at timestamptz
);
create index if not exists idx_msg_conv on public.messages(conversation_id, id);

create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  conversation_id bigint references public.conversations(id) on delete cascade,
  application_ref text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notif_user on public.notifications(user_id, created_at desc);

create table if not exists public.devices (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  platform text not null default 'android',
  label text,
  last_seen_at timestamptz not null default now(),
  unique (user_id, label)
);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.devices enable row level security;

alter table public.applications add column if not exists category text;
