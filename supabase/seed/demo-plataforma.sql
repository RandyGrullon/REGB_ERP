-- ═══════════════════════════════════════════════════════════════════════
--  Datos de demostración del área Plataforma
--
--  `demo.sql` deja la plataforma casi en blanco: un solo usuario (María),
--  ninguna invitación, ningún aviso en la distribuidora, empresas y
--  sucursales sin dirección ni teléfono, el gestor de archivos vacío, un
--  solo canal de chat y ninguna entrega de webhook. Así no se ve cómo
--  trabaja un negocio con equipo, ni se puede probar Usuarios, Archivos o
--  Notificaciones con algo delante.
--
--  Aquí se llena eso con datos creíbles de RD: nombres, teléfonos 809/829,
--  direcciones de Santiago y Santo Domingo y correos del propio negocio.
--
--  Reglas de este archivo:
--   · Idempotente: cada bloque tiene su ancla (un id fijo, un correo, un
--     nombre de archivo o de canal) y no hace nada si ya corrió.
--   · Lo que el dueño ya escribió no se pisa: la dirección de una empresa
--     o de una sucursal solo se pone si está vacía.
--   · Los usuarios nuevos tienen ids fijos (…0101, …0102…). María sigue
--     siendo …0001, la del modo demostración.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Empresas y sucursales: con qué se identifican en ticket y factura ──
do $$
declare
  v_med  uuid;
  v_pyme uuid;
begin
  select id into v_med  from regb.tenants where slug = 'distribuidora-caribe';
  select id into v_pyme from regb.tenants where slug = 'colmado-esperanza';
  if v_med is null or v_pyme is null then
    raise notice 'demo-plataforma: falta la demo base (demo.sql); no se hace nada';
    return;
  end if;

  update public.companies set
    address = 'Av. Estrella Sadhalá #45, Santiago de los Caballeros',
    phone   = '809-582-4410',
    email   = 'facturacion@distribuidoracaribe.do',
    trade_name = coalesce(trade_name, 'Distribuidora Caribe')
  where tenant_id = v_med and legal_name = 'Distribuidora Caribe SRL' and address is null;

  update public.companies set
    address = 'Carretera Duarte km 3½, Santiago de los Caballeros',
    phone   = '809-582-7730',
    email   = 'despachos@transportescaribe.do'
  where tenant_id = v_med and legal_name = 'Transportes Caribe SRL' and address is null;

  update public.companies set
    address = 'C/ Duarte #12, Villa Consuelo, Santo Domingo',
    phone   = '809-221-3344',
    email   = 'colmadolaesperanza@gmail.com',
    trade_name = coalesce(trade_name, 'Colmado La Esperanza')
  where tenant_id = v_pyme and legal_name = 'Colmado La Esperanza SRL' and address is null;

  update public.branches set address = 'Av. Estrella Sadhalá #45, Santiago de los Caballeros'
  where tenant_id = v_med and code = 'STI' and address is null;
  update public.branches set address = 'Av. John F. Kennedy #110, Ensanche Miraflores, Santo Domingo'
  where tenant_id = v_med and code = 'SD' and address is null;
  update public.branches set address = 'C/ Duarte #12, Villa Consuelo, Santo Domingo'
  where tenant_id = v_pyme and code = 'VC' and address is null;
end $$;

