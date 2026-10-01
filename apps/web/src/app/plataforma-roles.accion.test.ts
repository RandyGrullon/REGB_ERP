import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement, type ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { db } from '@/lib/db'
import { MANIFESTS } from '@/lib/bootstrap'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'

/**
 * Las pantallas de Plataforma, abiertas DE VERDAD con los roles de fábrica.
 *
 * Ocultar un enlace del menú no es seguridad: la pantalla tiene que negarse
 * sola. Aquí se pinta cada una (render en servidor, con sus consultas)
 * como Admin, Gerente General y Cajero, y se comprueba:
 *  - que el Cajero no abre nada de administración (usuarios, roles,
 *    empresas, respaldos, llaves de API...): recibe "no existe";
 *  - que Admin y Gerente General abren lo suyo sin basura a la vista;
 *  - que el Inicio del Cajero lo manda a la caja, no a un 404.
 */

;(globalThis as { React?: typeof React }).React = React

class NoExiste extends Error {}
class Redirige extends Error {
  constructor(public url: string) {
    super(`redirect(${url})`)
  }
}

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirige(url)
  },
  notFound: () => {
    throw new NoExiste('notFound()')
  },
  usePathname: () => '/',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

type Pagina = (p: {
  params?: Promise<Record<string, string>>
  searchParams: Promise<Record<string, string>>
}) => Promise<ReactElement>

const PANTALLAS: Record<string, () => Promise<{ default: unknown }>> = {
  '/': () => import('./page'),
  '/usuarios': () => import('./usuarios/page'),
  '/roles': () => import('./roles/page'),
  '/empresas': () => import('./empresas/page'),
  '/sucursales': () => import('./sucursales/page'),
  '/configuracion': () => import('./configuracion/page'),
  '/perfil': () => import('./perfil/page'),
  '/notificaciones': () => import('./notificaciones/page'),
  '/marketplace': () => import('./marketplace/page'),
  '/tutorial': () => import('./tutorial/page'),
  '/respaldos': () => import('./respaldos/page'),
  '/auditoria': () => import('./auditoria/page'),
  '/archivos': () => import('./archivos/page'),
  '/importar': () => import('./importar/page'),
  '/chat': () => import('./chat/page'),
  '/automatizaciones': () => import('./automatizaciones/page'),
  '/api-webhooks': () => import('./api-webhooks/page'),
  '/copiloto': () => import('./copiloto/page'),
}

type Resultado =
  { tipo: 'abre'; html: string } | { tipo: 'no-existe' } | { tipo: 'redirige'; a: string }

let c: ClientePrueba

async function abrir(ruta: string, rol: string): Promise<Resultado> {
  const Page = (await PANTALLAS[ruta]!()).default as Pagina
  try {
    const el = await Page({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ tenant: c.slug, rol }),
    })
    const stream = await renderToReadableStream(createElement(() => el))
    await stream.allReady
    return { tipo: 'abre', html: await new Response(stream).text() }
  } catch (e) {
    if (e instanceof NoExiste) return { tipo: 'no-existe' }
    if (e instanceof Redirige) return { tipo: 'redirige', a: e.url }
    throw e
  }
}

/** Lo que se lee en pantalla, sin scripts ni etiquetas. */
const texto = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')

beforeAll(async () => {
  const catalogo = await db()<{ id: string }[]>`select id from regb.module_catalog`
  const existen = new Set(catalogo.map((m) => m.id))
  c = await sembrarCliente({
    prefijo: 'accion-plataforma-roles',
    nombre: 'Plataforma por Rol SRL',
    modulos: [...MANIFESTS.keys()].filter((id) => existen.has(id) && id !== 'invoice-capture'),
    // Los roles de fábrica (Admin, Gerente General, Cajero...) los crea el
    // alta del cliente; aquí solo se asegura un Owner.
    roles: { Owner: { '*': true } },
  })
  // Con los módulos enterprise encendidos, el plan tiene que ser el que
  // los incluye: el motor de precios se niega a cotizarlos en PYME.
  await db()`update regb.tenants set tier = 'grande' where id = ${c.tenantId}`
})

