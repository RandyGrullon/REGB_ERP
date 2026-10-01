-- ═══════════════════════════════════════════════════════════════════════
--  0175 — Los esquemas de pantalla del catálogo, sin emojis
--
--  La ficha de cada módulo en el marketplace (`/marketplace/[id]`, sección
--  "Sus pantallas, en esquema") pinta `module_catalog.screens[].mockup`
--  tal cual, en un <pre>. Los esquemas de la 0013 traían unos 30 emojis
--  (lupa, engranaje, candado, avisos, información, carrito, cámara,
--  billetes, comida): cada sistema los dibuja distinto, descuadran el
--  dibujo y el producto ya no usa emojis en ninguna parte (los iconos son
--  Material Symbols). Aquí se cambian por texto y símbolos simples.
--
--  ── Qué va por qué ──────────────────────────────────────────────────
--
--   lupa + texto            -> campo "[ Buscar… ]", como los demás campos
--                              del dibujo ("[ $ 20,380.00 ]")
--   engranaje (columnas)    -> "≡"
--   aviso                   -> "!"
--   información             -> "(i)"
--   punto rojo / verde      -> "●" (el texto de al lado dice qué es)
--   candado "sin permiso"   -> "••••• (sin permiso)"
--   cámara / escanear       -> "|||" (código de barras) o "( FOTO )"
--   fotos de producto       -> "▓▓", el mismo relleno que ya usa la foto
--                              de la factura en el esquema de al lado
--   formas de pago          -> "[Efectivo][Tarjeta][Transf.]"
--   visto bueno             -> "ok"
--
--  Cada cambio conserva el ancho en columnas de la línea (un emoji ocupa
--  dos). Tres líneas que ya venían descuadradas por un carácter quedan,
--  de paso, del ancho de su caja.
--
--  ── Cómo ─────────────────────────────────────────────────────────────
--
--  Sustituciones literales (`replace`, no expresiones regulares) de trozos
--  únicos de cada esquema, con contexto suficiente para no tocar nada más,
--  y solo en el módulo al que pertenecen. Idempotente: una segunda pasada
--  no encuentra qué cambiar. Lo único que cambia es `screens[].mockup`:
--  ni títulos, ni descripciones, ni ids.
--
--  Si una base tuviera un esquema distinto al de la 0013 y quedara algún
--  emoji suelto, el último paso lo quita (sin cuidar el ancho): la regla
--  es cero emojis, no un dibujo perfecto.
--
--  La 0013 no se edita: ya está aplicada en todas las bases.
-- ═══════════════════════════════════════════════════════════════════════

create temporary table emojis_0175 (
  orden int primary key,
  modulo text not null,
  antes text not null,
  despues text not null
) on commit drop;

