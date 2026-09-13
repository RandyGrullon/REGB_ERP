-- ═══════════════════════════════════════════════════════════════════════
--  0104 — Saber si el respaldo SALIO de aqui
--
--  ── El problema ───────────────────────────────────────────────────────
--
--  `public.backups` guarda el respaldo DENTRO de la misma base que
--  respalda. Contra un borrado por error eso sirve. Contra lo que de
--  verdad termina un negocio -un incendio, un ransomware, una base
--  perdida- no sirve de nada: se va el original y se va la copia.
--
--  El propio tutorial se lo dice al cliente con todas las letras
--  ("Guardalo fuera de aqui", tour f13.respaldos). Pero el producto no
--  tenia forma de saber si le hizo caso, asi que tampoco podia avisarle
--  cuando no. Un cliente con 40 respaldos en la lista y ninguno
--  descargado cree que esta protegido y no lo esta. Esa creencia es peor
--  que no tener respaldos, porque quita las ganas de buscar otra cosa.
--
--  ── Lo que se guarda ──────────────────────────────────────────────────
--
--  Cuando y quien se lo llevo. Con eso la pantalla puede decir la unica
--  frase que importa: "tu ultimo respaldo fuera de aqui es de hace N
--  dias".
--
--  No se guarda A DONDE se lo llevo. El navegador no lo dice -y aunque
--  lo dijera, seria la ruta de descargas de una maquina-. Inventar un
--  campo "destino" que en realidad nadie llena es peor que no tenerlo:
--  se ve en la pantalla y se lee como si fuera cierto.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.backups
  add column if not exists downloaded_at timestamptz,
  add column if not exists downloaded_by uuid;

comment on column public.backups.downloaded_at is
  'Cuando alguien se lo llevo fuera del sistema. Nulo = la copia sigue viviendo junto al original y no protege de nada.';

comment on column public.backups.downloaded_by is
  'Quien lo descargo. Sin FK a proposito: si el usuario se va de la empresa, el hecho de que el respaldo salio no deja de ser cierto.';

-- Para la consulta de la pantalla: el ultimo que SI salio.
create index if not exists backups_tenant_descargado_idx
  on public.backups (tenant_id, downloaded_at desc)
  where downloaded_at is not null;
