-- =====================================================================
-- School Accounts — database setup for Supabase
-- Run this ONCE in a new Supabase project:
--   Supabase dashboard → SQL Editor → New query → paste all → Run
--
-- Audit controls built in:
--   * Every receipt/voucher gets a gap-free number per financial year
--     (R/2026-27/0001 for money in, V/... for money out, T/... for transfers)
--   * Nothing can be deleted. Mistakes are rejected or voided with a reason.
--   * Two-person rule: the person who enters an entry cannot approve it.
--   * Every insert/change is written to audit_log automatically.
--   * Only logged-in, activated staff can read anything.
-- =====================================================================

-- ---------- Staff profiles & roles ----------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'viewer' check (role in ('admin','accountant','viewer')),
  active      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- New login users get a profile automatically (inactive until an admin activates them)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role of the person calling (null if not logged in or not activated)
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- Indian financial year (April–March), e.g. 2026-11-11 -> '2026-27'
create or replace function public.fy_of(d date) returns text
language sql immutable as $$
  select case when extract(month from d) >= 4
    then extract(year from d)::int::text || '-' || lpad(((extract(year from d)::int + 1) % 100)::text, 2, '0')
    else (extract(year from d)::int - 1)::text || '-' || lpad((extract(year from d)::int % 100)::text, 2, '0')
  end
$$;

-- ---------- Master lists ---------------------------------------------
create table public.funds (
  id      bigint generated always as identity primary key,
  name    text not null unique,
  active  boolean not null default true
);

create table public.categories (
  id      bigint generated always as identity primary key,
  name    text not null,
  kind    text not null check (kind in ('income','expense')),
  active  boolean not null default true,
  unique (name, kind)
);

create table public.accounts (
  id               bigint generated always as identity primary key,
  name             text not null unique,
  type             text not null default 'bank' check (type in ('bank','cash','upi','other')),
  opening_balance  numeric(14,2) not null default 0,
  active           boolean not null default true
);

create table public.budgets (
  id           bigint generated always as identity primary key,
  fy           text not null,
  category_id  bigint not null references public.categories(id),
  amount       numeric(14,2) not null default 0 check (amount >= 0),
  unique (fy, category_id)
);

-- ---------- Transactions (the ledger) --------------------------------
create table public.counters (
  prefix  text not null,
  fy      text not null,
  last    int  not null,
  primary key (prefix, fy)
);

create table public.transactions (
  id             bigint generated always as identity primary key,
  number         text unique,
  kind           text not null check (kind in ('income','expense','transfer')),
  txn_date       date not null,
  amount         numeric(14,2) not null check (amount > 0),
  account_id     bigint not null references public.accounts(id),
  to_account_id  bigint references public.accounts(id),
  category_id    bigint references public.categories(id),
  fund_id        bigint references public.funds(id),
  party          text,
  mode           text not null default 'cash'
                 check (mode in ('cash','upi','bank_transfer','cheque','card','other')),
  reference      text,
  description    text,
  bill_path      text,
  status         text not null default 'pending'
                 check (status in ('pending','approved','rejected','void')),
  status_note    text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  reviewed_by    uuid references public.profiles(id),
  reviewed_at    timestamptz,
  voided_by      uuid references public.profiles(id),
  voided_at      timestamptz,
  constraint transfer_shape check (
    (kind = 'transfer' and to_account_id is not null and to_account_id <> account_id and category_id is null)
    or (kind <> 'transfer' and to_account_id is null and category_id is not null)
  )
);
create index transactions_date_idx   on public.transactions (txn_date);
create index transactions_status_idx on public.transactions (status);

-- Assign gap-free number, force pending status, stamp who entered it
create or replace function public.before_txn_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p text; f text; n int; ck text;
begin
  if new.kind <> 'transfer' then
    select kind into ck from categories where id = new.category_id;
    if ck is distinct from new.kind then
      raise exception 'Category does not match the entry type';
    end if;
  end if;
  if new.txn_date > current_date + 1 then
    raise exception 'Date cannot be in the future';
  end if;

  p := case new.kind when 'income' then 'R' when 'expense' then 'V' else 'T' end;
  f := fy_of(new.txn_date);
  insert into counters (prefix, fy, last) values (p, f, 1)
    on conflict (prefix, fy) do update set last = counters.last + 1
    returning last into n;

  new.number      := p || '/' || f || '/' || lpad(n::text, 4, '0');
  new.created_by  := coalesce(auth.uid(), new.created_by);
  new.created_at  := now();
  new.status      := 'pending';
  new.status_note := null;
  new.reviewed_by := null; new.reviewed_at := null;
  new.voided_by   := null; new.voided_at   := null;
  return new;
