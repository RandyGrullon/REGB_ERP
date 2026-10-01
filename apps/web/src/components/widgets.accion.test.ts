import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import { createElement, type ReactElement } from 'react'
import { renderToReadableStream, renderToStaticMarkup } from 'react-dom/server'
import { asUser, db } from '@/lib/db'
import { MANIFESTS } from '@/lib/bootstrap'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { Widget, agruparWidgets, cargarDatosWidgets, type DatosWidgets } from './widgets'

/**
 * Los widgets del Inicio, TODOS, contra la base de verdad.
 *
 * El Inicio es la pantalla que más se abre del ERP y todas sus consultas
 * corren en un solo `asUser`: un nombre de tabla o de columna roto en UN
 * widget tumba la pantalla entera con un 500. Ya pasó (`from líneas`, con
 * tilde dentro del SQL) y lo vio el cliente, no la puerta.
 *
 * `tsc` no ve dentro de las plantillas `tx`...``: la única forma de saber
 * que el SQL existe es ejecutarlo. Aquí se ejecuta cada rama de
 * `cargarDatosWidgets`, con un cliente que tiene encendidos todos los
 * módulos que se pueden encender, y después se pinta cada widget con lo
 * que devolvió.
 *
 * Las claves no se copian a mano: salen de los manifests (lo que el
 * registry le entrega al Inicio) y del propio código (`pidieron(...)`),
 * así un widget nuevo entra en la prueba sin que nadie se acuerde.
 */

