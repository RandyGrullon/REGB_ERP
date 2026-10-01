#!/usr/bin/env node
/**
 * Arma las migraciones en BLOQUES para pegarlos en el SQL Editor de Supabase.
 *
 *   pnpm db:sql-para-editor                 bloques de ~220 KB (pocos pegados)
 *   pnpm db:sql-para-editor --desde 0143    solo de la 0143 en adelante
 *   pnpm db:sql-para-editor --kb 60         bloques mas chicos
 *   pnpm db:sql-para-editor --kb 1          una migracion por archivo
 *
 * Deja los archivos en `supabase/.temp/sql-editor/` (fuera de git), en el
 * orden en que se pegan. No se conecta a ninguna base.
 *
 * ── Para que ─────────────────────────────────────────────────────────
 *
 * El camino normal es `pnpm db:migrar`. Pero hay redes -la de muchas
 * empresas- que cortan la conexion a Postgres (puertos 5432 y 6543) y dejan
 * pasar la web. El SQL Editor del panel va por HTTPS y corre como
 * `postgres`, el mismo rol que usa el script.
 *
 * ── Que hace cada bloque ─────────────────────────────────────────────
 *
 *  · Va entero entre `begin;` y `commit;` explicitos: si una sentencia
 *    falla no queda nada a medias (y el `set local` de la 0001 funciona),
 *    mande el editor el texto como lo mande. Se arregla y se vuelve a pegar.
 *  · Crea el libro (`regb.migraciones_aplicadas`) si no existe, ANTES de la
 *    primera migracion: si naciera despues de la 0144, se quedaria sin RLS.
 *  · Se niega si ya estaba aplicado o si falta el bloque anterior.
 *  · Anota cada migracion en el libro justo despues de ella, con el MISMO
 *    hash que `scripts/aplicar-migraciones.mjs` (sha256 del texto con
 *    finales LF, 16 caracteres). El dia que se pueda correr `pnpm db:migrar`,
 *    ve la base al dia y sin deriva.
 *  · Nunca parte una migracion en dos bloques.
 *
 * Al final, `demo-opcional.sql`: la semilla de demostracion (`demo.sql` y
 * cada `demo-*.sql`, en orden). SOLO para el proyecto de prueba; en
 * produccion no se pega.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)))
const DIR = join(RAIZ, 'supabase', 'migrations')
const SEMILLA = join(RAIZ, 'supabase', 'seed')
const SALIDA = join(RAIZ, 'supabase', '.temp', 'sql-editor')

function opcion(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`)
  return i === -1 ? porDefecto : (process.argv[i + 1] ?? porDefecto)
}
const LIMITE = Math.max(1, Number(opcion('kb', '220')) || 220) * 1024
const DESDE = opcion('desde', '0000')

const texto = (ruta) => readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n')
const hashDe = (t) => createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex').slice(0, 16)
const lit = (s) => `'${s.replace(/'/g, "''")}'`

const todas = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
const archivos = todas.filter((f) => f.slice(0, 4) >= DESDE)
if (archivos.length === 0) {
  console.error(`No hay migraciones desde la ${DESDE}.`)
  process.exit(1)
}

// Reparte por tamaño sin partir nunca una migracion.
const bloques = []
let actual = []
let tam = 0
for (const f of archivos) {
  const t = texto(join(DIR, f))
  const peso = Buffer.byteLength(t, 'utf8')
  if (actual.length && tam + peso > LIMITE) {
    bloques.push(actual)
    actual = []
    tam = 0
  }
  actual.push({ f, t })
  tam += peso
}
if (actual.length) bloques.push(actual)

rmSync(SALIDA, { recursive: true, force: true })
mkdirSync(SALIDA, { recursive: true })

// La migracion anterior a la primera del lote (si --desde corta el principio).
const anteriorAlLote = todas[todas.indexOf(archivos[0]) - 1] ?? null
const total = bloques.length

bloques.forEach((b, i) => {
  const n = i + 1
  const primera = b[0].f
  const ultima = b[b.length - 1].f
  const previa = i === 0 ? anteriorAlLote : bloques[i - 1][bloques[i - 1].length - 1].f
  const partes = [
    '-- ═══════════════════════════════════════════════════════════════════',
    `--  REGB ERP — BLOQUE ${n} de ${total}  (${primera} … ${ultima})`,
    '--  Pégalo ENTERO en Supabase → SQL Editor → New query y pulsa Run.',
    `--  Al final debe decir "Bloque ${n} aplicado". Si sale un error, no se`,
    '--  aplicó nada de este bloque: copia el mensaje, arregla y vuelve a pegarlo.',
    '-- ═══════════════════════════════════════════════════════════════════',
    '',
    'begin;',
    '',
    'create schema if not exists regb;',
    'create table if not exists regb.migraciones_aplicadas (',
    '  nombre      text primary key,',
    '  hash        text not null,',
    '  aplicada_en timestamptz not null default now()',
    ');',
    '',
    'do $regb_guarda$',
    'begin',
    `  if exists (select 1 from regb.migraciones_aplicadas where nombre = ${lit(ultima)}) then`,
    `    raise exception 'El bloque ${n} ya estaba aplicado.${n < total ? ` Sigue con el ${n + 1}.` : ''}';`,
    '  end if;',
    ...(previa
      ? [
          `  if not exists (select 1 from regb.migraciones_aplicadas where nombre = ${lit(previa)}) then`,
          `    raise exception 'Falta aplicar el bloque anterior (el que termina en ${previa}).';`,
          '  end if;',
        ]
      : []),
    'end',
    '$regb_guarda$;',
    '',
  ]
  for (const { f, t } of b) {
    partes.push(
      `-- ─── ${f} ───────────────────────────────────────────────`,
      t.trimEnd(),
      '',
      `insert into regb.migraciones_aplicadas (nombre, hash) values (${lit(f)}, ${lit(hashDe(t))});`,
      '',
    )
  }
  partes.push(
    'commit;',
    '',
    `select 'Bloque ${n} aplicado' as resultado,`,
    '       (select count(*) from regb.migraciones_aplicadas) as migraciones_en_la_base,',
    `       ${lit(ultima)} as ultima_de_este_bloque;`,
    '',
  )
  const nombre = `bloque-${String(n).padStart(2, '0')}.sql`
  writeFileSync(join(SALIDA, nombre), partes.join('\n'))
  const kb = Math.round(b.reduce((s, x) => s + Buffer.byteLength(x.t, 'utf8'), 0) / 1024)
  console.log(
    `  ${nombre}  ${String(b.length).padStart(3)} migraciones  ${primera} … ${ultima}  ~${kb} KB`,
  )
})

// ── La semilla de demostracion, aparte y opcional ───────────────────────
const extras = readdirSync(SEMILLA)
  .filter((f) => /^demo-.+\.sql$/.test(f))
  .sort()
const semilla = ['demo.sql', ...extras]
writeFileSync(
  join(SALIDA, 'demo-opcional.sql'),
  [
    '-- ═══════════════════════════════════════════════════════════════════',
    '--  REGB ERP — SEMILLA DE DEMOSTRACION (OPCIONAL)',
    '--  Solo para el proyecto de PRUEBA: crea clientes y datos ficticios',
    '--  (Colmado La Esperanza, Distribuidora Caribe). En produccion NO se pega.',
    '--  Va despues del ultimo bloque. Se puede repetir: no duplica.',
    '-- ═══════════════════════════════════════════════════════════════════',
    '',
    'begin;',
    '',
    ...semilla.flatMap((f) => [`-- ─── ${f} ───`, texto(join(SEMILLA, f)).trimEnd(), '']),
    'commit;',
    '',
    "select 'Semilla de demostracion cargada' as resultado,",
    '       (select count(*) from regb.tenants) as clientes;',
    '',
  ].join('\n'),
)

console.log(
  `\n${archivos.length} migraciones en ${total} bloque(s), en ${relative(RAIZ, SALIDA)}.` +
    '\nPegalos EN ORDEN (bloque-01, bloque-02…). Despues, solo en el proyecto de prueba,' +
    '\ndemo-opcional.sql con la semilla de demostracion.',
)
