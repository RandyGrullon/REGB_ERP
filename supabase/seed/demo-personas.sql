-- ═══════════════════════════════════════════════════════════════════════
--  Datos de demostración del área de Personas y proyectos
--
--  `demo.sql` dejaba RRHH con tres empleados, el portal del empleado sin
--  nadie vinculado (el rol Empleado no veía nada suyo), la asistencia y
--  los 1:1 "de hoy" congelados en el día en que se sembró, una vacante
--  cerrada sin un solo candidato, un solo proyecto con un hito vencido
--  ANTES de que empezara, y nombres sin tilde (Encarnacion, Ramirez,
--  Jimenez, "Seguro Salud Basico", "Atencion al cliente").
--
--  Aquí se completa, con datos creíbles de RD: cédulas que pasan el dígito
--  verificador, montos en RD$, nombres y teléfonos dominicanos.
--
--  Reglas de este archivo:
--   · Idempotente: cada bloque tiene su ancla (un código de empleado, un
--     nombre propio de ESTE archivo, un "not exists") y no repite nada.
--   · No toca las anclas de `demo.sql`: el nombre del proyecto
--     "Renovación bodega principal" se queda como está porque demo.sql lo
--     busca por nombre y, si cambiara, lo duplicaría en la próxima corrida.
--     Sí se corrigen textos que demo.sql solo usa al crear (apellidos,
--     tareas, conceptos, anuncios...).
--   · Las fechas son relativas al día en que corre (hora de RD, UTC-4),
--     igual que demo.sql, para que "hoy" siempre sea hoy.
--   · Nada de nómina procesada nueva: un período procesado es inmutable, y
--     los empleados nuevos entran este mes, así que el de agosto sigue
--     cuadrando con quien de verdad trabajaba entonces.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Tildes en los datos que ya sembró demo.sql ──────────────────────
do $$
declare
  v_med uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  update public.employees set last_name = 'Encarnación'
   where tenant_id = v_med and code = 'E-001' and last_name = 'Encarnacion';
  update public.employees set last_name = 'Ramírez'
   where tenant_id = v_med and code = 'E-003' and last_name = 'Ramirez';
  update public.employees set department = 'Dirección'
   where tenant_id = v_med and department = 'Dirección';

  update public.recruiting_candidates set last_name = 'Jiménez', phone = coalesce(phone, '809-555-0143')
   where tenant_id = v_med and first_name = 'Carla' and last_name in ('Jimenez', 'Jiménez');
  update public.recruiting_candidates set phone = '829-555-0178'
   where tenant_id = v_med and first_name = 'Miguel' and last_name = 'Santana' and phone is null;
  update public.recruiting_positions set department = 'Administración'
   where tenant_id = v_med and department = 'Administracion';
  update public.recruiting_positions
     set description = 'Atención al cliente y ventas en la sucursal de Santo Domingo.'
   where tenant_id = v_med and description = 'Atencion al cliente y ventas en la sucursal de Santo Domingo.';
  update public.recruiting_positions
     set description = 'Contabilidad general, conciliaciones bancarias y declaraciones a la DGII (IT-1, IR-17, 606 y 607).'
   where tenant_id = v_med and title = 'Contador' and description is null;
  update public.recruiting_interviews set interviewer_name = 'Rafael Encarnación'
   where tenant_id = v_med and interviewer_name = 'Rafael Encarnacion';

  update public.performance_objectives set title = 'Mejorar la satisfacción del cliente'
   where tenant_id = v_med and title = 'Mejorar la satisfaccion del cliente';
  update public.performance_key_results set description = 'Encuestas de satisfacción completadas'
   where tenant_id = v_med and description = 'Encuestas de satisfaccion completadas';
  update public.performance_key_results set description = 'Calificación promedio de satisfacción'
   where tenant_id = v_med and description = 'Calificacion promedio de satisfaccion';
  -- Las evaluaciones ya enviadas son inmutables (trigger): su texto se
  -- queda como lo escribió quien evaluó.
  update public.performance_improvement_plans set goals = 'Llegar a tiempo las próximas 4 semanas'
   where tenant_id = v_med and goals = 'Llegar a tiempo las proximas 4 semanas';

  update public.training_courses set title = 'Atención al cliente'
   where tenant_id = v_med and title = 'Atencion al cliente';
  update public.training_competencies set name = 'Atención al cliente'
   where tenant_id = v_med and name = 'Atencion al cliente';

  update public.benefit_enrollments set plan_name = 'Seguro Salud Básico'
   where tenant_id = v_med and plan_name = 'Seguro Salud Basico';

  update public.hr_announcements
     set body = 'El viernes de cierre de mes trabajamos hasta las 5:00 p. m. (una hora menos que lo usual) para el corte de caja.'
   where tenant_id = v_med and title = 'Horario especial fin de mes' and body like '%-una hora menos%';
  -- demo.sql los publica a la hora en que corre la siembra (a veces de
  -- madrugada): un anuncio de RRHH sale en horario de oficina.
  update public.hr_announcements
     set published_at = ((published_at - interval '4 hours')::date::text || ' 09:15:00-04')::timestamptz
   where tenant_id = v_med
     and extract(hour from (published_at - interval '4 hours')) not between 7 and 18;
  update public.hr_announcements
     set title = 'Nueva política de vacaciones',
         body = 'A partir de este año, las vacaciones se solicitan con al menos 2 semanas de anticipación desde el portal.'
   where tenant_id = v_med and title = 'Nueva politica de vacaciones';

  -- Proyecto: solo textos que demo.sql no usa como ancla.
  update public.projects
     set description = 'Vaciar, pintar e instalar estantería nueva en la bodega de Bella Vista.'
   where tenant_id = v_med and description = 'Vaciar, pintar e instalar estanteria nueva en la bodega de Bella Vista.';
  update public.project_tasks set name = 'Instalar estantería nueva'
   where tenant_id = v_med and name = 'Instalar estanteria nueva';
  update public.project_budgets set concept = 'Estantería metálica'
   where tenant_id = v_med and concept = 'Estanteria metalica';