-- ── El equipo: quién más trabaja en cada negocio ───────────────────────
do $$
declare
  v_med  uuid;
  v_pyme uuid;
  v_sd   uuid;
  v_maria constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  select id into v_med  from regb.tenants where slug = 'distribuidora-caribe';
  select id into v_pyme from regb.tenants where slug = 'colmado-esperanza';
  if v_med is null or v_pyme is null then return; end if;
  select id into v_sd from public.branches where tenant_id = v_med and code = 'SD';

  insert into public.user_profiles (tenant_id, user_id, display_name, email, phone, job_title)
  values
    (v_med, '00000000-0000-0000-0000-000000000101', 'José Manuel Peña',
     'jose.pena@distribuidoracaribe.do', '809-582-4411', 'Contador'),
    (v_med, '00000000-0000-0000-0000-000000000102', 'Yolanda Cabrera',
     'yolanda.cabrera@distribuidoracaribe.do', '829-347-1120', 'Cajera'),
    (v_med, '00000000-0000-0000-0000-000000000103', 'Luis Alberto Taveras',
     'luis.taveras@distribuidoracaribe.do', '849-201-5566', 'Vendedor de ruta'),
    (v_med, '00000000-0000-0000-0000-000000000104', 'Ramón Antonio Reyes',
     'ramon.reyes@distribuidoracaribe.do', '809-971-3308', 'Encargado de almacén'),
    (v_med, '00000000-0000-0000-0000-000000000105', 'Carmen Julia Almonte',
     'carmen.almonte@distribuidoracaribe.do', '829-583-0045', 'Recursos humanos'),
    (v_med, '00000000-0000-0000-0000-000000000106', 'Pedro Guzmán',
     'pedro.guzman@distribuidoracaribe.do', '809-532-7781', 'Gerente de la sucursal Santo Domingo'),
    (v_med, '00000000-0000-0000-0000-000000000107', 'Rosa Elena Díaz',
     'rosa.diaz@distribuidoracaribe.do', '809-582-4412', 'Administradora'),
    (v_med, '00000000-0000-0000-0000-000000000108', 'Kelvin Santana',
     'kelvin.santana@distribuidoracaribe.do', '849-655-2290', 'Vendedor'),
    (v_pyme, '00000000-0000-0000-0000-000000000201', 'Juan Carlos Pimentel',
     'jcpimentel@gmail.com', '829-440-1187', 'Cajero'),
    (v_pyme, '00000000-0000-0000-0000-000000000202', 'Altagracia Méndez',
     'altagraciamendez@gmail.com', '809-686-2231', 'Encargada')
  on conflict (tenant_id, user_id) do nothing;

  -- El rol se busca por nombre dentro del cliente. Kelvin ya no trabaja
  -- aquí: su acceso queda desactivado, que es lo que se hace en vez de
  -- borrar a alguien (su historial sigue firmado con su nombre).
  insert into public.memberships
    (tenant_id, user_id, role_id, branch_ids, is_active, invited_at, accepted_at)
  select v_med, u.uid::uuid, r.id,
         case when u.rol = 'Gerente de Sucursal' and v_sd is not null
              then array[v_sd] else '{}'::uuid[] end,
         u.activo, now() - u.hace, now() - u.hace + interval '1 day'
  from (values
    ('00000000-0000-0000-0000-000000000101', 'Contador',            true,  interval '5 months'),
    ('00000000-0000-0000-0000-000000000102', 'Cajero',              true,  interval '4 months'),
    ('00000000-0000-0000-0000-000000000103', 'Vendedor',            true,  interval '4 months'),
    ('00000000-0000-0000-0000-000000000104', 'Almacenista',         true,  interval '5 months'),
    ('00000000-0000-0000-0000-000000000105', 'RRHH',                true,  interval '3 months'),
    ('00000000-0000-0000-0000-000000000106', 'Gerente de Sucursal', true,  interval '2 months'),
    ('00000000-0000-0000-0000-000000000107', 'Admin',               true,  interval '5 months'),
    ('00000000-0000-0000-0000-000000000108', 'Vendedor',            false, interval '4 months')
  ) as u(uid, rol, activo, hace)
  join public.roles r on r.tenant_id = v_med and r.name = u.rol
  on conflict (tenant_id, user_id) do nothing;

  insert into public.memberships
    (tenant_id, user_id, role_id, is_active, invited_at, accepted_at)
  select v_pyme, u.uid::uuid, r.id, true, now() - interval '3 months',
         now() - interval '3 months' + interval '1 day'
  from (values
    ('00000000-0000-0000-0000-000000000201', 'Cajero'),
    ('00000000-0000-0000-0000-000000000202', 'Admin')
  ) as u(uid, rol)
  join public.roles r on r.tenant_id = v_pyme and r.name = u.rol
  on conflict (tenant_id, user_id) do nothing;

  -- Dos invitaciones esperando: la persona todavía no abrió el enlace.
  -- El token de verdad no se guarda (solo su huella): "Reenviar" genera
  -- uno nuevo, que es justo lo que haría el dueño.
  insert into public.user_invitations
    (tenant_id, email, display_name, role_id, token_hash, status, expires_at,
     invited_by, sent_at, send_count, created_at)
  select v_med, i.correo, i.nombre, r.id,
         encode(sha256(convert_to('demo-plataforma:' || i.correo, 'UTF8')), 'hex'),
         'pending', now() + i.vence, v_maria, now() - i.hace, 1, now() - i.hace
  from (values
    ('franklin.santos@distribuidoracaribe.do', 'Franklin Santos', 'Vendedor',
     interval '2 days', interval '5 days'),
    ('ana.mejia@distribuidoracaribe.do', 'Ana Mejía', 'Comprador',
     interval '6 hours', interval '6 days 18 hours')
  ) as i(correo, nombre, rol, hace, vence)
  join public.roles r on r.tenant_id = v_med and r.name = i.rol
  where not exists (
    select 1 from public.user_invitations x
    where x.tenant_id = v_med and x.email = i.correo);
