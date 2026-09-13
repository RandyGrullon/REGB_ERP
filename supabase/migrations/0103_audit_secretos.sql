-- ═══════════════════════════════════════════════════════════════════════
--  0103 — La bitacora no guarda secretos
--
--  ── El defecto ────────────────────────────────────────────────────────
--
--  `audit.record()` guarda `to_jsonb(new)`: la fila ENTERA. En casi toda
--  tabla eso es justo lo que se quiere. En `public.ecf_config` no:
--  esa fila lleva `endpoint_token`, los 128 bits que son lo UNICO que
--  separa el buzon de e-CF de un cliente del de otro -las tres URL
--  publicas no piden nada mas-.
--
--  Resultado: cada vez que alguien tocaba la configuracion de facturacion
--  electronica, el token quedaba en claro dentro de `audit.log.after`. Y
--  `audit.log` la lee CUALQUIER usuario del tenant con permiso de
--  bitacora -por diseno, para eso esta-, mientras que la fila de
--  `ecf_config` solo la ve quien administra el modulo. La bitacora,
--  pensada para vigilar, terminaba filtrando la llave que vigila.
--
--  ── El arreglo ────────────────────────────────────────────────────────
--
--  Los argumentos del trigger a partir del segundo son nombres de
--  columna a ocultar. El mecanismo es generico: el core sigue sin saber
--  que existe un modulo llamado 'e-invoice' -eso viaja como dato en la
--  definicion del trigger, igual que el module_id-. `audit:registry`
--  sigue verde.
--
--  No se guarda un `'***'` fijo sino `oculto:<8 del md5>`: asi la
--  bitacora conserva lo que de verdad importa de un secreto -si CAMBIO y
--  cuando- sin poder reconstruirlo. Con 128 bits de entropia, el md5 no
--  se invierte por fuerza bruta.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function audit.record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_module   text := coalesce(tg_argv[0], 'core');
  v_tenant   uuid;
  v_entity   uuid;
  v_action   text;
  v_before   jsonb;
  v_after    jsonb;
  i          integer;
  v_col      text;
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_tenant := (v_before ->> 'tenant_id')::uuid;
    v_entity := (v_before ->> 'id')::uuid;
    v_action := 'delete';
  else
    v_after  := to_jsonb(new);
    v_tenant := (v_after ->> 'tenant_id')::uuid;
    v_entity := (v_after ->> 'id')::uuid;
    if tg_op = 'UPDATE' then
      v_before := to_jsonb(old);
      v_action := 'update';
      -- Soft delete se audita como borrado, que es lo que el usuario hizo.
      if v_before ->> 'deleted_at' is null and v_after ->> 'deleted_at' is not null then
        v_action := 'delete';
      end if;
    else
      v_action := 'create';
    end if;
  end if;

  -- Columnas secretas: se sustituyen en AMBAS instantaneas. Olvidar
  -- `before` dejaria el valor viejo en claro en cada update, que es
  -- exactamente el evento que mas interesa auditar.
  for i in 1 .. tg_nargs - 1 loop
    v_col := tg_argv[i];
    if v_before ? v_col and jsonb_typeof(v_before -> v_col) <> 'null' then
      v_before := jsonb_set(v_before, array[v_col],
                            to_jsonb('oculto:' || left(md5(v_before ->> v_col), 8)));
    end if;
    if v_after ? v_col and jsonb_typeof(v_after -> v_col) <> 'null' then
      v_after := jsonb_set(v_after, array[v_col],
                           to_jsonb('oculto:' || left(md5(v_after ->> v_col), 8)));
    end if;
  end loop;

  insert into audit.log (tenant_id, user_id, module_id, entity, entity_id, action, before, after)
  values (v_tenant, rls.regb_uid(), v_module, tg_table_name, v_entity, v_action, v_before, v_after);

  return coalesce(new, old);
end;
$$;

comment on function audit.record() is
  'Trigger generico. Uso: for each row execute function audit.record(''inventory'').
   Los argumentos siguientes son columnas a ocultar: audit.record(''e-invoice'', ''endpoint_token'').';

-- ── El trigger de ecf_config pasa a ocultar el token ──────────────────
drop trigger if exists audit_me on public.ecf_config;
create trigger audit_me after insert or update on public.ecf_config
  for each row execute function audit.record('e-invoice', 'endpoint_token');

-- ── Y se limpia lo que ya se escribio ─────────────────────────────────
--  `audit.log` es inmutable para los usuarios -la RLS no tiene politica
--  de update-, pero esta migracion corre como dueña. Se hace una sola
--  vez y de forma acotada: unicamente la columna del secreto, unicamente
--  en las filas de ecf_config. El resto de la bitacora no se toca.
--
--  Se conserva la huella para que la limpieza no borre la historia: un
--  auditor sigue pudiendo ver que el token cambio el dia X.
do $$
declare
  v_part text;
begin
  for v_part in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'audit' and c.relkind = 'r' and c.relname like 'log\_%'
  loop
    execute format($f$
      update audit.%I
         set after  = case when after ? 'endpoint_token'
                             and after ->> 'endpoint_token' not like 'oculto:%%'
                           then jsonb_set(after, '{endpoint_token}',
                                to_jsonb('oculto:' || left(md5(after ->> 'endpoint_token'), 8)))
                           else after end,
             before = case when before ? 'endpoint_token'
                             and before ->> 'endpoint_token' not like 'oculto:%%'
                           then jsonb_set(before, '{endpoint_token}',
                                to_jsonb('oculto:' || left(md5(before ->> 'endpoint_token'), 8)))
                           else before end
       where entity = 'ecf_config'
         and (after ? 'endpoint_token' or before ? 'endpoint_token')
    $f$, v_part);
  end loop;
end $$;
