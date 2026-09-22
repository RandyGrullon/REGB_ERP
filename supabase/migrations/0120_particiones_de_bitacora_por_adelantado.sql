-- ═══════════════════════════════════════════════════════════════════════
--  0120 — Particiones de la bitacora con tres anos de margen
--
--  Lo encontro el agente que escribia la ficha de `audit`, leyendo el
--  codigo: `audit.log` esta particionada por mes, y las particiones solo
--  se crean en migraciones. La 0004 creo el mes en curso y los tres
--  siguientes. En la base de pruebas eso llegaba hasta diciembre de 2026.
--
--  El 1 de enero, cada escritura auditada -productos, facturas, cobros,
--  casi todo pasa por `audit.record()`- no encuentra particion, falla, y
--  REVIERTE SU TRANSACCION ENTERA. El ERP deja de poder guardar nada, de
--  golpe, en todos los clientes a la vez, y el mensaje de error habla de
--  particiones: nadie en el mostrador lo va a entender.
--
--  Y una base de produccion nueva naceria igual: mes actual mas tres.
--
--  ── Por que por adelantado y no una particion por defecto ────────────
--
--  Una particion DEFAULT evita el fallo, pero estorba despues: crear el
--  mes que toca falla si la DEFAULT ya tiene filas de ese rango, asi que
--  `ensure_partition()` se romperia justo el dia que alguien la llame.
--  Treinta y seis particiones vacias no cuestan nada.
--
--  ── Y quien avisa cuando se vuelvan a acabar ─────────────────────────
--
--  supabase/tests/particiones-bitacora.test.ts: la puerta f0 se pone roja
--  cuando queden menos de 12 meses. Como la puerta se corre a diario, el
--  aviso llega con un ano de margen, no el dia del apagon.
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare i integer;
begin
  for i in 0..36 loop
    perform audit.ensure_partition((current_date + (i || ' month')::interval)::date);
  end loop;
end $$;