end $$;

-- ── Avisos: lo que el negocio le dice al dueño y al equipo ─────────────
do $$
declare
  v_med  uuid;
  v_pyme uuid;
  v_maria constant uuid := '00000000-0000-0000-0000-000000000001';
  v_bienvenida uuid;
begin
  select id into v_med  from regb.tenants where slug = 'distribuidora-caribe';
  select id into v_pyme from regb.tenants where slug = 'colmado-esperanza';
  if v_med is null or v_pyme is null then return; end if;

  insert into public.notifications (tenant_id, user_id, module_id, title, body, link, created_at)
  select v_med, n.para, n.modulo, n.titulo, n.cuerpo, n.enlace, now() - n.hace
  from (values
    (v_maria, 'ar', 'Ferretería El Martillo SRL pasó de 90 días',
     'Su factura vencida ya está en el tramo de más riesgo. Llámala antes de que pase a incobrable.',
     '/cobrar', interval '3 hours'),
    (null::uuid, 'inventory', 'Hay productos por debajo del punto de reorden',
     'Revisa las existencias de Santiago antes del despacho del lunes.',
     '/inventory', interval '1 day'),
    (null::uuid, 'time-off', 'Solicitudes de vacaciones esperando aprobación',
     'Carmen Julia Almonte (RRHH) dejó las solicitudes listas para que las revises.',
     '/vacaciones', interval '2 days'),
    (v_maria, 'backup', 'Tu respaldo del mes está pendiente',
     'Crea un respaldo y guárdalo fuera de REGB: en una memoria o en tu correo.',
     '/respaldos', interval '4 days'),
    (null::uuid, 'core', 'Bienvenidos a REGB, equipo de Distribuidora Caribe',
     'Cada quien entra con su rol. Si algo no te aparece, pregúntale a Rosa Elena Díaz.',
     '/perfil', interval '5 months')
  ) as n(para, modulo, titulo, cuerpo, enlace, hace)
  where not exists (
    select 1 from public.notifications x where x.tenant_id = v_med and x.title = n.titulo);

  -- La bienvenida ya la leyó María: así se ve la diferencia entre leído
  -- y pendiente, y el contador de la campana no cuenta lo viejo.
  select id into v_bienvenida from public.notifications
  where tenant_id = v_med and title = 'Bienvenidos a REGB, equipo de Distribuidora Caribe';
  if v_bienvenida is not null then
    insert into public.notification_reads (tenant_id, notification_id, user_id, read_at)
    values (v_med, v_bienvenida, v_maria, now() - interval '5 months')
    on conflict do nothing;
  end if;

  insert into public.notifications (tenant_id, user_id, module_id, title, body, link, created_at)
  select v_pyme, null, 'pos', 'Cuadre de caja con diferencia',
         'El turno de anoche cerró con RD$ 150.00 de menos. Revísalo con Juan Carlos.',
         '/pos', now() - interval '10 hours'
  where not exists (
    select 1 from public.notifications x
    where x.tenant_id = v_pyme and x.title = 'Cuadre de caja con diferencia');
