-- ═══════════════════════════════════════════════════════════════════════
--  0035 · Solicitudes de activacion de modulos
-- ═══════════════════════════════════════════════════════════════════════
--
--  El boton "Solicitar activacion" del marketplace no hacia nada. Un
--  cliente lo pulsaba, no pasaba nada, y ni el se enteraba ni el
--  proveedor. Es el peor sitio posible para un boton muerto: el unico
--  punto de toda la app donde alguien esta diciendo "quiero pagarte mas".
--
--  Se resuelve como pide el negocio: activar NO es automatico. Hay que
--  cotizar, cobrar la instalacion y a veces migrar datos, asi que lo que
--  el cliente hace es PEDIR y lo que el proveedor hace es atender. La
--  tabla es esa conversacion.
--
--  Vive en `regb` y no en `public` porque es del proveedor: el cliente
--  crea su solicitud y ve las suyas, pero quien las trabaja es REGB.
-- ═══════════════════════════════════════════════════════════════════════

create table regb.activation_requests (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  -- Los modulos pedidos, ya con sus dependencias resueltas por la UI.
  modules      text[] not null check (cardinality(modules) > 0),
  -- Lo que se le enseño al cliente cuando pidio. Se guarda porque el
  -- precio puede cambiar entre la peticion y la llamada, y discutir de
  -- memoria sobre lo que decia la pantalla no lo gana nadie.
  quoted_monthly numeric(12,2) not null default 0,
  quoted_install numeric(12,2) not null default 0,
  note         text,
  status       text not null default 'pending'
                 check (status in ('pending', 'contacted', 'activated', 'declined')),
  requested_by uuid,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid
);

create index on regb.activation_requests (status, created_at desc);
create index on regb.activation_requests (tenant_id, created_at desc);

-- Una peticion pendiente por cliente: pulsar dos veces el boton es lo
-- normal cuando no pasa nada visible, y no debe abrir dos conversaciones.
-- Las ya atendidas si se acumulan: son el historial comercial.
create unique index activation_requests_una_pendiente
  on regb.activation_requests (tenant_id)
  where status = 'pending';

alter table regb.activation_requests enable row level security;
alter table regb.activation_requests force row level security;

-- El cliente crea la suya y ve las suyas. No puede tocarlas despues:
-- cambiar lo pedido una vez que el proveedor empezo a trabajarla es como
-- se pierde el rastro de que se acordo.
create policy tenant_lee on regb.activation_requests
  for select using (tenant_id = rls.tenant_id() or rls.is_provider());

create policy tenant_pide on regb.activation_requests
  for insert with check (tenant_id = rls.tenant_id());

create policy proveedor_atiende on regb.activation_requests
  for update using (rls.is_provider()) with check (rls.is_provider());

grant select, insert on regb.activation_requests to authenticated;
grant update on regb.activation_requests to authenticated;

comment on table regb.activation_requests is
  'Peticiones de activacion desde el marketplace. Activar no es automatico: hay que cotizar, cobrar instalacion y a veces migrar datos.';
comment on column regb.activation_requests.quoted_monthly is
  'Lo que decia la pantalla cuando el cliente pidio. Se guarda para no discutir de memoria si el precio cambia antes de la llamada.';
