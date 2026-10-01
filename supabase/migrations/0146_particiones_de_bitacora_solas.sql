-- ═══════════════════════════════════════════════════════════════════════
--  0146 — Las particiones de la bitacora se crean solas (pg_cron)
--
--  `audit.log` esta particionada por mes y 0120 dejo 37 meses creados por
--  delante. Sin una particion para el mes en curso, CADA escritura
--  auditada falla y revierte su transaccion: el ERP entero sin poder
--  guardar. Faltaba que se renovaran solas (docs/defi-v1.md §4.9, tarea
--  de regb-db).
--
--  En Supabase hay `pg_cron`: el dia 1 de cada mes, a las 07:00 UTC (3:00
--  a. m. en RD), se asegura el mes en curso y los 12 siguientes. Corre
--  DENTRO de la base, como `postgres`: no hay secreto que guardar ni
--  maquina que mantener.
--
--  En el Postgres de pruebas (`regb_test`, sin pg_cron) no hace nada: ahi
--  las particiones las crea 0120 y la prueba particiones-bitacora.test.ts
--  avisa cuando quedan menos de 12 meses.
--
--  Idempotente: `cron.schedule` con el mismo nombre reemplaza el trabajo.
-- ═══════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'Sin pg_cron (Postgres de pruebas): las particiones siguen dependiendo de 0120.';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;

  perform cron.schedule(
    'regb-bitacora-particiones',
    '0 7 1 * *',
    $c$select audit.ensure_partition((date_trunc('month', now()) + make_interval(months => g))::date)
       from generate_series(0, 12) g$c$
  );
exception when insufficient_privilege then
  raise notice 'Sin permiso para pg_cron: activalo en Database → Extensions y vuelve a correr esta migracion a mano.';
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  Como verificarlo (SQL Editor):
--    select jobname, schedule, active from cron.job;
--    select status, start_time from cron.job_run_details order by start_time desc limit 5;
--  Vuelta atras (down):
--    select cron.unschedule('regb-bitacora-particiones');
-- ═══════════════════════════════════════════════════════════════════════
