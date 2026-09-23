-- ═══════════════════════════════════════════════════════════════════════
--  0124 — `invoice-capture` no se vende mientras no exista
--
--  ── El hallazgo ───────────────────────────────────────────────────────
--
--  0012 lo publico con precio (advanced: 400/1500/4000 de instalacion,
--  45/160/420 al mes) y la siembra se lo activo a Distribuidora Caribe.
--  Del modulo existe el manifiesto, la fila del catalogo, la ficha de
--  marketplace y un tour. No existe ninguna tabla, ninguna pagina,
--  ninguna accion ni ningun OCR: sus cuatro rutas dan 404.
--
--  Y el motor de facturacion SI lo cobraba. REGB Control y la generacion
--  de facturas leen `regb.tenant_modules` (activo o en prueba, encendido)
--  y le pasan cada modulo de pago a `calculateMonthly`: un modulo
--  advanced en un tier mediano ocupa un hueco de US$160 al mes, y su
--  instalacion entraba en la cotizacion. El consumo medido (US$0.04 por
--  documento) no llegaba a cobrarse, pero solo porque nada lo mide:
--  `regb.usage_meters` ni siquiera admite la metrica.
--
--  ── La decision ───────────────────────────────────────────────────────
--
--  Se ARCHIVA la activacion, no se excluye "lo no publicado" del calculo.
--
--  `is_published` significa "se vende hoy", no "funciona". Un modulo que
--  se deja de vender pero que el cliente usa se le sigue cobrando
--  (grandfathering), y hoy mismo `e-invoice` esta sin publicar, construido
--  y activo en la distribuidora: excluir lo no publicado le regalaria ese
--  modulo sin que nadie lo decidiera. Lo que hace que invoice-capture no
--  se cobre no es que no se venda, es que el cliente NO LO TIENE: no hay
--  nada que usar. Archivarlo dice exactamente eso, y de paso le quita del
--  menu cuatro enlaces a un 404 y un tour que manda a subir una foto que
--  nadie lee. Archivar no borra nada (§4.3); aqui tampoco hay datos.
--
--  Y como archivar lo de hoy no impide activarlo manana, la base se niega
--  a activarlo -ni activo ni en prueba- mientras no exista. Quien lo
--  construya quita esta guarda en la misma migracion que lo publique.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Fuera del escaparate ──────────────────────────────────────────
--  El marketplace pinta los no publicados como "En camino" y la solicitud
--  de activacion ya filtra por `is_published` (marketplace/actions.ts).
--  El precio de `regb.module_pricing` se queda: es el que tendra cuando
--  exista, y el simulador lo sigue ensenando como referencia.
--
--  La ficha decia en presente cosas que nadie ha medido. "Acierta casi
--  siempre" es una cifra de un OCR que no existe; y 15 minutos de puesta
--  en marcha, de algo que no se puede poner en marcha. Se corrige lo que
--  afirma un hecho; lo que describe el diseno (pasos, pantallas) se queda,
--  porque bajo "En camino" se lee como lo que es: el plan.
update regb.module_catalog
set is_published  = false,
    setup_minutes = null,
    faq = (
      select coalesce(jsonb_agg(
        case when item ->> 'p' = '¿Que tan bien lee?'
          then jsonb_build_object(
            'p', '¿Que tan bien lee?',
            'r', 'Todavia no esta construido, asi que no hay cifra honesta que darte. Lo que ya esta decidido: marca en ambar los campos dudosos y nunca contabiliza sin que una persona apruebe.')
          else item
        end order by ord), '[]'::jsonb)
      from jsonb_array_elements(faq) with ordinality as f(item, ord)
    )
where id = 'invoice-capture';

-- ── 2. Nadie lo tiene: se archiva la activacion ─────────────────────
--  `archived_at` conserva la fecha del primer archivo si ya la tenia.
update regb.tenant_modules
set status      = 'archived',
    archived_at = coalesce(archived_at, now())
where module_id = 'invoice-capture'
  and status in ('active', 'trial');

-- ── 3. Solicitudes pendientes que lo pedian ─────────────────────────
--  "Activar solicitud" en REGB Control activa lo que la solicitud trae,
--  sin volver a mirar el catalogo. Una solicitud hecha antes de hoy lo
--  llevaria de vuelta, y con la guarda de abajo el boton fallaria a
--  medias. Se quita de lo pedido y se deja escrito por que: el precio
--  que se le enseno al cliente lo incluia, y eso tiene que saberlo quien
--  lo llame.
update regb.activation_requests
set modules = array_remove(modules, 'invoice-capture'),
    note    = coalesce(note || ' · ', '')
              || 'Captura de facturas se retiro del catalogo (0124): todavia no existe. '
              || 'El precio cotizado la incluia.'
where status = 'pending'
  and 'invoice-capture' = any (modules)
  and cardinality(modules) > 1;

-- Si era lo unico que pedia, no queda nada que activar: se cierra con
-- motivo, que es como el panel guarda las que no proceden.
update regb.activation_requests
set status      = 'declined',
    resolved_at = now(),
    note        = coalesce(note || ' · ', '')
                  || 'Captura de facturas se retiro del catalogo (0124): todavia no existe.'
where status = 'pending'
  and modules = array['invoice-capture'];

-- ── 4. La guarda ─────────────────────────────────────────────────────
--  Cualquier camino que lo active -el panel, una solicitud vieja, un SQL
--  a mano, la siembra- choca aqui. Es lo que convierte "no se cobra" en
--  algo que la base garantiza y no en algo que hoy resulta cierto.
--
--  Se mira el estado y no `enabled`: un modulo activo y apagado por el
--  cliente sigue siendo una licencia, y una licencia se cobra.
create function regb.invoice_capture_no_existe_todavia() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Captura de facturas todavia no existe: no se activa ni se cobra hasta que tenga pantallas (0124).'
    using errcode = '55000';
end;
$$;

comment on function regb.invoice_capture_no_existe_todavia() is
  'Guarda de 0124. Quitarla en la misma migracion que publique invoice-capture con pantallas de verdad.';

create trigger no_activar_invoice_capture
  before insert or update of status on regb.tenant_modules
  for each row
  when (new.module_id = 'invoice-capture' and new.status in ('active', 'trial'))
  execute function regb.invoice_capture_no_existe_todavia();