// Next compila el JSX con el runtime automático; vitest (esbuild) lo deja en
// el clásico, que llama a `React.createElement` como global.
;(globalThis as { React?: typeof React }).React = React

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect(${url})`)
  },
  notFound: () => {
    throw new Error('notFound()')
  },
  usePathname: () => '/',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

/** Claves que algún manifest declara: lo que de verdad llega al Inicio. */
const DECLARADAS = [...new Set([...MANIFESTS.values()].flatMap((m) => m.dashboardWidgets ?? []))]

/** Claves que el código sabe cargar, leídas de cada `pidieron(...)`. */
const CARGABLES = (() => {
  const fuente = readFileSync(new URL('./widgets.tsx', import.meta.url), 'utf8')
  const claves = new Set<string>()
  for (const llamada of fuente.matchAll(/pidieron\(([^)]*)\)/g)) {
    for (const k of llamada[1]!.matchAll(/'([^']+)'/g)) claves.add(k[1]!)
  }
  return [...claves]
})()

const TODAS = [...new Set([...DECLARADAS, ...CARGABLES])]

/** El usuario del modo demostración: es quien abre el Inicio en la demo. */
const DEMO_USER = '00000000-0000-0000-0000-000000000001'

let c: ClientePrueba
let modulosEncendidos: string[] = []

/** Lo que NUNCA debe leer el dueño en su Inicio. */
function sinBasura(html: string): void {
  const texto = html.replace(/<[^>]+>/g, ' ')
  expect(texto).not.toMatch(/\bundefined\b/)
  expect(texto).not.toMatch(/\bNaN\b/)
  expect(texto).not.toMatch(/Invalid Date/)
  expect(texto).not.toMatch(/\bnull\b/)
  expect(html).not.toContain('data-widget-sin-dibujo')
}

beforeAll(async () => {
  const sql = db()
  // Todos los módulos del bundle que existen en el catálogo. Menos la
  // captura de facturas: la base se niega a encenderla (0133) porque aún
  // no existe, y es exactamente lo que tiene que pasar.
  const catalogo = await sql<{ id: string }[]>`select id from regb.module_catalog`
  const existen = new Set(catalogo.map((r) => r.id))
  modulosEncendidos = [...MANIFESTS.keys()].filter(
    (id) => existen.has(id) && id !== 'invoice-capture',
  )

  c = await sembrarCliente({
    prefijo: 'accion-widgets',
    nombre: 'Distribuidora Todo Encendido SRL',
    modulos: modulosEncendidos,
    roles: { Owner: { '*': true } },
  })

  // Con membresía, `asUser` lleva el role_id en los claims y la RLS que
  // mira el permiso aplica igual que con una sesión real.
  const [owner] = await sql<{ id: string }[]>`
    select id from public.roles where tenant_id = ${c.tenantId} and name = 'Owner'`
  await sql`
    insert into public.memberships (tenant_id, user_id, role_id, is_active, invited_at, accepted_at)
    values (${c.tenantId}, ${DEMO_USER}, ${owner!.id}, true, now(), now())`

  // La rama del presupuesto solo consulta si hay un presupuesto del año:
  // sin él, la mitad de su SQL nunca se ejecutaría aquí.
  await sql`
    insert into public.budgets (tenant_id, name, fiscal_year, status)
    values (${c.tenantId}, 'Presupuesto de prueba', ${new Date().getFullYear()}, 'active')`
})

afterAll(async () => {
  await c.limpiar(['public.budgets', 'public.memberships'])
  await cerrarBase()
})

describe('Inicio: todas las consultas de los widgets', () => {
  it('las claves salen de los manifests y del código, no de una lista a mano', () => {
    // Si el regex dejara de encontrar las llamadas, la prueba pasaría sin
    // probar nada. Hoy hay más de 90 claves.
    expect(CARGABLES.length).toBeGreaterThan(80)
    expect(DECLARADAS.length).toBeGreaterThan(80)
    // Toda clave que un módulo declara tiene quien la cargue.
    expect(DECLARADAS.filter((k) => !CARGABLES.includes(k))).toEqual([])
  })

  it('el cliente de prueba tiene casi todos los módulos encendidos', () => {
    expect(modulosEncendidos.length).toBeGreaterThan(70)
  })

  it('ejecuta cada consulta sin error, bajo RLS, viendo el costo', async () => {
    const datos = await asUser(DEMO_USER, c.tenantId, (tx) =>
      cargarDatosWidgets(tx, c.tenantId, TODAS, true),
    )
    // Con el costo visible el valor del inventario es un número, no null.
    expect(datos.valorInventario).toBe(0)
    expect(datos.ventasHoy).toEqual({ tickets: 0, total: 0 })
  })

  it('y sin ver el costo: el valor del inventario queda en null, no en cero', async () => {
    const datos = await asUser(DEMO_USER, c.tenantId, (tx) =>
      cargarDatosWidgets(tx, c.tenantId, TODAS, false),
    )
    expect(datos.valorInventario).toBeNull()
  })

  it('cada consulta por separado: el error dice QUÉ widget está roto', async () => {
    // La corrida de arriba falla en la primera consulta rota y se lleva la
    // transacción. Clave por clave, el mensaje nombra al culpable.
    const rotas: string[] = []
    for (const clave of TODAS) {
      try {
        await asUser(DEMO_USER, c.tenantId, (tx) =>
          cargarDatosWidgets(tx, c.tenantId, [clave], true),
        )
      } catch (e) {
        rotas.push(`${clave}: ${(e as Error).message}`)
      }
    }
    expect(rotas).toEqual([])
  })

  it('pinta cada widget declarado sin basura y con su dibujo', async () => {
    const datos = await asUser(DEMO_USER, c.tenantId, (tx) =>
      cargarDatosWidgets(tx, c.tenantId, TODAS, true),
    )
    for (const clave of DECLARADAS) {
      const html = renderToStaticMarkup(createElement(Widget, { clave, datos, qs: '' }))
      expect(html, clave).not.toBe('')
      sinBasura(html)
    }
  })

  it('agrupa: primero lo de hoy, después por área en el orden del menú', () => {
    const bloques = agruparWidgets(
      ['headcount', 'stock-alerts', 'draft-entries-pending', 'sales-today', 'rara'],
      new Map([
        ['headcount', 'rrhh'],
        ['draft-entries-pending', 'finanzas'],
      ]),
      ['finanzas', 'rrhh'],
    )
    expect(bloques).toEqual([
      { seccion: 'hoy', claves: ['sales-today', 'stock-alerts'] },
      { seccion: 'finanzas', claves: ['draft-entries-pending'] },
      { seccion: 'rrhh', claves: ['headcount'] },
      { seccion: 'operacion', claves: ['rara'] },
    ])
  })

  it('el Inicio completo se pinta para el Owner con todos los módulos', async () => {
    const { default: Page } = (await import('@/app/page')) as unknown as {
      default: (p: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>
    }
    const el = await Page({ searchParams: Promise.resolve({ tenant: c.slug, rol: 'Owner' }) })
    // Los widgets llegan por <Suspense>: se espera a que TODOS los bloques
    // terminen, igual que el navegador al final del streaming.
    const stream = await renderToReadableStream(createElement(() => el))
    await stream.allReady
    const html = await new Response(stream).text()
    expect(html).toContain('Tu negocio hoy')
    expect(html).toContain('Recursos humanos')
    expect(html).toContain('Módulos activos')
    expect(html).toContain('Vendido hoy en caja')
    expect(html).toContain('Empleados activos')
    // Ningún bloque cayó en su aviso de error.
    expect(html).not.toContain('No pudimos cargar estos indicadores')
    sinBasura(html.replace(/<script[\s\S]*?<\/script>/g, ''))
  })
})

/**
 * Los mismos widgets contra los clientes de la demo, que sí tienen filas:
 * ahí corren las funciones por fila (`invoice_balance`, `ap_invoice_balance`,
 * `fixed_asset_book_value`...) que con un cliente vacío nunca se llaman.
 * Si la base no tiene la demo sembrada, se saltan.
 */
describe.each(['distribuidora-caribe', 'colmado-esperanza'])('Inicio de la demo %s', (slug) => {
  it('carga todos los widgets con datos reales', async () => {
    const sql = db()
    const [t] = await sql<{ id: string }[]>`select id from regb.tenants where slug = ${slug}`
    if (!t) return
    const [m] = await sql<{ user_id: string }[]>`
      select m.user_id from public.memberships m
      join public.roles r on r.id = m.role_id
      where m.tenant_id = ${t.id} and m.is_active and r.name = 'Owner'
      limit 1`
    const usuario = m?.user_id ?? DEMO_USER
    const datos: DatosWidgets = await asUser(usuario, t.id, (tx) =>
      cargarDatosWidgets(tx, t.id, TODAS, true),
    )
    for (const clave of DECLARADAS) {
      sinBasura(renderToStaticMarkup(createElement(Widget, { clave, datos, qs: '' })))
    }
  })
})
