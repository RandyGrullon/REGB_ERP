-- ═══════════════════════════════════════════════════════════════════════
--  0030 · CRITICO · Dos fugas entre clientes en la capa fiscal
-- ═══════════════════════════════════════════════════════════════════════
--
--  Las encontraron las pruebas de aislamiento de `fiscal.test.ts`. Ninguna
--  se ve usando la aplicacion: las dos requieren llamar a la base
--  directamente, que es exactamente lo que hace un atacante y lo que hace
--  cualquier integracion futura por API.
--
--  ── Fuga 1: assign_ncf aceptaba el tenant de otro ─────────────────────
--
--  La funcion es `security definer` —tiene que serlo, escribe en una tabla
--  con RLS— y recibia `p_tenant` como parametro SIN comprobar que fuera el
--  del que llama. Cualquier usuario autenticado de cualquier cliente podia
--  quemarle los NCF a otro: pedir numeros hasta agotarle el rango.
--
--  Consecuencia real: la victima no puede facturar hasta que la DGII le
--  autorice un rango nuevo, lo que toma dias. Y los numeros consumidos no
--  vuelven.
--
--  Regla: el parametro se comprueba contra `rls.tenant_id()`. Se mantiene
--  como parametro en vez de leerlo de los claims porque el proveedor
--  impersonando SI necesita poder emitir en nombre del cliente que
--  atiende, y eso se autoriza explicitamente.
--
--  ── Fuga 2: las vistas 607 y 608 se saltaban la RLS ───────────────────
--
--  Una vista en Postgres corre con los privilegios de su DUENO salvo que
--  se marque `security_invoker`. Como se crearon sin esa opcion, leian las
--  tablas base como superusuario: `select * from public.dgii_607` devolvia
--  las ventas de TODOS los clientes, con su RNC, sus montos y sus NCF.
--
--  Es la peor clase de fuga del proyecto: multi-tenant con datos fiscales
--  identificables. Y silenciosa, porque la aplicacion siempre filtra por
--  `tenant_id` en el `where` y nunca lo habria mostrado.
--
--  Con `security_invoker = true` la vista lee con los permisos de quien
--  consulta, asi que la RLS de `pos_sales` y `customer_invoices` vuelve a
--  aplicar. El filtro por tenant del `where` pasa a ser conveniencia, no
--  la unica defensa.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Fuga 1 ──────────────────────────────────────────────────────────────
create or replace function public.assign_ncf(
  p_tenant  uuid,
  p_type    text,
  p_company uuid default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq    public.ncf_sequences;
  v_numero integer;
  v_digitos integer;
begin
  -- Lo primero, antes de tocar nada: esta funcion elude la RLS por
  -- definicion, asi que el chequeo de pertenencia lo tiene que hacer ella.
  if p_tenant is distinct from rls.tenant_id() then
    raise exception 'No puedes emitir comprobantes de otro cliente.'
      using errcode = '42501';
  end if;

  select * into v_seq
  from public.ncf_sequences
  where tenant_id = p_tenant
    and ncf_type = p_type
    and is_active
    and (company_id = p_company or (company_id is null and p_company is null))
  for update;

  if not found then
    raise exception 'No hay secuencia activa de % para este cliente. Registra la autorizacion de la DGII.', p_type
      using errcode = 'P0002';
  end if;

  if v_seq.expires_on < current_date then
    raise exception 'La secuencia de % vencio el %. Pide una autorizacion nueva a la DGII.',
      p_type, v_seq.expires_on using errcode = 'P0003';
  end if;

  if v_seq.next_number > v_seq.range_to then
    raise exception 'Se agotaron los NCF de % (rango % - %). Pide una autorizacion nueva.',
      p_type, v_seq.range_from, v_seq.range_to using errcode = 'P0004';
  end if;

  v_numero := v_seq.next_number;

  update public.ncf_sequences
  set next_number = next_number + 1
  where id = v_seq.id;

  -- La serie E lleva 10 digitos; la B, 8. Igual que formatNcf() en
  -- packages/operations/src/dgii.ts.
  v_digitos := case when left(p_type, 1) = 'E' then 10 else 8 end;
  return p_type || lpad(v_numero::text, v_digitos, '0');
end;
$$;

comment on function public.assign_ncf(uuid, text, uuid) is
  'Consume el proximo NCF de forma atomica, solo del cliente que llama. Irreversible: un numero usado no vuelve, ni aunque se anule la factura (va al 608).';

-- ── Fuga 2 ──────────────────────────────────────────────────────────────
--  `security_invoker` no se puede activar con ALTER en una vista que ya
--  existe en todas las versiones, asi que se marca al recrearla. El cuerpo
--  es identico al de 0028: lo unico que cambia es quien lo ejecuta.
alter view public.dgii_607 set (security_invoker = true);
alter view public.dgii_608 set (security_invoker = true);
