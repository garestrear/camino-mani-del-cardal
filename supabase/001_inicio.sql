begin;
create table public.coordinadores (
  usuario uuid primary key references auth.users(id) on delete cascade
);
create table public.tramos (
  id bigint generated always as identity primary key,
  nombre text not null check (length(trim(nombre)) between 1 and 120),
  metros integer not null check (metros between 1 and 100000),
  estado text not null check (estado in ('pendiente','en-obra','pavimentado')),
  detalle text not null default '' check (length(detalle) <= 2000)
);
create table public.aportes (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('cemento','dinero','trabajo')),
  cantidad integer not null check (cantidad > 0),
  fecha date not null,
  detalle text not null default '' check (length(detalle) <= 2000)
);
create table public.necesidades (
  id bigint generated always as identity primary key,
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  detalle text not null default '' check (length(detalle) <= 2000),
  activa boolean not null default true
);
create table public.historias (
  id bigint generated always as identity primary key,
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  detalle text not null check (length(trim(detalle)) between 1 and 2000),
  publicada boolean not null default false
);
alter table public.coordinadores enable row level security;
revoke all on public.coordinadores from public, anon, authenticated;
grant select on public.coordinadores to authenticated;
create policy propio on public.coordinadores for select to authenticated using (usuario = (select auth.uid()));
do $$
declare tabla text;
begin
  foreach tabla in array array['tramos','aportes','necesidades','historias'] loop
    execute format('alter table public.%I enable row level security', tabla);
    execute format('revoke all on public.%I from public, anon, authenticated', tabla);
    execute format('grant select, insert, update on public.%I to authenticated', tabla);
    execute format('create policy gestion on public.%I for all to authenticated using (exists (select 1 from public.coordinadores where usuario = (select auth.uid()))) with check (exists (select 1 from public.coordinadores where usuario = (select auth.uid())))', tabla);
  end loop;
end $$;
grant select on public.tramos, public.necesidades, public.historias to anon;
create policy lectura on public.tramos for select to anon, authenticated using (true);
create policy lectura on public.necesidades for select to anon, authenticated using (activa);
create policy lectura on public.historias for select to anon, authenticated using (publicada);
create function public.totales_aportes()
returns table(tipo text, total bigint)
language sql stable security definer set search_path = ''
as $$ select a.tipo, sum(a.cantidad) from public.aportes a group by a.tipo $$;
revoke all on function public.totales_aportes() from public;
grant execute on function public.totales_aportes() to anon, authenticated;
commit;
