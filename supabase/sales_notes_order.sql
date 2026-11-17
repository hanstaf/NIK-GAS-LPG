alter table public.sales_notes
    add column if not exists sort_order integer;

with ranked_notes as (
    select id,
           (row_number() over (partition by owner_id order by created_at, id) - 1)::integer as position
    from public.sales_notes
)
update public.sales_notes as notes
set sort_order = ranked_notes.position
from ranked_notes
where notes.id = ranked_notes.id
  and notes.sort_order is null;

alter table public.sales_notes
    alter column sort_order set default 0,
    alter column sort_order set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.sales_notes'::regclass
          and conname = 'sales_notes_sort_order_nonnegative'
    ) then
        alter table public.sales_notes
            add constraint sales_notes_sort_order_nonnegative check (sort_order >= 0);
    end if;
end
$$;

create index if not exists sales_notes_owner_order_idx
    on public.sales_notes (owner_id, sort_order);