insert into emojis_0175 (orden, modulo, antes, despues) values
  (1, 'products',
   U&'│ \+01F50D Buscar producto…      [Categoria ▾]',
   '│ [ Buscar producto…     ]  [Categoria ▾]'),
  (2, 'products',
   U&'PRECIO      \2699\FE0F │',
   'PRECIO      ≡  │'),
  (3, 'products',
   U&'Costo         \+01F512 sin permiso                        │',
   'Costo         ••••• (sin permiso)                   │'),
  (4, 'inventory',
   U&'│ \26A0\FE0F Bajos 23 │ \+01F534 Vencen 7 │',
   '│ ! Bajos 23  │ ● Vencen 7  │'),
  (5, 'inventory',
   U&'│ \+01F50D Buscar…   [Almacen ▾]',
   '│ [ Buscar…   ] [Almacen ▾]'),
  (6, 'inventory',
   U&'COSTO    \2699\FE0F │',
   'COSTO    ≡  │'),
  (7, 'inventory',
   U&'A-1   \26A0\FE0F  18',
   'A-1   !   18'),
  (8, 'inventory',
   U&'REF   \+01F534   4',
   'REF   ●    4'),
  (9, 'inventory',
   U&'│   [ \+01F4F7 ESCANEAR ]   │',
   '│  [ ||| ESCANEAR ]   │'),
  (10, 'inventory',
   U&'\2139\FE0F Ajustes sobre $10,000 requieren aprobacion       │',
   '(i) Ajustes sobre $10,000 requieren aprobacion      │'),
  (11, 'pos',
   U&'│ \+01F50D Buscar o escanear   │ \+01F6D2 TICKET #00284            │',
   '│ [ Buscar o escanear ]  │ TICKET #00284               │'),
  (12, 'pos',
   U&'│                   [\+01F4F7] │',
   '│                  [|||] │'),
  (13, 'pos',
   U&'│ │ \+01F35A   ││ \+01F6E2\FE0F   ││ \+01F95B  ││',
   '│ │ ▓▓   ││ ▓▓   ││ ▓▓  ││'),
  (14, 'pos',
   U&'│ │ \+01F33E   ││ \+01F9C2   ││ \2615  ││',
   '│ │ ▓▓   ││ ▓▓   ││ ▓▓  ││'),
  (15, 'pos',
   U&'│ [\+01F4B5 Efec.][\+01F4B3 Tarj.][\+01F4F1 Tra.]│',
   '│ [Efectivo][Tarjeta][Transf.]│'),
  (16, 'pos',
   U&'│ \+01F7E2 En linea · Turno 4h │',
   '│ ● En linea · Turno 4h  │'),
  (17, 'pos',
   U&'-$    40.00  \26A0\FE0F          │',
   '-$    40.00  !           │'),
  (18, 'payroll',
   U&'NETO      \2699\FE0F │',
   'NETO      ≡  │'),
  (19, 'payroll',
   U&'$13,347  \26A0\FE0F ⋯  │',
   '$13,347  !  ⋯  │'),
  (20, 'invoice-capture',
   U&'1-01-12345-6   \2713  │',
   '1-01-12345-6   ok │'),
  (21, 'invoice-capture',
   U&'B0100000123    \2713  │',
   'B0100000123    ok │'),
  (22, 'invoice-capture',
   U&'18/07/2026     \2713  │',
   '18/07/2026     ok │'),
  (23, 'invoice-capture',
   U&'$ 24,500.00    \2713  │',
   '$ 24,500.00    ok │'),
  (24, 'invoice-capture',
   U&'$  4,410.00    \26A0\FE0F │',
   '$  4,410.00    !  │'),
  (25, 'invoice-capture',
   U&'│   [\+01F50D Acercar]        │',
   '│   [+ Acercar]         │'),
  (26, 'invoice-capture',
   U&'│        ( \+01F4F7 )       │',
   '│       ( FOTO )      │');

create function pg_temp.sin_emojis_0175(p_modulo text, t text) returns text
language plpgsql
as $$
declare
  r record;
  s text := t;
begin
  if s is null or s = '' then
    return s;
  end if;
  for r in select e.antes, e.despues from emojis_0175 e where e.modulo = p_modulo order by e.orden loop
    s := replace(s, r.antes, r.despues);
  end loop;
  -- Red de seguridad: cualquier emoji que siga ahi, con su selector de
  -- variante (U+FE0F) si lo trae, se quita; y un selector suelto tambien.
  return regexp_replace(s, '[\u2600-\u27bf\u2139\U0001f000-\U0001faff]\ufe0f?|\ufe0f', '', 'g');
end;
$$;

update regb.module_catalog mc
set screens = (
  select jsonb_agg(
           case
             when jsonb_typeof(f->'mockup') = 'string'
               then jsonb_set(f, '{mockup}', to_jsonb(pg_temp.sin_emojis_0175(mc.id, f->>'mockup')))
             else f
           end
           order by i)
  from jsonb_array_elements(mc.screens) with ordinality as e(f, i))
where jsonb_typeof(mc.screens) = 'array'
  and jsonb_array_length(mc.screens) > 0
  and mc.screens::text ~ '[\u2600-\u27bf\u2139\ufe0f\U0001f000-\U0001faff]';

drop function pg_temp.sin_emojis_0175(text, text);
