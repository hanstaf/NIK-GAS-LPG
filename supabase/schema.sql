create table public.nik_records (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    nik text not null check (nik ~ '^[0-9]{16}$'),
    tempat_lahir text not null default '',
    tanggal_lahir date,
    list_name text not null default 'main'
        check (list_name in ('main', 'draft1', 'draft2')),
    sort_order integer not null default 0 check (sort_order >= 0),
    color text not null default ''
        check (color in ('', '#ef4444', '#f59e0b', '#10b981')),
    created_at timestamptz not null default now(),
    constraint nik_records_owner_nik_unique unique (owner_id, nik)
);

create index nik_records_owner_list_order_idx
    on public.nik_records (owner_id, list_name, sort_order);

create table public.sales_notes (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    awal integer not null check (awal > 0),
    akhir integer not null check (akhir > 0),
    tanggal date not null default current_date,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    constraint sales_notes_sort_order_nonnegative check (sort_order >= 0)
);

create index sales_notes_owner_date_idx
    on public.sales_notes (owner_id, tanggal);
create index sales_notes_owner_order_idx
    on public.sales_notes (owner_id, sort_order);

alter table public.nik_records enable row level security;
alter table public.sales_notes enable row level security;

revoke all on public.nik_records from public, anon, authenticated;
revoke all on public.sales_notes from public, anon, authenticated;
grant select, insert, update, delete on public.nik_records to authenticated;
grant select, insert, update, delete on public.sales_notes to authenticated;

create policy "owner manages own NIK records"
    on public.nik_records
    for all
    to authenticated
    using ((select auth.uid()) = owner_id)
    with check ((select auth.uid()) = owner_id);

create policy "owner manages own sales notes"
    on public.sales_notes
    for all
    to authenticated
    using ((select auth.uid()) = owner_id)
    with check ((select auth.uid()) = owner_id);
