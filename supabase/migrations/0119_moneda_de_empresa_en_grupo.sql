-- ═══════════════════════════════════════════════════════════════════════
--  0119 — La moneda de una empresa que ya consolida no se cambia por detras
--
--  0117 cerro dos puertas de la misma habitacion: una empresa en otra
--  moneda no entra al grupo, y el grupo no cambia de moneda con empresas
--  dentro. Quedaba la tercera: update public.companies set currency
--  sobre una empresa YA miembro. Una empresa en DOP pasaba a USD dentro de
--  un grupo que presenta en DOP, y la siguiente corrida sumaba sus dolares
--  como si fueran pesos. Nada traduce -este corte no traduce moneda-, asi
--  que el resultado era una suma sin sentido con una etiqueta creible.
--
--  El criterio copia el de impedir_cambiar_moneda_del_grupo(), mismo
--  errcode 55000 y mismo tono de mensaje, para que la pantalla y quien lea
--  la bitacora vean una sola regla contada desde los dos lados.
-- ═══════════════════════════════════════════════════════════════════════

-- SECURITY DEFINER porque la regla tiene que valer aunque quien edita la
-- empresa no vea el modulo consolidation: con el modulo apagado, la RLS le
-- esconde los grupos y las corridas, y un exists que no ve nada deja
-- pasar el cambio. Justo el cliente que apago el modulo sin sacar la
-- empresa del grupo es el que se lleva la sorpresa al volver a encenderlo.
-- Solo lee; no escribe nada con los privilegios prestados.
create function public.impedir_cambiar_moneda_de_empresa_en_grupo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grupo text;
  v_moneda char(3);
begin
  -- Primero lo entregado, igual que en el grupo: si la empresa ya aparece
  -- en un consolidado cerrado -en su foto o en una eliminacion-, sus
  -- libros de ese periodo se sumaron como moneda vieja. Cambiarle la
  -- moneda hoy hace que sus propios reportes digan USD sobre los mismos
  -- numeros que el consolidado de enero leyo como DOP. Salir del grupo no
  -- lo arregla: la corrida cerrada sigue ahi, por eso se mira la corrida
  -- y no la membresia.
  if exists (select 1 from public.consolidation_run_balances b
             join public.consolidation_runs r on r.id = b.run_id
             where b.tenant_id = old.tenant_id and b.company_id = old.id
               and r.status = 'closed')
     or exists (select 1 from public.consolidation_eliminations e
                join public.consolidation_runs r on r.id = e.run_id
                where e.tenant_id = old.tenant_id
                  and old.id in (e.from_company_id, e.to_company_id)
                  and r.status = 'closed') then
    raise exception 'Esa empresa ya figura en consolidados cerrados en %: su moneda no se cambia.',
      old.currency using errcode = '55000';
  end if;

  -- Se compara contra la moneda NUEVA y no contra "cualquier cambio": asi
  -- el criterio es literalmente el de agregar un miembro (0117), y no hay
  -- un estado que la base acepte por una puerta y rechace por la otra.
  select g.name, g.presentation_currency into v_grupo, v_moneda
  from public.consolidation_group_members m
  join public.consolidation_groups g on g.id = m.group_id
  where m.tenant_id = old.tenant_id and m.company_id = old.id
    and g.presentation_currency is distinct from new.currency
  limit 1;
  if found then
    raise exception 'Esa empresa esta en el grupo % que presenta en %: la consolidacion no traduce moneda. Sacala del grupo antes de cambiarle la moneda.',
      v_grupo, v_moneda using errcode = '55000';
  end if;

  return new;
end;
$$;

-- update of currency + when: la tabla de empresas se edita por nombre,
-- RNC, logo y empresa principal todo el tiempo; esas ediciones no tienen
-- por que pagar dos consultas a tablas de consolidacion.
create trigger no_cambiar_moneda_en_grupo before update of currency
  on public.companies
  for each row
  when (new.currency is distinct from old.currency)
  execute function public.impedir_cambiar_moneda_de_empresa_en_grupo();