end $$;

-- ── Archivos: los documentos que el negocio guarda a mano ──────────────
do $$
declare
  v_med  uuid;
  v_rosa constant uuid := '00000000-0000-0000-0000-000000000107';
  v_maria constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  insert into public.files
    (tenant_id, name, mime, size_bytes, content, module_id, uploaded_by, deleted_at, created_at)
  select v_med, f.nombre, f.mime, length(f.contenido), f.contenido, 'files', f.quien, f.borrado,
         now() - f.hace
  from (values
    ('Contrato de distribución Cementos del Cibao 2026.pdf', 'application/pdf',
     decode('255044462d312e340a312030206f626a0a3c3c202f54797065202f436174616c6f67202f5061676573203220302052203e3e0a656e646f626a0a322030206f626a0a3c3c202f54797065202f5061676573202f4b696473205b33203020525d202f436f756e742031203e3e0a656e646f626a0a332030206f626a0a3c3c202f54797065202f50616765202f506172656e74203220302052202f4d65646961426f78205b30203020363132203739325d202f436f6e74656e7473203420302052202f5265736f7572636573203c3c202f466f6e74203c3c202f4631203520302052203e3e203e3e203e3e0a656e646f626a0a342030206f626a0a3c3c202f4c656e67746820343836203e3e0a73747265616d0a4254202f4631203136205466203536203738302054642028436f6e747261746f2064652064697374726962756369f36e206578636c75736976612920546a2045540a4254202f4631203131205466203536203735382054642028456e7472652043656d656e746f732064656c20436962616f2053524c207920446973747269627569646f7261204361726962652053524c205c28524e4320312d33312d34353637382d325c292920546a2045540a4254202f4631203131205466203536203733362054642028566967656e6369613a2064656c203120646520656e65726f20616c2033312064652064696369656d62726520646520323032362920546a2045540a4254202f46312031312054662035362037313420546420285a6f6e613a2053616e746961676f2c2050756572746f20506c6174612079204d6f63612920546a2045540a4254202f4631203131205466203536203639322054642028436f6e646963696f6e65733a206372e96469746f20612033302064ed6173207920342025206465206465736375656e746f20706f7220766f6c756d656e2920546a2045540a4254202f46312031312054662035362036373020546420284669726d61646f20656e2053616e746961676f206465206c6f7320436162616c6c65726f732e2920546a2045540a656e6473747265616d0a656e646f626a0a352030206f626a0a3c3c202f54797065202f466f6e74202f53756274797065202f5479706531202f42617365466f6e74202f48656c766574696361202f456e636f64696e67202f57696e416e7369456e636f64696e67203e3e0a656e646f626a0a787265660a3020360a303030303030303030302036353533352066200a30303030303030303039203030303030206e200a30303030303030303538203030303030206e200a30303030303030313135203030303030206e200a30303030303030323431203030303030206e200a30303030303030373738203030303030206e200a747261696c65720a3c3c202f53697a652036202f526f6f74203120302052203e3e0a7374617274787265660a3837350a2525454f460a', 'hex'), v_maria, null::timestamptz, interval '8 months'),
    ('Certificación RNC Distribuidora Caribe.pdf', 'application/pdf',
     decode('255044462d312e340a312030206f626a0a3c3c202f54797065202f436174616c6f67202f5061676573203220302052203e3e0a656e646f626a0a322030206f626a0a3c3c202f54797065202f5061676573202f4b696473205b33203020525d202f436f756e742031203e3e0a656e646f626a0a332030206f626a0a3c3c202f54797065202f50616765202f506172656e74203220302052202f4d65646961426f78205b30203020363132203739325d202f436f6e74656e7473203420302052202f5265736f7572636573203c3c202f466f6e74203c3c202f4631203520302052203e3e203e3e203e3e0a656e646f626a0a342030206f626a0a3c3c202f4c656e67746820343230203e3e0a73747265616d0a4254202f46312031362054662035362037383020546420284365727469666963616369f36e2064656c20526567697374726f204e6163696f6e616c20646520436f6e747269627579656e7465732920546a2045540a4254202f463120313120546620353620373538205464202852617af36e20736f6369616c3a20446973747269627569646f7261204361726962652053524c2920546a2045540a4254202f4631203131205466203536203733362054642028524e433a20312d33312d34353637382d322920546a2045540a4254202f46312031312054662035362037313420546420284163746976696461643a2076656e746120616c20706f72206d61796f72206465206d6174657269616c657320646520636f6e73747275636369f36e2920546a2045540a4254202f463120313120546620353620363932205464202845737461646f3a2061637469766f2920546a2045540a4254202f463120313120546620353620363730205464202844697265636369f36e2047656e6572616c20646520496d70756573746f7320496e7465726e6f73205c28444749495c292920546a2045540a656e6473747265616d0a656e646f626a0a352030206f626a0a3c3c202f54797065202f466f6e74202f53756274797065202f5479706531202f42617365466f6e74202f48656c766574696361202f456e636f64696e67202f57696e416e7369456e636f64696e67203e3e0a656e646f626a0a787265660a3020360a303030303030303030302036353533352066200a30303030303030303039203030303030206e200a30303030303030303538203030303030206e200a30303030303030313135203030303030206e200a30303030303030323431203030303030206e200a30303030303030373132203030303030206e200a747261696c65720a3c3c202f53697a652036202f526f6f74203120302052203e3e0a7374617274787265660a3830390a2525454f460a', 'hex'), v_rosa, null::timestamptz, interval '5 months'),
    ('Lista de precios septiembre 2026.csv', 'text/csv',
     convert_to(
       'codigo,producto,unidad,precio_rd' || chr(10) ||
       'CEM-100,Cemento gris 42.5 kg,saco,465.00' || chr(10) ||
       'VAR-200,Varilla 3/8 x 20 pies,unidad,285.00' || chr(10) ||
       'PIN-300,Pintura blanca acrílica,galón,1150.00' || chr(10), 'UTF8'),
     v_rosa, null::timestamptz, interval '29 days'),
    ('Cotización vieja Constructora Duarte.pdf', 'application/pdf',
     decode('255044462d312e340a312030206f626a0a3c3c202f54797065202f436174616c6f67202f5061676573203220302052203e3e0a656e646f626a0a322030206f626a0a3c3c202f54797065202f5061676573202f4b696473205b33203020525d202f436f756e742031203e3e0a656e646f626a0a332030206f626a0a3c3c202f54797065202f50616765202f506172656e74203220302052202f4d65646961426f78205b30203020363132203739325d202f436f6e74656e7473203420302052202f5265736f7572636573203c3c202f466f6e74203c3c202f4631203520302052203e3e203e3e203e3e0a656e646f626a0a342030206f626a0a3c3c202f4c656e67746820323636203e3e0a73747265616d0a4254202f4631203136205466203536203738302054642028436f74697a616369f36e20434f542d303030372920546a2045540a4254202f4631203131205466203536203735382054642028436c69656e74653a20436f6e7374727563746f7261204475617274652053524c2920546a2045540a4254202f463120313120546620353620373336205464202843656d656e746f20677269732034322e35206b672c20323030207361636f732920546a2045540a4254202f463120313120546620353620373134205464202856e16c69646120706f722031352064ed61732e205265656d706c617a61646120706f7220756e6120636f74697a616369f36e206e756576612e2920546a2045540a656e6473747265616d0a656e646f626a0a352030206f626a0a3c3c202f54797065202f466f6e74202f53756274797065202f5479706531202f42617365466f6e74202f48656c766574696361202f456e636f64696e67202f57696e416e7369456e636f64696e67203e3e0a656e646f626a0a787265660a3020360a303030303030303030302036353533352066200a30303030303030303039203030303030206e200a30303030303030303538203030303030206e200a30303030303030313135203030303030206e200a30303030303030323431203030303030206e200a30303030303030353538203030303030206e200a747261696c65720a3c3c202f53697a652036202f526f6f74203120302052203e3e0a7374617274787265660a3635350a2525454f460a', 'hex'), v_maria, now() - interval '3 days', interval '40 days')
  ) as f(nombre, mime, contenido, quien, borrado, hace)
  where not exists (
    select 1 from public.files x where x.tenant_id = v_med and x.name = f.nombre);
