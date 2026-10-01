import { afterAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement, type ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { db } from '@/lib/db'
import { cerrarBase } from '@/test/arnes'

/**
 * Las 8 pantallas de REGB Control, pintadas de verdad con los clientes que
 * haya en la base. Es el panel del dueño de REGB: puede hablar de tablas y
 * de MRR, pero no enseñar uuids, `null` ni estados crudos en inglés
 * (la bitácora global enseñaba las tres cosas).
 */

;(globalThis as { React?: typeof React }).React = React

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect(${url})`)
  },
  notFound: () => {
    throw new Error('notFound()')
  },
  usePathname: () => '/control',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

type Pagina = (p: {
  params?: Promise<Record<string, string>>
  searchParams: Promise<Record<string, string>>
}) => Promise<ReactElement>

afterAll(cerrarBase)

const texto = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')

async function pintar(
  modulo: Promise<{ default: unknown }>,
  params: Record<string, string> = {},
  filtros: Record<string, string> = {},
): Promise<string> {
  const Page = (await modulo).default as Pagina
  const el = await Page({
    params: Promise.resolve(params),
    searchParams: Promise.resolve(filtros),
  })
  const stream = await renderToReadableStream(createElement(() => el))
  await stream.allReady
  return texto(await new Response(stream).text())
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/

describe('REGB Control', () => {
  it('las ocho pantallas abren sin basura a la vista', async () => {
    const [t] = await db()<{ slug: string }[]>`
      select slug from regb.tenants where status <> 'archived' order by legal_name limit 1`
    const pantallas: [string, Promise<{ default: unknown }>, Record<string, string>][] = [
      ['/control', import('./page'), {}],
      ['/control/[slug]', import('./[slug]/page'), { slug: t?.slug ?? '' }],
      ['/control/actividad', import('./actividad/page'), {}],
      ['/control/datos', import('./datos/page'), {}],
      ['/control/facturacion', import('./facturacion/page'), {}],
      ['/control/onboarding', import('./onboarding/page'), {}],
      ['/control/onboarding/nuevo', import('./onboarding/nuevo/page'), {}],
      ['/control/salud', import('./salud/page'), {}],
    ]
    const sucias: string[] = []
    for (const [ruta, modulo, params] of pantallas) {
      if (ruta === '/control/[slug]' && !t) continue
      const t2 = await pintar(modulo, params)
      const basura = t2.match(/\bundefined\b|\bNaN\b|Invalid Date|\bnull\b/) ?? t2.match(UUID)
      if (basura) sucias.push(`${ruta}: ${basura[0]}`)
    }
    expect(sucias).toEqual([])
  })

  it('la actividad no enseña ids ni estados en inglés, ni con todo el historial', async () => {
    const t = await pintar(import('./actividad/page'), {}, { dias: '0' })
    expect(t).not.toMatch(UUID)
    expect(t).not.toMatch(/"(draft|posted|pending|open)"/)
  })
})
