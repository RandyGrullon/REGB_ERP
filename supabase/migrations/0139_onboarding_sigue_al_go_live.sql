-- ═══════════════════════════════════════════════════════════════════════
--  0139 · La etapa de onboarding sigue a la fecha de go-live
--
--  Un cliente que ya opera (go_live_at puesto) nacia en la etapa
--  "Vendido" del tablero de onboarding, porque el disparador de alta
--  (0011) pone 'sold' a todo tenant nuevo sin mirar la fecha. Pasaba con
--  cualquier cliente cargado ya en marcha -el seed de la demo, un cliente
--  migrado de otro sistema-: REGB Control lo ensenaba como recien vendido
--  y en la columna "Vendido" del Kanban, aunque llevara meses facturando.
--
--  Lo contrario ya estaba resuelto: mover la tarjeta a "En vivo" fija
--  go_live_at (control/onboarding/actions.ts). Aqui se cierra el otro
--  lado: un tenant que nace con go_live_at entra en 'live'.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function regb.on_tenant_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform regb.provision_system_roles(new.id);
  perform regb.provision_core_modules(new.id);

  insert into regb.onboarding (tenant_id, stage)
  values (new.id, case when new.go_live_at is not null then 'live' else 'sold' end)
    on conflict (tenant_id) do nothing;

  return new;
end;
$$;

-- Los que ya quedaron mal. Solo las tarjetas que NADIE ha movido desde que
-- se crearon (updated_at igual al alta del tenant: misma transaccion). Una
-- que el proveedor devolvio a mano a "Vendido" despues del go-live tiene
-- un updated_at posterior y se respeta: esa decision es suya.
update regb.onboarding o
set stage = 'live'
from regb.tenants t
where t.id = o.tenant_id
  and o.stage = 'sold'
  and t.go_live_at is not null
  and o.updated_at = t.created_at;
