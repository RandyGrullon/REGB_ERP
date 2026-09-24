-- ═══════════════════════════════════════════════════════════════════════
--  0140 — El nombre comercial del alta llega a la configuracion
--
--  El alta de un cliente (0133, regb.alta_de_cliente) guarda el nombre
--  comercial en regb.tenants y en su empresa, pero no en
--  public.tenant_settings.trade_name, que es lo que leen el inicio ("Pon
--  el nombre de tu negocio"), Configuracion y el ticket de la caja. El
--  cliente recien dado de alta veia el paso pendiente, el campo vacio y un
--  ticket encabezado con la razon social, aunque el proveedor ya habia
--  escrito el nombre por el que lo conocen.
--
--  Se copia al crear el cliente y cuando el proveedor lo cambia, pero solo
--  si el cliente no escribio el suyo: lo que el dueño pone en
--  Configuracion manda y no se pisa.
--
--  Reversion: drop trigger nombre_comercial_a_configuracion on
--  regb.tenants; drop function regb.nombre_comercial_a_configuracion().
--  Las filas copiadas se quedan: son el nombre correcto.
-- ═══════════════════════════════════════════════════════════════════════

create function regb.nombre_comercial_a_configuracion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(new.trade_name, '')), '') is null then
    return new;
  end if;

  insert into public.tenant_settings (tenant_id, trade_name)
  values (new.id, btrim(new.trade_name))
  on conflict (tenant_id) do update
    set trade_name = excluded.trade_name,
        updated_at = now()
    where nullif(btrim(coalesce(public.tenant_settings.trade_name, '')), '') is null;

  return new;
end;
$$;

create trigger nombre_comercial_a_configuracion
  after insert or update of trade_name on regb.tenants
  for each row execute function regb.nombre_comercial_a_configuracion();

-- Los clientes que ya se dieron de alta sin esto.
insert into public.tenant_settings (tenant_id, trade_name)
select t.id, btrim(t.trade_name)
from regb.tenants t
where nullif(btrim(coalesce(t.trade_name, '')), '') is not null
on conflict (tenant_id) do update
  set trade_name = excluded.trade_name,
      updated_at = now()
  where nullif(btrim(coalesce(public.tenant_settings.trade_name, '')), '') is null;