end $$;


-- ── 2. Dos personas más en el expediente ───────────────────────────────
--  · María Rosario, la dueña: se puso en nómina ESTE mes (para cotizar a
--    la TSS). Su cuenta (la de la demo) queda vinculada a su expediente,
--    así el rol Empleado ve SU portal y no un "sin vincular" vacío.
--    Rafael pasa a reportarle a ella.
--  · Luis Almonte, el contador que salió de la vacante "Contador" (que ya
--    está cerrada): entró hace 12 días.
do $$
declare
  v_med     uuid;
  v_maria   constant uuid := '00000000-0000-0000-0000-000000000001';
  v_rafael  uuid;
  v_emp     uuid;
  v_ingreso date;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  select id into v_rafael from public.employees where tenant_id = v_med and code = 'E-001';
  if v_rafael is null then return; end if;

  if not exists (select 1 from public.employees where tenant_id = v_med and code = 'E-004') then
    v_ingreso := date_trunc('month', (now() - interval '4 hours'))::date;
    -- Si la cuenta de la demo ya quedó vinculada a otro expediente (RRHH
    -- la vinculó en vivo), no se le quita: el expediente nace sin vínculo.
    insert into public.employees
      (tenant_id, code, first_name, last_name, national_id, hire_date, position, department,
       salary, email, phone, user_id)
    values (v_med, 'E-004', 'María', 'Rosario', '001-0456789-6', v_ingreso, 'Presidenta', 'Dirección',
            150000.00, 'maria.rosario@distribuidoracaribe.do', '809-555-0101',
            case when exists (select 1 from public.employees
                               where tenant_id = v_med and user_id = v_maria)
                 then null else v_maria end)
    returning id into v_emp;

    insert into public.employee_contracts (tenant_id, employee_id, contract_type, start_date, salary, position)
    values (v_med, v_emp, 'indefinido', v_ingreso, 150000.00, 'Presidenta');

    update public.employees set manager_id = v_emp
     where id = v_rafael and manager_id is null;
  end if;

  if not exists (select 1 from public.employees where tenant_id = v_med and code = 'E-005') then
    v_ingreso := (now() - interval '4 hours')::date - 12;
    insert into public.employees
      (tenant_id, code, first_name, last_name, national_id, hire_date, position, department,
       manager_id, salary, email, phone)
    values (v_med, 'E-005', 'Luis', 'Almonte', '402-0318765-9', v_ingreso, 'Contador', 'Administración',
            v_rafael, 55000.00, 'luis.almonte@distribuidoracaribe.do', '829-555-0164')
    returning id into v_emp;

    insert into public.employee_contracts (tenant_id, employee_id, contract_type, start_date, salary, position)
    values (v_med, v_emp, 'indefinido', v_ingreso, 55000.00, 'Contador');
  end if;

  -- El chofer que crea demo-operacion.sql (E-020, Wilson) llega sin jefe
  -- ni contrato: en el organigrama salía suelto, al lado de la dueña, y
  -- su ficha con el historial de contratos vacío. Reporta a Rafael.
  update public.employees set manager_id = v_rafael
   where tenant_id = v_med and code = 'E-020' and manager_id is null;
  insert into public.employee_contracts (tenant_id, employee_id, contract_type, start_date, salary, position)
  select v_med, e.id, 'indefinido', e.hire_date, e.salary, e.position
  from public.employees e
  where e.tenant_id = v_med and e.code = 'E-020'
    and not exists (select 1 from public.employee_contracts c where c.employee_id = e.id);
  -- Si demo-operacion.sql le movió la fecha de ingreso, el contrato la sigue.
  update public.employee_contracts c
     set start_date = e.hire_date
    from public.employees e
   where e.id = c.employee_id and e.tenant_id = v_med and e.code = 'E-020'
     and c.start_date <> e.hire_date
     and (select count(*) from public.employee_contracts x where x.employee_id = e.id) = 1;