end $$;

-- ── Chat: los canales donde el equipo se coordina ──────────────────────
do $$
declare
  v_med  uuid;
  v_pyme uuid;
  v_canal uuid;
  v_padre uuid;
  v_maria  constant uuid := '00000000-0000-0000-0000-000000000001';
  v_luis   constant uuid := '00000000-0000-0000-0000-000000000103';
  v_ramon  constant uuid := '00000000-0000-0000-0000-000000000104';
  v_pedro  constant uuid := '00000000-0000-0000-0000-000000000106';
begin
  select id into v_med  from regb.tenants where slug = 'distribuidora-caribe';
  select id into v_pyme from regb.tenants where slug = 'colmado-esperanza';
  if v_med is null or v_pyme is null then return; end if;

  -- Almacén Santiago: el despacho del día, con un hilo de respuestas.
  if not exists (select 1 from public.chat_channels
                 where tenant_id = v_med and name = 'Almacén Santiago') then
    insert into public.chat_channels (tenant_id, name, scope_type, scope_label, created_by, created_at)
    values (v_med, 'Almacén Santiago', 'branch', 'Santiago', v_ramon, now() - interval '3 months')
    returning id into v_canal;

    insert into public.chat_messages
      (tenant_id, channel_id, author_id, body, mentioned_user_ids, created_at)
    values (v_med, v_canal, v_ramon,
            'Llegó el camión de Cementos del Cibao: 400 sacos. Faltan 20 contra la orden, ya lo anoté en la recepción.',
            array[v_maria], now() - interval '26 hours')
    returning id into v_padre;

    insert into public.chat_messages
      (tenant_id, channel_id, parent_message_id, author_id, body, created_at)
    values
      (v_med, v_canal, v_padre, v_maria,
       'Gracias, Ramón. Reclámale los 20 sacos al proveedor y que venga la nota de crédito.',
       now() - interval '25 hours'),
      (v_med, v_canal, v_padre, v_ramon,
       'Hecho. Dicen que los mandan el jueves.', now() - interval '24 hours');

    insert into public.chat_messages
      (tenant_id, channel_id, author_id, body, created_at)
    values (v_med, v_canal, v_luis,
            'Mañana salgo temprano para Moca con el pedido de Constructora Duarte. Ramón, ¿me lo dejas listo en el andén 2?',
            now() - interval '3 hours');
  end if;

  -- Ventas: coordinación entre sucursales.
  if not exists (select 1 from public.chat_channels
                 where tenant_id = v_med and name = 'Ventas') then
    insert into public.chat_channels (tenant_id, name, scope_type, scope_label, created_by, created_at)
    values (v_med, 'Ventas', 'module', 'Pedidos y cotizaciones', v_maria, now() - interval '4 months')
    returning id into v_canal;

    insert into public.chat_messages
      (tenant_id, channel_id, author_id, body, mentioned_user_ids, created_at)
    values
      (v_med, v_canal, v_pedro,
       'En Santo Domingo nos están pidiendo varilla de 1/2. ¿Hay en Santiago para una transferencia?',
       array[v_ramon], now() - interval '2 days'),
      (v_med, v_canal, v_maria,
       'Recuerden: ningún crédito nuevo sin revisar la cartera primero. Ferretería El Martillo sigue atrasada.',
       '{}'::uuid[], now() - interval '20 hours');
  end if;

