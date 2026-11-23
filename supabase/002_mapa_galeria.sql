begin;

alter table public.tramos add column desde_metro numeric(10,2)
  check (desde_metro is null or desde_metro between 0 and 100000);

create table public.trazado (
  id integer primary key check (id = 1),
  puntos jsonb not null check (
    jsonb_typeof(puntos) = 'array' and jsonb_array_length(puntos) between 2 and 15000
  )
);
alter table public.trazado enable row level security;
revoke all on public.trazado from public, anon, authenticated;
grant select on public.trazado to anon, authenticated;
grant insert, update on public.trazado to authenticated;
create policy trazado_lectura on public.trazado for select to anon, authenticated using (true);
create policy trazado_gestion on public.trazado for all to authenticated
  using (exists (select 1 from public.coordinadores where usuario = (select auth.uid())))
  with check (exists (select 1 from public.coordinadores where usuario = (select auth.uid())));

create table public.evidencias (
  id uuid primary key,
  tramo_id bigint references public.tramos(id),
  tipo text not null check (tipo in ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm')),
  etapa text not null check (etapa in ('Antes','Durante','Después')),
  descripcion text not null default '' check (length(descripcion) <= 280),
  estado text not null default 'pendiente' check (estado in ('pendiente','publicada','rechazada')),
  creada timestamptz not null default now()
);
alter table public.evidencias enable row level security;
revoke all on public.evidencias from public, anon, authenticated;
grant select on public.evidencias to anon, authenticated;
grant insert (id,tramo_id,tipo,etapa,descripcion) on public.evidencias to anon, authenticated;
grant update (estado) on public.evidencias to authenticated;
create policy evidencias_lectura on public.evidencias for select to anon, authenticated
  using (estado = 'publicada');
create policy evidencias_revision on public.evidencias for select to authenticated
  using (exists (select 1 from public.coordinadores where usuario = (select auth.uid())));
create policy evidencias_revisar on public.evidencias for update to authenticated
  using (exists (select 1 from public.coordinadores where usuario = (select auth.uid())))
  with check (exists (select 1 from public.coordinadores where usuario = (select auth.uid())));
create policy evidencias_envio on public.evidencias for insert to anon, authenticated
  with check (estado = 'pendiente');

-- Limita en conjunto los envíos para evitar el crecimiento ilimitado del almacenamiento.
create index evidencias_recientes on public.evidencias (creada);
create function public.limitar_evidencias() returns trigger language plpgsql
security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(345302671);
  if (select count(*) from public.evidencias where creada > now() - interval '1 hour') >= 25
     or (select count(*) from public.evidencias where creada > now() - interval '1 day') >= 75 then
    raise exception 'Se alcanzó el límite temporal de aportes';
  end if;
  return new;
end;
$$;
revoke all on function public.limitar_evidencias() from public;
create trigger limitar_evidencias before insert on public.evidencias
for each row execute function public.limitar_evidencias();

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('camino-evidencias','camino-evidencias',false,10485760,
array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm']);

create function public.puede_cargar_evidencia(ruta text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.evidencias e where e.id::text = ruta
    and e.estado = 'pendiente' and e.creada > now() - interval '20 minutes'
  )
$$;
revoke all on function public.puede_cargar_evidencia(text) from public;
grant execute on function public.puede_cargar_evidencia(text) to anon, authenticated;
create policy camino_carga on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'camino-evidencias' and public.puede_cargar_evidencia(name));
create policy camino_visualizacion on storage.objects for select to anon, authenticated
  using (bucket_id = 'camino-evidencias' and exists (
    select 1 from public.evidencias e where e.id::text = name
  ));

commit;
