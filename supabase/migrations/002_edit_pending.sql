-- =====================================================================
-- 002 — Let the person who entered a receipt/voucher edit it
--        while it is still waiting for approval.
-- Run once in Supabase → SQL Editor (safe to run again).
--
-- Rules enforced by the database:
--   * Only the person who entered it can edit it (admins reject instead,
--     so the approver never approves their own wording).
--   * Only while status = 'pending'. After approval/rejection: locked.
--   * Type and number never change; the date must stay in the same
--     financial year (the number belongs to that year).
--   * Every edit is written to audit_log automatically (old → new).
-- =====================================================================
create or replace function public.edit_pending_txn(
  p_id            bigint,
  p_txn_date      date,
  p_amount        numeric,
  p_account_id    bigint,
  p_to_account_id bigint,
  p_category_id   bigint,
  p_fund_id       bigint,
  p_party         text,
  p_mode          text,
  p_reference     text,
  p_description   text,
  p_bill_path     text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  t  transactions;
  ck text;
begin
  if coalesce(my_role(), '') not in ('admin', 'accountant') then
    raise exception 'You do not have permission to edit entries';
  end if;
  select * into t from transactions where id = p_id for update;
  if not found then raise exception 'Entry not found'; end if;
  if t.created_by is distinct from auth.uid() then
    raise exception 'Only the person who entered this can edit it. An admin can reject it instead.';
  end if;
  if t.status <> 'pending' then
    raise exception 'Only entries waiting for approval can be edited';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;
  if p_txn_date is null or p_txn_date > current_date + 1 then
    raise exception 'Date cannot be in the future';
  end if;
  if fy_of(p_txn_date) <> fy_of(t.txn_date) then
    raise exception 'The date must stay in FY % — ask the admin to reject it and enter it again', fy_of(t.txn_date);
  end if;

  if t.kind = 'transfer' then
    if p_to_account_id is null or p_to_account_id = p_account_id then
      raise exception 'From and To accounts must be different';
    end if;
    p_category_id := null;
    p_fund_id := null;
  else
    select kind into ck from categories where id = p_category_id;
    if ck is distinct from t.kind then
      raise exception 'Category does not match the entry type';
    end if;
    p_to_account_id := null;
  end if;

  update transactions set
    txn_date      = p_txn_date,
    amount        = p_amount,
    account_id    = p_account_id,
    to_account_id = p_to_account_id,
    category_id   = p_category_id,
    fund_id       = p_fund_id,
    party         = nullif(trim(p_party), ''),
    mode          = p_mode,
    reference     = nullif(trim(p_reference), ''),
    description   = nullif(trim(p_description), ''),
    bill_path     = coalesce(p_bill_path, bill_path)
  where id = p_id;
end $$;

revoke execute on function public.edit_pending_txn(bigint, date, numeric, bigint, bigint, bigint, bigint, text, text, text, text, text) from anon;
grant  execute on function public.edit_pending_txn(bigint, date, numeric, bigint, bigint, bigint, bigint, text, text, text, text, text) to authenticated;
