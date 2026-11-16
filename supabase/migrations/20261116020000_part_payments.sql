-- Part payments: the admin can record how much someone has paid so far.
-- amount_paid is null for a full payment (or nothing yet); a number below the share means part paid.
alter table public.payments add column if not exists amount_paid numeric(10,2);
