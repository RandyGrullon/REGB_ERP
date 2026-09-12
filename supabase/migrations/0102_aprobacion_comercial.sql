-- ═══════════════════════════════════════════════════════════════════════
--  0102 — La aprobacion comercial deja de pisar el estado fiscal
--
--  Lo encontro una revision adversarial del codigo del e-CF.
--
--  ── El defecto ────────────────────────────────────────────────────────
--
--  La ruta publica de aprobacion escribia el resultado de la aprobacion
--  comercial (1 aceptado / 2 rechazado) DENTRO de `ecf_emitidos.estado`,
--  que es otra cosa: el estado que devuelve la DGII (0 a 4, donde 1 es
--  "aceptado" y 2 es "rechazado: nulo para fines tributarios").
--
--  Dos semanticas distintas en una sola columna, y las dos usan los
--  numeros 1 y 2. El CHECK no estorbaba porque ambos valores son legales.
--  Consecuencia: un tercero escribiendo un 2 hacia que
--  `esValidoFiscalmente()` devolviera false para una factura que la DGII
--  habia ACEPTADO. Una factura buena pasaba a leerse como nula.
--
--  La prueba de que fue descuido y no diseño: en el lado receptor esto ya
--  estaba bien resuelto. `ecf_recibidos` tiene su columna `aprobacion`
--  aparte, con el comentario "es informacion NUEVA, no una correccion de
--  lo que llego" (0101). Al lado emisor se le olvido.
--
--  ── Lo que se hace ────────────────────────────────────────────────────
--
--  Columna propia, con el mismo vocabulario que ya usa `ecf_recibidos`
--  -'aceptado'/'rechazado' y no 1/2-, para que sea imposible confundirla
--  con el estado fiscal leyendo una fila.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.ecf_emitidos
  add column aprobacion_comercial text
    check (aprobacion_comercial in ('aceptado', 'rechazado')),
  add column aprobado_en          timestamptz,
  add column motivo_rechazo       text;

comment on column public.ecf_emitidos.aprobacion_comercial is
  'Lo que el COMPRADOR decidio sobre esta factura. No confundir con `estado`, que es el veredicto FISCAL de la DGII: una factura puede estar aceptada por la DGII y rechazada comercialmente por el cliente, y son hechos independientes.';

comment on column public.ecf_emitidos.estado is
  'Veredicto de la DGII (0-4). Lo escribe SOLO la consulta de resultado por trackId, nunca una aprobacion comercial que llega de internet.';

-- Una fecha de aprobacion sin decision -o al reves- deja una fila que no
-- se puede interpretar.
alter table public.ecf_emitidos
  add constraint aprobacion_con_fecha
  check ((aprobacion_comercial is null) = (aprobado_en is null));

-- El motivo solo tiene sentido cuando se rechaza: es lo que el emisor
-- necesita para corregir.
alter table public.ecf_emitidos
  add constraint motivo_solo_si_rechazo
  check (motivo_rechazo is null or aprobacion_comercial = 'rechazado');
