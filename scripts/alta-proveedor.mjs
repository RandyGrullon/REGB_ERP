#!/usr/bin/env node
/**
 * Da de alta a una persona como usuario del PROVEEDOR (REGB Control).
 *
 *   pnpm db:alta-proveedor --correo randy@tudominio.do --nombre "Randy Grullón"
 *   ... --rol admin           owner (por defecto) | admin | csm | support | finance
 *   ... --baja                la desactiva (no borra: la bitacora la sigue nombrando)
 *
 * Es el `insert into regb.provider_users` de docs/PRIMER-CLIENTE.md §2, sin
 * tener que copiar el id de nadie: lo busca por correo en `auth.users`.
 *
 * La cuenta tiene que existir antes en Supabase (Authentication → Users →
 * Add user → Create new user, con "Auto Confirm User"). Este script NO crea
 * cuentas: eso exige la llave de servicio, y esa llave no sale de Supabase.
 *
 * Lee la conexion de `.env.local` de la raiz (scripts/entorno.mjs).
 */
import postgres from 'postgres'

function opcion(nombre) {
  const i = process.argv.indexOf(`--${nombre}`)
  return i === -1 ? null : (process.argv[i + 1] ?? null)
}

const correo = (opcion('correo') ?? '').trim().toLowerCase()
const nombre = (opcion('nombre') ?? '').trim()
const rol = opcion('rol') ?? 'owner'
const baja = process.argv.includes('--baja')

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (o DATABASE_URL_MIGRACIONES) en .env.local de la raiz.')
  process.exit(1)
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
  console.error(
    'Uso: pnpm db:alta-proveedor --correo tu@correo.do --nombre "Tu Nombre" [--rol owner]',
  )
  process.exit(1)
}
if (!['owner', 'admin', 'csm', 'support', 'finance'].includes(rol)) {
  console.error(`Rol desconocido: ${rol}. Usa owner, admin, csm, support o finance.`)
  process.exit(1)
}

const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'prefer',
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
})

try {
  const [usuario] = await sql`
    select id, email, email_confirmed_at from auth.users where lower(email) = ${correo}`
  if (!usuario) {
    console.error(
      `No hay ninguna cuenta con ${correo} en Supabase.\n` +
        'Creala primero: Authentication → Users → Add user → Create new user\n' +
        '(con "Auto Confirm User" marcado) y vuelve a correr esto.',
    )
    process.exitCode = 1
  } else if (baja) {
    const filas = await sql`
      update regb.provider_users set is_active = false where user_id = ${usuario.id} returning 1`
    console.log(
      filas.length
        ? `${correo} ya no entra a REGB Control (en su siguiente inicio de sesion).`
        : `${correo} no era usuario del proveedor. Nada que hacer.`,
    )
  } else {
    if (nombre.length < 3) {
      console.error('Falta --nombre (al menos 3 letras): sale en la bitacora de cada accion.')
      process.exit(1)
    }
    // Una cuenta del proveedor no es de ningun cliente: el hook la mira
    // primero y le quita el tenant. Si ademas tenia una membresia, se avisa.
    const membresias = await sql`
      select count(*)::int as n from public.memberships where user_id = ${usuario.id} and is_active`
    await sql`
      insert into regb.provider_users (user_id, full_name, role, is_active)
      values (${usuario.id}, ${nombre}, ${rol}, true)
      on conflict (user_id) do update
        set full_name = excluded.full_name, role = excluded.role, is_active = true`
    console.log(`Listo: ${correo} es usuario de REGB Control (${rol}).`)
    if (!usuario.email_confirmed_at) {
      console.log('OJO: su correo no esta confirmado; no podra entrar hasta confirmarlo.')
    }
    if (membresias[0].n > 0) {
      console.log(
        'OJO: esa cuenta tambien es de un cliente. Como proveedor NO entrara a ese cliente;\n' +
          'usa otro correo para operar como cliente.',
      )
    }
    console.log('Que cierre sesion y vuelva a entrar: el permiso viaja en el token nuevo.')
  }
} catch (e) {
  console.error('Fallo:', e.message)
  process.exitCode = 1
} finally {
  await sql.end()
}