end $$;


-- ── 3. Asistencia de la última semana ──────────────────────────────────
--  demo.sql marca UN día (el de la siembra) y una semana después la
--  pantalla decía "0 entradas hoy" y un marcaje abierto de hace 7 días.
--  Aquí: la semana laboral hasta hoy, con llegadas a tiempo y algunas
--  tardanzas (Yolanda tiene un plan de mejora por eso), salidas con hora
--  extra, y UNA salida olvidada de ayer (Luis) para ver cómo se ve.
do $$
declare
  v_med      uuid;
  v_hoy      date := (now() - interval '4 hours')::date;
  v_dia      date;
  v_emp      record;
  v_n        integer;
  v_entrada  timestamptz;
  v_salida   timestamptz;
  v_min_in   integer;
  v_min_out  integer;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  -- Un marcaje abierto de un día anterior que nadie cerró (el de demo.sql)
  -- se cierra con su jornada: si no, el empleado no puede volver a marcar.
  -- La única salida olvidada queda la de Luis, a propósito, más abajo.
  update public.attendance_records ar
     set check_out = ar.check_in + interval '9 hours 5 minutes'
   where ar.tenant_id = v_med and ar.check_out is null
     and (ar.check_in - interval '4 hours')::date < v_hoy
     and not exists (select 1 from public.employees e
                      where e.id = ar.employee_id and e.code = 'E-005');

  for v_emp in
    select e.id, e.code, e.hire_date from public.employees e
    where e.tenant_id = v_med and e.code in ('E-001', 'E-002', 'E-003', 'E-005', 'E-020')
      and e.status = 'active'
  loop
    v_n := 0;
    v_dia := v_hoy;
    -- Hoy y los 5 días laborables anteriores.
    while v_n < 6 loop
      if extract(dow from v_dia) not in (0, 6) and v_dia >= v_emp.hire_date then
        -- Minutos después de las 7:00: casi todos entre 7:48 y 8:08;
        -- Yolanda llega tarde uno de cada tres días, Anthony hoy. El chofer
        -- entra a las 7:10 para cargar el camión y sale a las 4:00.
        v_min_in := case v_emp.code
          when 'E-020' then 8 + extract(day from v_dia)::int % 6
          when 'E-001' then 50 + (extract(day from v_dia)::int % 4) * 3
          when 'E-002' then case when extract(day from v_dia)::int % 3 = 0 then 82 else 58 + extract(day from v_dia)::int % 5 end
          when 'E-003' then case when v_dia = v_hoy then 82 else 55 + extract(day from v_dia)::int % 6 end
          else 52 + extract(day from v_dia)::int % 7
        end;
        -- Salida: 17:00 más un rato; Rafael se queda hasta tarde los lunes.
        v_min_out := case
          when v_emp.code = 'E-001' and extract(dow from v_dia) = 1 then 150
          when v_emp.code = 'E-002' then 5 + extract(day from v_dia)::int % 20
          when v_emp.code = 'E-020' then -55 + extract(day from v_dia)::int % 10
          else extract(day from v_dia)::int % 35
        end;
        v_entrada := (v_dia::text || ' 07:00:00-04')::timestamptz + make_interval(mins => v_min_in);
        v_salida  := (v_dia::text || ' 17:00:00-04')::timestamptz + make_interval(mins => v_min_out);

        if not exists (
          select 1 from public.attendance_records
          where tenant_id = v_med and employee_id = v_emp.id
            and (check_in - interval '4 hours')::date = v_dia
        ) and v_entrada <= now() then
          if v_dia = v_hoy then
            -- Hoy: adentro todavía (sin salida). Luis no marca hoy: tiene
            -- la de ayer abierta y el sistema no deja dos a la vez.
            if v_emp.code <> 'E-005' and not exists (
              select 1 from public.attendance_records
              where tenant_id = v_med and employee_id = v_emp.id and check_out is null
            ) then
              insert into public.attendance_records
                (tenant_id, employee_id, check_in, check_in_method, check_in_lat, check_in_lng, within_geofence)
              values (v_med, v_emp.id, v_entrada, 'geofence', 18.486070, -69.931190, true);
            end if;
          elsif v_emp.code = 'E-005' and v_n = 1 then
            -- Ayer: entró y se le olvidó marcar la salida.
            if not exists (
              select 1 from public.attendance_records
              where tenant_id = v_med and employee_id = v_emp.id and check_out is null
            ) then
              insert into public.attendance_records
                (tenant_id, employee_id, check_in, check_in_method, check_in_lat, check_in_lng, within_geofence)
              values (v_med, v_emp.id, v_entrada, 'geofence', 18.486040, -69.931230, true);
            end if;
          else
            insert into public.attendance_records
              (tenant_id, employee_id, check_in, check_out, check_in_method, check_in_lat, check_in_lng, within_geofence)
            values (v_med, v_emp.id, v_entrada, v_salida,
                    case when v_emp.code = 'E-001' and extract(dow from v_dia) = 3 then 'manual' else 'geofence' end,
                    case when v_emp.code = 'E-001' and extract(dow from v_dia) = 3 then null else 18.486080 end,
                    case when v_emp.code = 'E-001' and extract(dow from v_dia) = 3 then null else -69.931210 end,
                    case when v_emp.code = 'E-001' and extract(dow from v_dia) = 3 then null else true end);
          end if;
        end if;
        v_n := v_n + 1;
      elsif extract(dow from v_dia) not in (0, 6) then
        v_n := v_n + 1;
      end if;
      v_dia := v_dia - 1;
    end loop;
  end loop;

  -- La sucursal de Santiago también tiene su geocerca (Av. 27 de Febrero).
  insert into public.attendance_geofences (tenant_id, branch_id, latitude, longitude, radius_meters)
  select v_med, b.id, 19.451540, -70.697010, 120
  from public.branches b
  where b.tenant_id = v_med and b.name = 'Santiago'
  on conflict (tenant_id, branch_id) do nothing;
