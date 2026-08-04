#!/usr/bin/env node
/**
 * Borra los tenants que dejan las pruebas cuando se caen a media.
 *
 * Cada test crea sus tenants con un sufijo aleatorio (`iso-a-1abd2c46`) y
 * los borra en su `afterAll`. Pero si el proceso muere —un fallo de
 * conexion, un Ctrl-C, Docker que se reinicia— ese `afterAll` no corre y
 * el tenant se queda. Tras unas semanas de desarrollo el panel del
 * propietario enseña 18 clientes cuando de verdad hay 2, y deja de servir
 * para lo unico que importa: mirar el negocio de un vistazo.
 *
 * El patron `prefijo-[8 hex]` solo puede coincidir con un slug generado
 * por un test: `crypto.randomUUID().slice(0, 8)` es exactamente eso. Un
 * cliente real se llama `colmado-esperanza`, no `iso-a-1abd2c46`.
 *
 * Aun asi, no borra a ciegas: primero enseña lo que va a borrar y exige
 * `--si` para hacerlo. Un script de limpieza que borra sin preguntar es
 * como se pierde una base de datos de verdad.
 *
 *   node scripts/limpiar-tenants-de-prueba.mjs        → solo lista
 *   node scripts/limpiar-tenants-de-prueba.mjs --si   → borra
 */
import postgres from 'postgres'

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'

// prefijo con letras y guiones + guion + exactamente 8 hex.
const PATRON = '^[a-z]+[a-z-]*-[0-9a-f]{8}$'

const sql = postgres(URL, { max: 2, onnotice: () => {} })

try {
  const sospechosos = await sql`
    select id, slug, legal_name, created_at::text
    from regb.tenants
    where slug ~ ${PATRON}
    order by created_at`

  if (sospechosos.length === 0) {
    console.log('limpiar-tenants  OK — no hay residuo de pruebas.')
    process.exit(0)
  }

  console.log(`\nTenants de prueba encontrados: ${sospechosos.length}\n`)
  for (const t of sospechosos) {
    console.log(`  ${t.slug.padEnd(24)} ${t.legal_name}`)
  }

  if (!process.argv.includes('--si')) {
    console.log('\nNo se borro nada. Para borrarlos:')
    console.log('  node scripts/limpiar-tenants-de-prueba.mjs --si\n')
    process.exit(0)
  }

  const ids = sospechosos.map((t) => t.id)

  // `regb.invoices` referencia tenants con `on delete restrict` a proposito
  // —una factura emitida no se borra en cascada— asi que hay que quitarlas
  // antes. Son facturas de prueba: no existe ninguna real con este patron.
  await sql`delete from regb.invoices where tenant_id = any(${ids})`
  await sql`delete from regb.impersonation_log where tenant_id = any(${ids})`
  await sql`delete from audit.log where tenant_id = any(${ids})`
  const borrados = await sql`delete from regb.tenants where id = any(${ids}) returning slug`

  console.log(`\nBorrados ${borrados.length} tenants de prueba.`)
  console.log('El resto de sus datos se fue en cascada.\n')
} finally {
  await sql.end()
}
