-- ═══════════════════════════════════════════════════════════════════════
--  0125 — Un aviso de equipo se lee por persona
--
--  ── El hallazgo ───────────────────────────────────────────────────────
--
--  `public.notifications` (0016) guarda la lectura en la propia fila:
--  una sola columna `read_at`. Para un aviso personal eso basta -hay un
--  solo lector-. Para uno de equipo (`user_id` nulo) no: el primero que
--  lo marca como leido se lo apaga a todos, y deja de contar en la
--  campana de sus companeros. Y TODO lo que llega hoy es de equipo: el
--  despachador del bus, las automatizaciones y REGB Control escriben con
--  `user_id` nulo. El cajero que abre la bandeja a las 8 le borra al
--  gerente el "falto efectivo en el cierre" sin que el gerente lo vea.
--
--  ── La decision ───────────────────────────────────────────────────────
--
--  Una tabla de lecturas: (aviso, persona) -> cuando. Para TODOS los
--  avisos, personales incluidos, y `read_at` desaparece de la fila.
--
--  Se pudo dejar `read_at` para los personales y la tabla solo para los
--  de equipo. Son dos maneras de responder "¿lo lei?" y cada consulta
--  tendria que acordarse de las dos; el dia que alguien escriba `set
--  read_at` sobre uno de equipo el error vuelve sin hacer ruido. Quitando
--  la columna, ese codigo falla al compilar la consulta en vez de
--  apagarle la campana a todo el equipo.
--
--  ── Lo que ya estaba leido ────────────────────────────────────────────
--
--  Un personal leido pasa tal cual: su lector es su destinatario.
--
--  Un aviso de equipo con `read_at` no dice QUIEN lo leyo: el modelo viejo
--  no lo guardaba. Se da por leido para todos los miembros del cliente,
--  que es exactamente lo que cada uno veia ayer. La alternativa -dejarlo
--  sin leer para todos- le revive a cada usuario avisos de hace semanas el
--  dia del despliegue, y una campana con 40 avisos viejos es una campana
--  que se deja de mirar.
--
--  ── De paso: la privacidad de los personales ─────────────────────────
--
--  La politica de 0016 filtraba por tenant y modulo, no por destinatario:
--  por PostgREST cualquiera del equipo leia los avisos personales de un
--  companero. Con lecturas por persona eso ya no tiene sentido -podrias
--  ver lo que otro no ha leido-, asi que la politica mira tambien el
--  `user_id`. Escribir un aviso PARA otro sigue permitido: es para eso.
--
--  ── El evento declarado ───────────────────────────────────────────────
--
--  El manifiesto declara `notifications.notice.sent` y nadie lo emitia.
--  Se emite desde la base, al insertar: los tres productores escriben en
--  la tabla directamente -dos de ellos sin sesion de usuario-, y un
--  trigger es el unico punto por donde pasan todos.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. La tabla de lecturas ──────────────────────────────────────────
--  La clave foranea es COMPUESTA (tenant, aviso): es la guarda de tenant
--  cruzada, y es declarativa. Una lectura no puede apuntar al aviso de
--  otro cliente aunque alguien adivine el id, porque la fila referida
--  tiene que tener el MISMO tenant_id. Para eso hace falta la unicidad
--  (tenant_id, id) en notifications.
alter table public.notifications
  add constraint notifications_tenant_id_id_key unique (tenant_id, id);

create table public.notification_reads (
  tenant_id       uuid not null references regb.tenants(id) on delete cascade,
  notification_id uuid not null,
  user_id         uuid not null,
  read_at         timestamptz not null default now(),
  -- tenant al frente: la RLS filtra por tenant en cada consulta, y la
  -- pregunta de la campana es "¿hay lectura de ESTE aviso para MI?", que
  -- es exactamente esta clave.
  primary key (tenant_id, notification_id, user_id),
  constraint notification_reads_aviso_del_mismo_tenant
    foreign key (tenant_id, notification_id)
    references public.notifications (tenant_id, id) on delete cascade
);

comment on table public.notification_reads is
  'Quien leyo que aviso y cuando (0125). Un aviso de equipo tiene una fila por persona que lo leyo.';

