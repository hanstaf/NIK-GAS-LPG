do $$
begin
    if not exists (
        select 1
        from pg_publication
        where pubname = 'supabase_realtime'
    ) then
        raise exception 'Supabase Realtime publication was not found.';
    end if;

    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'nik_records'
    ) then
        execute 'alter publication supabase_realtime add table public.nik_records';
    end if;

    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'sales_notes'
    ) then
        execute 'alter publication supabase_realtime add table public.sales_notes';
    end if;
end
$$;
