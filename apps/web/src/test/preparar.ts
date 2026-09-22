import { vi } from 'vitest'

/**
 * Lo que Next pone alrededor de una server action y que fuera de Next no
 * existe. Se sustituye lo MINIMO: la accion, lib/db, la RLS y las
 * funciones de la base corren de verdad.
 *
 * - `revalidatePath` solo invalida la cache de Next; aqui no hay cache.
 *   Se deja como espia por si una prueba quiere comprobar que se llamo.
 * - `cookies()` lo usa anotarAviso (y la sesion, que en modo demostracion
 *   no se consulta). Un tarro en memoria por proceso; `arnes.ts` lo
 *   expone para leer el aviso que dejo la accion.
 */
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('next/headers', async () => {
  const { tarro } = await import('./arnes')
  return {
    cookies: async () => tarro,
    headers: async () => new Headers(),
  }
})

vi.mock('next/navigation', () => ({
  // En una accion no deberian llamarse nunca: si alguna lo hace, que la
  // prueba lo diga con un error claro en vez de colgarse.
  redirect: (url: string) => {
    throw new Error(`redirect(${url}) dentro de una accion`)
  },
  notFound: () => {
    throw new Error('notFound() dentro de una accion')
  },
}))