end $$;

-- ── API y webhooks: el historial de entregas del destino que ya existe ─
do $$
declare
  v_med uuid;
  v_endpoint uuid;
  v_evento bigint;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  select id into v_endpoint from public.webhook_endpoints
  where tenant_id = v_med and status = 'active' order by created_at limit 1;
  select id into v_evento from public.event_outbox
  where tenant_id = v_med and type = 'helpdesk.ticket.resolved' order by id desc limit 1;
  if v_endpoint is null or v_evento is null then return; end if;

  -- Una entrega por destino y evento (la base no guarda reintentos
  -- aparte): el ticket resuelto llegó bien al sistema del cliente.
  insert into public.webhook_deliveries
    (tenant_id, endpoint_id, event_id, status_code, success, response_body, attempted_at)
  values (v_med, v_endpoint, v_evento, 200, true, 'OK', now() - interval '2 days')
  on conflict (endpoint_id, event_id) do nothing;
end $$;

-- ── Copiloto: preguntas que ya hizo el dueño ───────────────────────────
do $$
declare
  v_med uuid;
  v_maria constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  insert into public.copilot_queries
    (tenant_id, user_id, question, matched_key, answer_summary, created_at)
  select v_med, v_maria, q.pregunta, q.clave, q.resumen, now() - q.hace
  from (values
    ('¿Qué facturas están vencidas?', 'overdue_invoices',
     'Tienes 2 factura(s) vencida(s) por RD$ 39,264.00 en total.', interval '2 days'),
    ('¿Cuántos tickets urgentes hay?', 'tickets_by_priority',
     '1 con prioridad alta', interval '6 days')
  ) as q(pregunta, clave, resumen, hace)
  where not exists (
    select 1 from public.copilot_queries x where x.tenant_id = v_med and x.question = q.pregunta);