end $$;


-- ── 4. Vacaciones, permisos y gastos de las personas nuevas ────────────
do $$
declare
  v_med     uuid;
  v_hoy     date := (now() - interval '4 hours')::date;
  v_maria   uuid;
  v_yolanda uuid;
  v_luis    uuid;
  v_dia     date;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  select id into v_maria   from public.employees where tenant_id = v_med and code = 'E-004';
  select id into v_yolanda from public.employees where tenant_id = v_med and code = 'E-002';
  select id into v_luis    from public.employees where tenant_id = v_med and code = 'E-005';

  -- María: un permiso personal de un día, por aprobar (lo ve en su portal).
  if v_maria is not null and not exists (
    select 1 from public.time_off_requests where tenant_id = v_med and employee_id = v_maria
  ) then
    v_dia := v_hoy + 9;
    while extract(dow from v_dia) in (0, 6) loop v_dia := v_dia + 1; end loop;
    insert into public.time_off_requests
      (tenant_id, employee_id, leave_type, start_date, end_date, business_days, reason)
    values (v_med, v_maria, 'personal', v_dia, v_dia, 1, 'Cita médica en la mañana');
  end if;

  -- Yolanda: dos días de licencia médica el mes pasado, ya aprobados.
  if v_yolanda is not null and not exists (
    select 1 from public.time_off_requests
    where tenant_id = v_med and employee_id = v_yolanda and leave_type = 'sick'
  ) then
    v_dia := v_hoy - 35;
    while extract(dow from v_dia) not in (1, 2, 3, 4) loop v_dia := v_dia - 1; end loop;
    insert into public.time_off_requests
      (tenant_id, employee_id, leave_type, start_date, end_date, business_days, status, reason, decided_at)
    values (v_med, v_yolanda, 'sick', v_dia, v_dia + 1, 2, 'approved',
            'Licencia médica por gripe (certificado entregado)', now() - interval '34 days');
  end if;

  -- Gastos nuevos por aprobar: el de la dueña y el del contador.
  if v_maria is not null and not exists (
    select 1 from public.expenses where tenant_id = v_med and employee_id = v_maria
  ) then
    insert into public.expenses
      (tenant_id, employee_id, category, expense_date, amount, vendor_name, receipt_note)
    values (v_med, v_maria, 'travel', v_hoy - 2, 2450,
            'Estación Texaco Autopista Duarte',
            'Combustible y peaje: visita a Ferretería Cibao en Santiago');
  end if;

  if v_luis is not null and not exists (
    select 1 from public.expenses where tenant_id = v_med and employee_id = v_luis
  ) then
    insert into public.expenses
      (tenant_id, employee_id, category, expense_date, amount, vendor_name, receipt_note)
    values (v_med, v_luis, 'supplies', v_hoy - 4, 1180,
            'Librería La Trinitaria', 'Carpetas y folders para el archivo contable');
  end if;

  -- Un anuncio de esta semana, además de los dos de demo.sql.
  if not exists (
    select 1 from public.hr_announcements where tenant_id = v_med and title = 'Bienvenidos, María y Luis'
  ) then
    insert into public.hr_announcements (tenant_id, title, body, published_at)
    values (v_med, 'Bienvenidos, María y Luis',
            'Luis Almonte se une como contador, en Administración. María Rosario entra en nómina este mes. Si necesitan algo de contabilidad, a Luis le toca.',
            now() - interval '1 day');
  end if;
