import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Lo que un modulo core DICE que emite, lo emite de verdad.
 *
 * ── Por que hace falta ────────────────────────────────────────────────
 *
 * `events.emits` del manifiesto es un contrato: automatizaciones y
 * webhooks se configuran escribiendo esos temas. Hasta el 22 sep 2026
 * NINGUN modulo core emitia lo que declaraba -13 temas-, y nada lo
 * delataba: una regla sobre `orgs.company.created` se guardaba bien y
 * simplemente no se disparaba nunca.
 *
 * Y el formato no es cosmetico. `emit_event()` (0007) rechaza lo que no
 * sea `<modulo>.<entidad>.<accion>` con una excepcion que REVIERTE la
 * transaccion de negocio entera. `tour.finished` estaba declarado asi:
 * el dia que alguien lo emitiera tal cual, terminar un tutorial dejaria
 * de guardarse. Ya paso con `attendance`.
 *
 * ── Como mira ─────────────────────────────────────────────────────────
 *
 * Estaticamente, sin base: carga cada `modules/<id>/manifest.ts` de
 * disco -un modulo nuevo entra solo- y busca las llamadas a
 * `emit_event(` en apps, packages, modules y migraciones. Reconoce el
 * tema literal ('orgs.company.created'), el de plantilla
 * (`time-off.request.${decision}` cuenta como prefijo) y el `insert into
 * public.event_outbox` directo de las migraciones. Las pruebas no
 * cuentan como emisor: emitir desde un test no hace que la pantalla
 * emita.
 *
 * Mira los dos lados del contrato: lo declarado se emite, y lo que se
 * emite con prefijo de un modulo core esta declarado en su manifiesto.
 */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

/** El mismo patron que exige `public.emit_event()` en 0007. */
const FORMATO = /^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$/

/**
 * Deuda conocida de modulos core que esta entrega no toca -tienen otro
 * dueño-. Cada fila dice por que sigue aqui.
 *
 * La lista SOLO PUEDE ENCOGER: si uno de estos temas empieza a emitirse,
 * o deja de declararse, la prueba se pone roja hasta que se quite de
 * aqui. Asi no se queda una excusa vieja tapando un evento que ya existe.
 */
const PENDIENTES: Record<string, string> = {}

interface Manifiesto {
  id: string
  category: string
  events: { emits: string[]; listens: string[] }
}

const SALTAR = new Set([
  'node_modules',
  'dist',
  '.next',
  '.expo',
  '.turbo',
  'build',
  'out',
  'coverage',
])

function fuentes(dir: string, out: string[] = []): string[] {
  let entradas
  try {
    entradas = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entradas) {
    if (SALTAR.has(e.name) || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      fuentes(p, out)
    } else if (
      /\.(ts|tsx|js|mjs|sql)$/.test(e.name) &&
      !/\.test\.(ts|tsx)$/.test(e.name) &&
      !e.name.endsWith('.d.ts') &&
      e.name !== 'manifest.ts'
    ) {
      out.push(p)
    }
  }
  return out
}

/** Temas literales y prefijos de plantilla que el codigo le pasa a emit_event(). */
function emisiones(): { literales: Set<string>; prefijos: Set<string> } {
  const literales = new Set<string>()
  const prefijos = new Set<string>()
  const archivos = ['apps', 'packages', 'modules', join('supabase', 'migrations')].flatMap((r) =>
    fuentes(join(RAIZ, r)),
  )
  for (const f of archivos) {
    const src = readFileSync(f, 'utf8')
    if (!src.includes('emit_event(') && !src.includes('event_outbox')) continue
    // SQL y TS:  emit_event('orgs.company.created', ...)
    for (const m of src.matchAll(/emit_event\(\s*'([^']+)'/g)) literales.add(m[1]!)
    // TS:  emit_event(${`crm.lead.${x}`}, ...)
    for (const m of src.matchAll(/emit_event\(\s*\$\{\s*`([^`$]*)\$\{/g)) prefijos.add(m[1]!)
    // TS:  emit_event(${`orgs.company.created`}, ...)
    for (const m of src.matchAll(/emit_event\(\s*\$\{\s*`([^`$]+)`\s*\}/g)) literales.add(m[1]!)
    // SQL:  insert into public.event_outbox (...) values (..., 'users.member.joined', ...);
    // Lo usan las funciones security definer que corren sin tenant en el
    // JWT -aceptar una invitacion-, donde emit_event() no puede.
    if (!f.endsWith('.sql')) continue
    for (const m of src.matchAll(/insert\s+into\s+public\.event_outbox\b[\s\S]*?;/gi)) {
      for (const t of m[0].matchAll(/'([^']+)'/g)) if (FORMATO.test(t[1]!)) literales.add(t[1]!)
    }
  }
  return { literales, prefijos }
}

async function manifiestosCore(): Promise<Manifiesto[]> {
  const ids = readdirSync(join(RAIZ, 'modules'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort()
  const todos: Manifiesto[] = []
  for (const id of ids) {
    const ruta = join(RAIZ, 'modules', id, 'manifest.ts').replace(/\\/g, '/')
    const mod = (await import(/* @vite-ignore */ ruta)) as { default: Manifiesto }
    todos.push(mod.default)
  }
  return todos.filter((m) => m.category === 'core')
}

const core = await manifiestosCore()
const { literales, prefijos } = emisiones()
const seEmite = (tema: string): boolean =>
  literales.has(tema) || [...prefijos].some((p) => p.length > 0 && tema.startsWith(p))

const declarados = core.flatMap((m) => m.events.emits.map((tema) => ({ modulo: m.id, tema })))

describe('Eventos de los modulos core', () => {
  it('los manifiestos core se leen de disco y el codigo emite algo', () => {
    // Si el escaneo se rompe -una ruta mal armada- todo lo de abajo
    // pasaria en verde sin mirar nada.
    expect(core.length).toBeGreaterThanOrEqual(13)
    expect(literales.size).toBeGreaterThan(50)
  })

  it('cada tema declarado tiene el formato que emit_event() acepta', () => {
    // Un tema invalido no falla al declararlo: falla al emitirlo, dentro
    // de la transaccion, y se lleva por delante el cambio del usuario.
    const invalidos = declarados.filter((d) => !FORMATO.test(d.tema))
    expect(invalidos).toEqual([])
  })

  it('cada tema declarado lo emite alguna accion', () => {
    const mudos = declarados.filter((d) => !seEmite(d.tema) && !(d.tema in PENDIENTES))
    expect(mudos).toEqual([])
  })

  it('y cada tema que se emite con prefijo core esta declarado', () => {
    // El otro lado del contrato: quien configura una automatizacion lee
    // el manifiesto. Un tema que se emite sin declararse no lo encuentra
    // nadie.
    const porModulo = new Map(core.map((m) => [m.id, new Set(m.events.emits)]))
    const sinDeclarar = [...literales].filter((tema) => {
      const decl = porModulo.get(tema.split('.')[0]!)
      return decl !== undefined && !decl.has(tema)
    })
    expect(sinDeclarar).toEqual([])
  })

  it('la lista de pendientes solo encoge', () => {
    const temas = new Set(declarados.map((d) => d.tema))
    const sobran = Object.keys(PENDIENTES).filter((t) => !temas.has(t) || seEmite(t))
    // Si esto falla: ese tema ya se emite o ya no se declara. Quitalo de
    // PENDIENTES para que la prueba lo vigile de verdad.
    expect(sobran).toEqual([])
  })
})