end $$;

-- ── Avisos que el despachador escribió con el texto de antes ───────────
--  El aviso de "pedido entregado sin facturar" enseñaba el uuid del
--  pedido, y otros iban sin tildes. El despachador ya escribe bien los
--  nuevos (lib/despachador.ts); aquí se corrigen los que ya estaban en la
--  demo. Idempotente: solo toca los que siguen con el texto viejo.
update public.notifications n
set body = 'El pedido ' || o.number || ' ya se entregó. Emítele la factura para que entre a la cartera y al 607.'
from public.sales_orders o, regb.tenants t
where t.id = n.tenant_id and t.slug in ('distribuidora-caribe', 'colmado-esperanza')
  and o.tenant_id = n.tenant_id
  and n.title = 'Hay un pedido entregado sin facturar'
  and n.body like 'El pedido ' || o.id::text || '%';

update public.notifications n
set title = 'Hay líneas prometidas sin existencia',
    body  = regexp_replace(n.body, '^([0-9]+) linea\(s\) en backorder\.',
                           '\1 línea(s) de pedidos esperando mercancía.')
from regb.tenants t
where t.id = n.tenant_id and t.slug in ('distribuidora-caribe', 'colmado-esperanza')
  and n.title = 'Hay lineas prometidas sin existencia';

update public.notifications n
set title = replace(replace(n.title, 'Falto efectivo', 'Faltó efectivo'), 'Sobro efectivo', 'Sobró efectivo')
from regb.tenants t
where t.id = n.tenant_id and t.slug in ('distribuidora-caribe', 'colmado-esperanza')
  and (n.title like 'Falto efectivo%' or n.title like 'Sobro efectivo%');

update public.notifications n
set body = 'Se vendió y quedaron por debajo del mínimo que fijaste. Repón antes de quedarte sin qué vender.'
from regb.tenants t
where t.id = n.tenant_id and t.slug in ('distribuidora-caribe', 'colmado-esperanza')
  and n.body = 'Se vendio y quedaron por debajo del minimo que fijaste. Repon antes de quedarte sin que vender.';