end $$;

create trigger txn_before_insert
  before insert on public.transactions
  for each row execute function public.before_txn_insert();

-- Approve / reject / void — the ONLY way an entry can change
create or replace function public.set_txn_status(p_id bigint, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  t transactions;
begin
  if my_role() is distinct from 'admin' then
    raise exception 'Only an admin can approve, reject or void entries';
  end if;
  select * into t from transactions where id = p_id for update;
  if not found then raise exception 'Entry not found'; end if;

  if p_status in ('approved','rejected') then
    if t.status <> 'pending' then
      raise exception 'Only pending entries can be approved or rejected';
    end if;
    if t.created_by = auth.uid() then
      raise exception 'Two-person rule: you cannot approve or reject an entry you entered yourself';
    end if;
    if p_status = 'rejected' and coalesce(trim(p_note), '') = '' then
      raise exception 'Please give a reason for rejecting';
    end if;
    update transactions
       set status = p_status, status_note = nullif(trim(p_note), ''),
           reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_id;
  elsif p_status = 'void' then
    if t.status <> 'approved' then
      raise exception 'Only approved entries can be voided';
    end if;
    if coalesce(trim(p_note), '') = '' then
      raise exception 'Please give a reason for voiding';
    end if;
    update transactions
       set status = 'void', status_note = trim(p_note),
           voided_by = auth.uid(), voided_at = now()
     where id = p_id;
  else
    raise exception 'Unknown status %', p_status;
  end if;
end $$;

-- ---------- Balances & bank reconciliation ---------------------------
create or replace function public.account_balance(p_account bigint, p_as_of date)
returns numeric language sql stable security invoker set search_path = public as $$
  select a.opening_balance + coalesce((
    select sum(case
      when t.kind = 'income'   and t.account_id    = a.id then  t.amount
      when t.kind = 'expense'  and t.account_id    = a.id then -t.amount
      when t.kind = 'transfer' and t.account_id    = a.id then -t.amount
      when t.kind = 'transfer' and t.to_account_id = a.id then  t.amount
      else 0 end)
    from transactions t
    where t.status = 'approved' and t.txn_date <= p_as_of
      and (t.account_id = a.id or t.to_account_id = a.id)), 0)
  from accounts a where a.id = p_account
$$;

create view public.account_balances with (security_invoker = true) as
  select a.id, a.name, a.type, a.active,
         public.account_balance(a.id, current_date) as balance
  from public.accounts a;

create table public.reconciliations (
  id                 bigint generated always as identity primary key,
  account_id         bigint not null references public.accounts(id),
  as_of              date not null,
  statement_balance  numeric(14,2) not null,
  app_balance        numeric(14,2),
  note               text,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now()
);

create or replace function public.before_recon_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.app_balance := account_balance(new.account_id, new.as_of);
  new.created_by  := coalesce(auth.uid(), new.created_by);
  new.created_at  := now();
  return new;
end $$;

create trigger recon_before_insert
  before insert on public.reconciliations
  for each row execute function public.before_recon_insert();

-- ---------- Starting data (edit later in the app's Settings) ---------
insert into public.funds (name) values
  ('General Fund'), ('Building Fund'), ('Government Grant'), ('Donations');

insert into public.categories (name, kind) values
  ('Tuition Fees','income'), ('Admission Fees','income'), ('Exam Fees','income'),
  ('Transport Fees','income'), ('Donations Received','income'), ('Government Grants','income'),
  ('Bank Interest','income'), ('Other Income','income'),
  ('Staff Salaries','expense'), ('Rent','expense'), ('Electricity & Water','expense'),
  ('Internet & Phone','expense'), ('Teaching Materials','expense'), ('Stationery & Printing','expense'),
  ('Maintenance & Repairs','expense'), ('Transport & Fuel','expense'), ('Events & Functions','expense'),
  ('Exam Expenses','expense'), ('Furniture & Equipment','expense'), ('Bank Charges','expense'),
  ('Miscellaneous','expense');

insert into public.accounts (name, type) values
  ('Main Bank Account','bank'), ('Petty Cash','cash');

-- ---------- Audit log (who changed what, when) -----------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     uuid,
  user_email  text,
  table_name  text not null,
  row_id      text,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb
);

create or replace function public.write_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit_log (user_id, user_email, table_name, row_id, action, old_data, new_data)
  values (auth.uid(), (select email from profiles where id = auth.uid()),
          tg_table_name, r->>'id', tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

create trigger audit_transactions    after insert or update or delete on public.transactions    for each row execute function public.write_audit();
create trigger audit_profiles        after insert or update or delete on public.profiles        for each row execute function public.write_audit();
create trigger audit_categories      after insert or update or delete on public.categories      for each row execute function public.write_audit();
create trigger audit_funds           after insert or update or delete on public.funds           for each row execute function public.write_audit();
create trigger audit_accounts        after insert or update or delete on public.accounts        for each row execute function public.write_audit();
create trigger audit_budgets         after insert or update or delete on public.budgets         for each row execute function public.write_audit();
create trigger audit_reconciliations after insert or update or delete on public.reconciliations for each row execute function public.write_audit();

-- ---------- Security: who can see / do what -------------------------
alter table public.profiles        enable row level security;
alter table public.funds           enable row level security;
alter table public.categories      enable row level security;
alter table public.accounts        enable row level security;
alter table public.budgets         enable row level security;
alter table public.counters        enable row level security;
alter table public.transactions    enable row level security;
alter table public.reconciliations enable row level security;
alter table public.audit_log       enable row level security;

-- Profiles: staff see each other's names; you always see your own; only admin edits
create policy profiles_read   on public.profiles for select to authenticated
  using (public.my_role() is not null or id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- Master lists: all staff read; only admin adds/edits
create policy funds_read    on public.funds for select to authenticated using (public.my_role() is not null);
create policy funds_insert  on public.funds for insert to authenticated with check (public.my_role() = 'admin');
create policy funds_update  on public.funds for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy cats_read     on public.categories for select to authenticated using (public.my_role() is not null);
create policy cats_insert   on public.categories for insert to authenticated with check (public.my_role() = 'admin');
create policy cats_update   on public.categories for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy accts_read    on public.accounts for select to authenticated using (public.my_role() is not null);
create policy accts_insert  on public.accounts for insert to authenticated with check (public.my_role() = 'admin');
create policy accts_update  on public.accounts for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy budgets_read   on public.budgets for select to authenticated using (public.my_role() is not null);
create policy budgets_insert on public.budgets for insert to authenticated with check (public.my_role() = 'admin');
create policy budgets_update on public.budgets for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- Transactions: all staff read; admin & accountant add; changes only via set_txn_status(); no deletes
create policy txn_read   on public.transactions for select to authenticated using (public.my_role() is not null);
create policy txn_insert on public.transactions for insert to authenticated
  with check (public.my_role() in ('admin','accountant'));

-- Reconciliations: all staff read; admin & accountant add
create policy recon_read   on public.reconciliations for select to authenticated using (public.my_role() is not null);
create policy recon_insert on public.reconciliations for insert to authenticated
  with check (public.my_role() in ('admin','accountant'));

-- Audit log: admin and viewer (trustee) can read; nobody can write directly
create policy audit_read on public.audit_log for select to authenticated
  using (public.my_role() in ('admin','viewer'));

revoke truncate on all tables in schema public from anon, authenticated;

-- ---------- Bill / receipt photos (private storage) ------------------
insert into storage.buckets (id, name, public) values ('bills', 'bills', false)
  on conflict (id) do nothing;

create policy bills_read on storage.objects for select to authenticated
  using (bucket_id = 'bills' and public.my_role() is not null);
create policy bills_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'bills' and public.my_role() in ('admin','accountant'));

-- =====================================================================
-- AFTER you create your own login (see README step 2), make yourself admin:
--   update public.profiles set role = 'admin', active = true
--   where email = 'your-email@example.com';
-- =====================================================================