end $$;


-- ── 5. Reclutamiento: la vacante cerrada tuvo su proceso ───────────────
--  "Contador" estaba cerrada y sin un solo candidato: ¿de dónde salió?
--  Ahora tiene a quien se contrató (Luis Almonte, que ya está en
--  Empleados) y a quien se descartó. "Vendedor de Piso" suma una
--  candidata en filtro, y la entrevista de Carla deja de estar en el
--  pasado como "pendiente".
do $$
declare
  v_med       uuid;
  v_contador  uuid;
  v_vendedor  uuid;
  v_luis      uuid;
  v_patricia  uuid;
  v_wendy     uuid;
  v_app       uuid;
  v_proxima   timestamptz;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  select id into v_contador from public.recruiting_positions
   where tenant_id = v_med and title = 'Contador' order by created_at limit 1;
  select id into v_vendedor from public.recruiting_positions
   where tenant_id = v_med and title = 'Vendedor de Piso' order by created_at limit 1;
  if v_contador is null or v_vendedor is null then return; end if;

  select id into v_luis from public.recruiting_candidates
   where tenant_id = v_med and first_name = 'Luis' and last_name = 'Almonte';
  if v_luis is null then
    insert into public.recruiting_candidates (tenant_id, first_name, last_name, email, phone, source, notes)
    values (v_med, 'Luis', 'Almonte', 'luis.almonte.cpa@correo.do', '829-555-0164', 'referral',
            'Licenciado en Contabilidad (UASD), 6 años en firma de auditoría.')
    returning id into v_luis;
  end if;

  select id into v_patricia from public.recruiting_candidates
   where tenant_id = v_med and first_name = 'Patricia' and last_name = 'Reyes';
  if v_patricia is null then
    insert into public.recruiting_candidates (tenant_id, first_name, last_name, email, phone, source)
    values (v_med, 'Patricia', 'Reyes', 'patricia.reyes@correo.do', '809-555-0192', 'website')
    returning id into v_patricia;
  end if;

  select id into v_wendy from public.recruiting_candidates
   where tenant_id = v_med and first_name = 'Wendy' and last_name = 'Morillo';
  if v_wendy is null then
    insert into public.recruiting_candidates (tenant_id, first_name, last_name, email, phone, source)
    values (v_med, 'Wendy', 'Morillo', 'wendy.morillo@correo.do', '849-555-0127', 'website')
    returning id into v_wendy;
  end if;

  insert into public.recruiting_applications (tenant_id, position_id, candidate_id, stage, applied_at, notes)
  values (v_med, v_contador, v_luis, 'hired', now() - interval '40 days', 'Referido por el auditor externo.'),
         (v_med, v_contador, v_patricia, 'rejected', now() - interval '38 days', 'Sin experiencia en declaraciones a la DGII.'),
         (v_med, v_vendedor, v_wendy, 'screening', now() - interval '2 days', 'Trabajó 2 años en una ferretería de Los Mina.')
  on conflict (tenant_id, position_id, candidate_id) do nothing;

  select id into v_app from public.recruiting_applications
   where tenant_id = v_med and position_id = v_contador and candidate_id = v_luis;
  if v_app is not null and not exists (
    select 1 from public.recruiting_interviews where tenant_id = v_med and application_id = v_app
  ) then
    insert into public.recruiting_interviews (tenant_id, application_id, scheduled_at, interviewer_name, outcome, notes)
    values (v_med, v_app, now() - interval '30 days', 'Rafael Encarnación', 'passed',
            'Domina el 606 y el 607; conoce el sistema de la TSS.');
  end if;

  -- La entrevista pendiente de demo.sql, si ya quedó en el pasado, pasa
  -- al próximo día laborable a las 10:00 a. m. (hora de RD).
  v_proxima := ((((now() - interval '4 hours')::date + 1)::text) || ' 10:00:00-04')::timestamptz;
  while extract(dow from (v_proxima - interval '4 hours')) in (0, 6) loop
    v_proxima := v_proxima + interval '1 day';
  end loop;
  update public.recruiting_interviews
     set scheduled_at = v_proxima
   where tenant_id = v_med and outcome = 'pending' and scheduled_at < now();