-- ── 2. Lo que ya estaba leido ────────────────────────────────────────
insert into public.notification_reads (tenant_id, notification_id, user_id, read_at)
select n.tenant_id, n.id, n.user_id, n.read_at
from public.notifications n
where n.user_id is not null and n.read_at is not null
on conflict do nothing;

insert into public.notification_reads (tenant_id, notification_id, user_id, read_at)
select n.tenant_id, n.id, m.user_id, n.read_at
from public.notifications n
join (select distinct tenant_id, user_id from public.memberships) m on m.tenant_id = n.tenant_id
where n.user_id is null and n.read_at is not null
on conflict do nothing;

-- ── 3. Fuera `read_at` ───────────────────────────────────────────────
--  Se lleva consigo el indice parcial de 0016 (`where read_at is null`).
--  El que lo sustituye sirve a la bandeja: las mas recientes del tenant.
alter table public.notifications drop column read_at;

create index notifications_tenant_recientes_idx
  on public.notifications (tenant_id, created_at desc);

-- ── 4. Una persona solo marca lo que es suyo o de todos ──────────────
--  La FK compuesta ya impide el aviso de otro tenant. Esto impide el
--  personal de un companero, que es del mismo tenant y la FK deja pasar.
--  SECURITY DEFINER porque, con la politica nueva, quien pregunta no ve
--  ese aviso personal ajeno: un `select` sin privilegios no encontraria
--  nada y dejaria pasar la lectura.
create function public.impedir_leer_aviso_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_para uuid;
begin
  select n.user_id into v_para
  from public.notifications n
  where n.tenant_id = new.tenant_id and n.id = new.notification_id;

  if v_para is not null and v_para <> new.user_id then
    raise exception 'Ese aviso es personal de otra persona.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_leer_aviso_ajeno
  before insert or update on public.notification_reads
  for each row execute function public.impedir_leer_aviso_ajeno();

-- ── 5. RLS ───────────────────────────────────────────────────────────
alter table public.notification_reads enable row level security;
alter table public.notification_reads force row level security;

-- Cada quien ve y escribe SUS lecturas. Que el gerente sepa quien del
-- equipo no ha leido algo seria otra funcion, con su propio permiso; no
-- se regala por la RLS.
create policy tenant_module on public.notification_reads for all
  using      (tenant_id = rls.tenant_id() and rls.module_active('notifications')
              and user_id = rls.regb_uid())
  with check (tenant_id = rls.tenant_id() and rls.module_active('notifications')
              and user_id = rls.regb_uid());

create policy provider_impersonating on public.notification_reads for select
  using (rls.impersonating(tenant_id));

-- La de los avisos: lo tuyo y lo de todos. `with check` NO mira el
-- destinatario: crear un aviso para otra persona es legitimo.
drop policy if exists tenant_module on public.notifications;
create policy tenant_module on public.notifications for all
  using      (tenant_id = rls.tenant_id() and rls.module_active('notifications')
              and (user_id is null or user_id = rls.regb_uid()))
  with check (tenant_id = rls.tenant_id() and rls.module_active('notifications'));

-- ── 6. La bandeja, en un solo sitio ──────────────────────────────────
--  La pantalla, la campana del Shell y las acciones llaman a estas
--  funciones, y las pruebas tambien: asi lo que se prueba es lo que corre.
--
--  SECURITY INVOKER (el defecto): corren con la RLS de quien llama. El
--  usuario sale de `rls.regb_uid()` y el tenant de `rls.tenant_id()`,
--  nunca de un argumento.

-- Los avisos de quien llama, no leidos primero.
create function public.mis_avisos(p_limite integer default 100)
returns table (
  id         uuid,
  module_id  text,
  title      text,
  body       text,
  link       text,
  user_id    uuid,
  created_at timestamptz,
  read_at    timestamptz
)
language sql
stable
set search_path = ''
as $$
  select n.id, n.module_id, n.title, n.body, n.link, n.user_id, n.created_at, r.read_at
  from public.notifications n
  left join public.notification_reads r
    on r.tenant_id = n.tenant_id and r.notification_id = n.id and r.user_id = rls.regb_uid()
  where n.tenant_id = rls.tenant_id()
    and (n.user_id is null or n.user_id = rls.regb_uid())
  order by (r.read_at is null) desc, n.created_at desc
  limit least(greatest(coalesce(p_limite, 100), 1), 500)
