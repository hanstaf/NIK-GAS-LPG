insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'nik-gas-lpg-profile-photos',
    'nik-gas-lpg-profile-photos',
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.user_profile_photos (
    user_id uuid primary key references auth.users (id) on delete cascade,
    avatar_version bigint not null check (avatar_version > 0),
    created_at timestamptz not null default now()
);

alter table public.user_profile_photos enable row level security;

revoke all on public.user_profile_photos from public, anon, authenticated;
grant select, insert, update on public.user_profile_photos to authenticated;

drop policy if exists "users access own profile photo metadata"
    on public.user_profile_photos;
create policy "users access own profile photo metadata"
    on public.user_profile_photos
    for all
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

drop policy if exists "users read own profile photos" on storage.objects;
create policy "users read own profile photos"
    on storage.objects
    for select
    to authenticated
    using (
        bucket_id = 'nik-gas-lpg-profile-photos'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );

drop policy if exists "users upload own profile photos" on storage.objects;
create policy "users upload own profile photos"
    on storage.objects
    for insert
    to authenticated
    with check (
        bucket_id = 'nik-gas-lpg-profile-photos'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );

drop policy if exists "users update own profile photos" on storage.objects;
create policy "users update own profile photos"
    on storage.objects
    for update
    to authenticated
    using (
        bucket_id = 'nik-gas-lpg-profile-photos'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    )
    with check (
        bucket_id = 'nik-gas-lpg-profile-photos'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );

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
          and tablename = 'user_profile_photos'
    ) then
        execute 'alter publication supabase_realtime add table public.user_profile_photos';
    end if;
end
$$;