afterAll(async () => {
  await c.limpiar()
  await cerrarBase()
})

describe('Cajero', () => {
  it('su Inicio lo manda a la caja, no a un 404', async () => {
    const r = await abrir('/', 'Cajero')
    expect(r.tipo).toBe('redirige')
    if (r.tipo === 'redirige') expect(r.a).toMatch(/^\/pos/)
  })

  it('no abre nada de administración aunque escriba la dirección', async () => {
    const cerradas = [
      '/usuarios',
      '/roles',
      '/empresas',
      '/sucursales',
      '/configuracion',
      '/marketplace',
      '/respaldos',
      '/auditoria',
      '/importar',
      '/automatizaciones',
      '/api-webhooks',
      '/copiloto',
    ]
    const abiertas: string[] = []
    for (const ruta of cerradas) {
      const r = await abrir(ruta, 'Cajero')
      if (r.tipo === 'abre') abiertas.push(ruta)
    }
    expect(abiertas).toEqual([])
  })

  it('sí abre su cuenta', async () => {
    const r = await abrir('/perfil', 'Cajero')
    expect(r.tipo).toBe('abre')
  })
})

describe.each(['Admin', 'Gerente General'])('%s', (rol) => {
  it('abre las pantallas de plataforma que le tocan, sin basura a la vista', async () => {
    const resultado: Record<string, string> = {}
    for (const ruta of Object.keys(PANTALLAS)) {
      const r = await abrir(ruta, rol)
      resultado[ruta] = r.tipo === 'redirige' ? `redirige a ${r.a}` : r.tipo
      if (r.tipo === 'abre') {
        const t = texto(r.html)
        expect(t, `${rol} ${ruta}`).not.toMatch(/\bundefined\b|\bNaN\b|Invalid Date/)
        expect(t, `${rol} ${ruta}`).not.toMatch(
          /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/,
        )
      }
    }
    // Las dos las administran o las supervisan: el Inicio y lo básico abren.
    for (const ruta of ['/', '/usuarios', '/roles', '/empresas', '/sucursales', '/perfil']) {
      expect(resultado[ruta], `${rol} ${ruta}`).toBe('abre')
    }
  })
})

/**
 * Las mismas pantallas con los clientes de la demo, que sí tienen datos:
 * lo que se pinta con filas de verdad (equipo, avisos, archivos, canales)
 * tampoco puede enseñar basura. Si la base no tiene la demo, se salta.
 */
describe.each(['distribuidora-caribe', 'colmado-esperanza'])('Demo %s como Owner', (slug) => {
  it('cada pantalla de plataforma abre y se lee limpia', async () => {
    const [t] = await db()<{ id: string }[]>`select id from regb.tenants where slug = ${slug}`
    if (!t) return
    const sucias: string[] = []
    for (const ruta of Object.keys(PANTALLAS)) {
      const Page = (await PANTALLAS[ruta]!()).default as Pagina
      try {
        const el = await Page({
          params: Promise.resolve({}),
          searchParams: Promise.resolve({ tenant: slug, rol: 'Owner' }),
        })
        const stream = await renderToReadableStream(createElement(() => el))
        await stream.allReady
        const t = texto(await new Response(stream).text())
        const basura = t.match(
          /\bundefined\b|\bNaN\b|Invalid Date|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/,
        )
        if (basura) sucias.push(`${ruta}: ${basura[0]}`)
      } catch (e) {
        // Un módulo que ese cliente no tiene no existe para él: correcto.
        if (e instanceof NoExiste) continue
        sucias.push(`${ruta}: ${(e as Error).message}`)
      }
    }
    expect(sucias).toEqual([])
  })
})