$$;

-- El numero de la campana.
create function public.avisos_sin_leer()
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.notifications n
  where n.tenant_id = rls.tenant_id()
    and (n.user_id is null or n.user_id = rls.regb_uid())
    and not exists (
      select 1 from public.notification_reads r
      where r.tenant_id = n.tenant_id and r.notification_id = n.id
        and r.user_id = rls.regb_uid())
$$;

-- Marcar uno. Devuelve si cambio algo: marcar dos veces no es un error,
-- es un doble clic.
create function public.marcar_aviso_leido(p_aviso uuid)
returns boolean
language sql
set search_path = ''
as $$
  with nueva as (
    insert into public.notification_reads (tenant_id, notification_id, user_id)
    select n.tenant_id, n.id, rls.regb_uid()
    from public.notifications n
    where n.id = p_aviso
      and n.tenant_id = rls.tenant_id()
      and (n.user_id is null or n.user_id = rls.regb_uid())
    on conflict do nothing
    returning 1
  )
  select exists (select 1 from nueva)
$$;

-- Marcar todos los de quien llama. Devuelve cuantos marco.
create function public.marcar_avisos_leidos()
returns integer
language sql
set search_path = ''
as $$
  with nuevas as (
    insert into public.notification_reads (tenant_id, notification_id, user_id)
    select n.tenant_id, n.id, rls.regb_uid()
    from public.notifications n
    where n.tenant_id = rls.tenant_id()
      and (n.user_id is null or n.user_id = rls.regb_uid())
    on conflict do nothing
    returning 1
  )
  select count(*)::integer from nuevas
$$;

revoke all on function public.mis_avisos(integer) from public;
revoke all on function public.avisos_sin_leer() from public;
revoke all on function public.marcar_aviso_leido(uuid) from public;
revoke all on function public.marcar_avisos_leidos() from public;
grant execute on function public.mis_avisos(integer) to authenticated;
grant execute on function public.avisos_sin_leer() to authenticated;
grant execute on function public.marcar_aviso_leido(uuid) to authenticated;
grant execute on function public.marcar_avisos_leidos() to authenticated;

-- ── 7. `notifications.notice.sent` ───────────────────────────────────
--  Lo consume quien quiera llevar el aviso a otro canal: un webhook
--  (api-webhooks), y el dia que existan, correo y push.
--
--  Con sesion de usuario -la accion de automatizaciones- pasa por
--  `emit_event()`, la puerta de siempre, que valida formato y tenant.
--  Sin sesion -el despachador del bus, REGB Control- `emit_event()` no
--  sirve: exige el tenant en el JWT y revertiria el aviso entero. Ahi el
--  tenant sale de la fila, que ya se escribio con el suyo.
--
--  Los avisos que escribe una automatizacion NO emiten. Una regla
--  "cuando se envie un aviso, crea un aviso" se alimentaria a si misma:
--  cada pasada del procesador crearia el aviso que dispara la siguiente.
--
--  El payload no lleva el cuerpo: el titulo y el enlace bastan para
--  avisar por otro canal, y el cuerpo es lo que mas facil lleva un monto.
create function public.emitir_aviso_enviado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  if new.module_id = 'automations' then
    return new;
  end if;

  v_payload := jsonb_build_object(
    'notificationId', new.id,
    'moduleId', new.module_id,
    -- null = para todo el equipo
    'userId', new.user_id,
    'title', new.title,
    'link', new.link
  );

  if rls.tenant_id() is not distinct from new.tenant_id then
    perform public.emit_event('notifications.notice.sent', v_payload, 'notifications');
  else
    insert into public.event_outbox (tenant_id, type, payload, emitted_by)
    values (new.tenant_id, 'notifications.notice.sent', v_payload, 'notifications');
  end if;
  return new;
end;
$$;

create trigger emitir_aviso_enviado
  after insert on public.notifications
  for each row execute function public.emitir_aviso_enviado();
