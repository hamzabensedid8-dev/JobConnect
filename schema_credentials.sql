-- ===========================================================================
-- JobConnect v5 — identifiants de paiement chiffrés (changement de compte
-- encaisseur depuis la console admin, sans redéploiement)
-- ===========================================================================

create extension if not exists pgcrypto;

create table if not exists public.integration_credentials (
  key text primary key,
  value_enc bytea not null,
  hint text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

alter table public.integration_credentials enable row level security;

-- Écrit un identifiant chiffré. La clé de chiffrement (passphrase) n'est
-- jamais stockée en base : elle vient d'un secret du Worker.
create or replace function public.jc_set_credential(
  p_key text, p_value text, p_passphrase text, p_hint text default null, p_actor uuid default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_passphrase is null or length(p_passphrase) < 16 then
    raise exception 'passphrase too short';
  end if;
  insert into public.integration_credentials (key, value_enc, hint, updated_at, updated_by)
  values (p_key, pgp_sym_encrypt(p_value, p_passphrase), p_hint, now(), p_actor)
  on conflict (key) do update
    set value_enc = excluded.value_enc,
        hint = excluded.hint,
        updated_at = now(),
        updated_by = excluded.updated_by;
end $$;

-- Lit un identifiant déchiffré. Renvoie null si le secret est absent.
create or replace function public.jc_get_credential(p_key text, p_passphrase text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v text;
begin
  select pgp_sym_decrypt(value_enc, p_passphrase) into v
  from public.integration_credentials where key = p_key;
  return v;
exception when others then
  return null;
end $$;

create or replace function public.jc_delete_credential(p_key text)
returns void
language sql security definer set search_path = public as $$
  delete from public.integration_credentials where key = p_key;
$$;

do $$
declare f text;
begin
  foreach f in array array['jc_set_credential(text,text,text,text,uuid)', 'jc_get_credential(text,text)', 'jc_delete_credential(text)']
  loop
    begin execute format('revoke execute on function public.%s from public', f); exception when others then null; end;
    begin execute format('revoke execute on function public.%s from anon', f); exception when others then null; end;
    begin execute format('revoke execute on function public.%s from authenticated', f); exception when others then null; end;
    begin execute format('grant execute on function public.%s to service_role', f); exception when others then null; end;
  end loop;
end $$;

-- Un seul compte encaisseur actif, choisi par l'admin (journal de traçabilité).
create table if not exists public.payout_accounts (
  id bigserial primary key,
  label text not null,
  provider text not null default 'stripe',
  account_id text,
  country text,
  currency text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payout_accounts enable row level security;

create unique index if not exists uq_active_payout
  on public.payout_accounts (provider) where is_active;