end $$;


-- ── 6. Desempeño: el 1:1 agendado no se queda en el pasado ─────────────
do $$
declare
  v_med     uuid;
  v_yolanda uuid;
  v_proxima timestamptz;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;
  select id into v_yolanda from public.employees where tenant_id = v_med and code = 'E-002';

  v_proxima := ((((now() - interval '4 hours')::date + 2)::text) || ' 09:30:00-04')::timestamptz;
  while extract(dow from (v_proxima - interval '4 hours')) in (0, 6) loop
    v_proxima := v_proxima + interval '1 day';
  end loop;
  update public.performance_one_on_ones
     set scheduled_at = v_proxima
   where tenant_id = v_med and status = 'scheduled' and scheduled_at < now();

  -- Un 1:1 ya hecho con Yolanda, por el plan de mejora de puntualidad.
  if v_yolanda is not null and not exists (
    select 1 from public.performance_one_on_ones
    where tenant_id = v_med and employee_id = v_yolanda and status = 'completed'
  ) then
    insert into public.performance_one_on_ones (tenant_id, employee_id, scheduled_at, notes, action_items, status)
    values (v_med, v_yolanda, now() - interval '12 days',
            'Revisamos las llegadas tarde. El tapón de la Charles de Gaulle la retrasa; sale 20 minutos antes.',
            'Revisar la asistencia en dos semanas', 'completed');
  end if;
end $$;


-- ── 7. Proyectos: hitos con sentido, horas aprobadas y dos proyectos más ─
do $$
declare
  v_med      uuid;
  v_maria    constant uuid := '00000000-0000-0000-0000-000000000001';
  v_hoy      date := (now() - interval '4 hours')::date;
  v_proy     uuid;
  v_fin      date;
  v_t1       uuid;
  v_t2       uuid;
  v_t3       uuid;
  v_b1       uuid;
  v_b2       uuid;
begin
  select id into v_med from regb.tenants where slug = 'distribuidora-caribe';
  if v_med is null then return; end if;

  select id, end_date into v_proy, v_fin from public.projects
   where tenant_id = v_med and name = 'Renovación bodega principal';
  if v_proy is not null then
    -- "Bodega lista para operar" vencía ANTES de que empezara el proyecto.
    -- Ese hito vencido se queda (para ver el estado), pero con un nombre
    -- que cuadra: la aprobación de la compra, que se atrasó.
    update public.project_milestones set name = 'Compra de estantería aprobada'
     where tenant_id = v_med and project_id = v_proy and name = 'Bodega lista para operar'
       and completed_at is null and due_date < v_fin - 10;

    if not exists (select 1 from public.project_milestones
                    where tenant_id = v_med and project_id = v_proy and name = 'Bodega lista para operar') then
      insert into public.project_milestones (tenant_id, project_id, name, due_date)
      values (v_med, v_proy, 'Bodega lista para operar', coalesce(v_fin, v_hoy + 20));
    end if;

    -- Horas ya aprobadas en "Vaciar bodega": el facturable deja de ser RD$ 0.
    select id into v_t1 from public.project_tasks
     where tenant_id = v_med and project_id = v_proy and name = 'Vaciar bodega';
    if v_t1 is not null and not exists (
      select 1 from public.time_entries where tenant_id = v_med and task_id = v_t1 and status = 'approved'
    ) then
      insert into public.time_entries
        (tenant_id, task_id, user_id, entry_date, hours, billable, hourly_rate, status, notes, approved_by, approved_at)
      values (v_med, v_t1, v_maria, v_hoy - 3, 6, true, 350.00, 'approved',
              'Clasificar y sacar la mercancía vieja', v_maria, now() - interval '2 days'),
             (v_med, v_t1, v_maria, v_hoy - 2, 5, true, 350.00, 'approved',
              'Mover tarimas a la bodega de Herrera', v_maria, now() - interval '1 day');
    end if;

    -- Capacidad y asignación de ESTA semana (la de demo.sql quedó atrás).
    select id into v_t2 from public.project_tasks
     where tenant_id = v_med and project_id = v_proy and name = 'Pintar paredes';
    insert into public.resource_capacity (tenant_id, user_id, week_start, hours_capacity)
    values (v_med, v_maria, date_trunc('week', v_hoy)::date, 40)
    on conflict (tenant_id, user_id, week_start) do nothing;
    if v_t2 is not null then
      insert into public.resource_allocations (tenant_id, task_id, user_id, week_start, hours, created_by)
      values (v_med, v_t2, v_maria, date_trunc('week', v_hoy)::date, 16, v_maria)
      on conflict (tenant_id, task_id, user_id, week_start) do nothing;
    end if;
  end if;

  -- Un proyecto por empezar: la sucursal nueva de Santiago.
  if not exists (select 1 from public.projects where tenant_id = v_med and name = 'Apertura de sucursal en Santiago') then
    insert into public.projects (tenant_id, name, description, status, start_date, end_date, created_by)
    values (v_med, 'Apertura de sucursal en Santiago',
            'Local en la Av. Estrella Sadhalá: alquiler, remodelación y personal para abrir antes de Navidad.',
            'planning', v_hoy + 7, v_hoy + 75, v_maria)
    returning id into v_proy;

    insert into public.project_tasks (tenant_id, project_id, name, due_date, position)
    values (v_med, v_proy, 'Firmar el contrato del local', v_hoy + 12, 1) returning id into v_t1;
    insert into public.project_tasks (tenant_id, project_id, name, due_date, position)
    values (v_med, v_proy, 'Remodelar el local', v_hoy + 45, 2) returning id into v_t2;
    insert into public.project_tasks (tenant_id, project_id, name, due_date, position)
    values (v_med, v_proy, 'Contratar al personal de la sucursal', v_hoy + 60, 3) returning id into v_t3;

    insert into public.task_dependencies (tenant_id, task_id, depends_on_task_id)
    values (v_med, v_t2, v_t1), (v_med, v_t3, v_t1);

    insert into public.project_milestones (tenant_id, project_id, name, due_date)
    values (v_med, v_proy, 'Inauguración', v_hoy + 75);

    insert into public.project_budgets (tenant_id, project_id, concept, category, amount, created_by)
    values (v_med, v_proy, 'Depósito y 2 meses de alquiler', 'general', 180000.00, v_maria),
           (v_med, v_proy, 'Remodelación del local', 'subcontract', 350000.00, v_maria),
           (v_med, v_proy, 'Mobiliario y estanterías', 'materials', 95000.00, v_maria);
  end if;

  -- Un proyecto de cliente ya terminado y facturado: el costeo se ve con
  -- un proyecto cerrado, no solo con uno a medias.
  if not exists (select 1 from public.projects where tenant_id = v_med and name = 'Suministro de materiales Torre Arroyo Hondo') then
    insert into public.projects (tenant_id, name, description, status, start_date, end_date, created_by)
    values (v_med, 'Suministro de materiales Torre Arroyo Hondo',
            'Cemento, varilla y pintura para la Constructora Bisonó, entregados por etapas en obra.',
            'completed', v_hoy - 95, v_hoy - 40, v_maria)
    returning id into v_proy;

    insert into public.project_tasks (tenant_id, project_id, name, status, due_date, position)
    values (v_med, v_proy, 'Primera entrega (estructura)', 'done', v_hoy - 80, 1),
           (v_med, v_proy, 'Segunda entrega (terminaciones)', 'done', v_hoy - 45, 2);

    insert into public.project_milestones (tenant_id, project_id, name, due_date, completed_at)
    values (v_med, v_proy, 'Obra recibida por el cliente', v_hoy - 40, now() - interval '41 days');

    insert into public.project_budgets (tenant_id, project_id, concept, category, amount, created_by)
    values (v_med, v_proy, 'Materiales', 'materials', 420000.00, v_maria) returning id into v_b1;
    insert into public.project_budgets (tenant_id, project_id, concept, category, amount, created_by)
    values (v_med, v_proy, 'Transporte a la obra', 'equipment', 30000.00, v_maria) returning id into v_b2;

    insert into public.project_costs (tenant_id, project_id, budget_id, concept, amount, incurred_on, billed, created_by)
    values (v_med, v_proy, v_b1, 'Cemento y varilla, primera entrega', 238500.00, v_hoy - 80, true, v_maria),
           (v_med, v_proy, v_b1, 'Pintura y terminaciones, segunda entrega', 174200.00, v_hoy - 46, true, v_maria),
           (v_med, v_proy, v_b2, 'Camión y chofer, 6 viajes', 33600.00, v_hoy - 45, true, v_maria);
  end if;
end $$;
