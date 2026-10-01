import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { rutaInterna } from './ruta-interna'
import { inicioPorSesion } from './inicio-por-sesion'

/**
 * Lo que se rompio al conectar un Supabase de verdad (stack local de la CLI,
 * 2026-09-30) y que el modo demostracion nunca ejercitaba. Nada de esto
 * toca la base.
 */

const TENANT = '3e64e7c8-1cc8-48bd-a512-00b1c0c60b56'
const ROL = '20da3fe6-8649-46be-881c-d434b7de764c'

describe('rutaInterna: a donde se vuelve despues de entrar', () => {
  it('deja pasar rutas de la app, con su query', () => {
    expect(rutaInterna('/pos')).toBe('/pos')
    expect(rutaInterna('/auth/invitacion/abc')).toBe('/auth/invitacion/abc')
    expect(rutaInterna('/cobrar?estado=overdue')).toBe('/cobrar?estado=overdue')
  })

  it('manda al inicio todo lo que el navegador leeria como otro dominio', () => {
    for (const malo of [
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      'https://evil.example',
      'evil.example',
      'javascript:alert(1)',
      '',
      null,
      undefined,
    ]) {
      expect(rutaInterna(malo)).toBe('/')
    }
  })
})

describe('inicioPorSesion: el inicio de cada quien con sesion real', () => {
  it('el proveedor va a REGB Control: no tiene cliente en el token', () => {
    expect(
      inicioPorSesion({ sub: 'u', app_metadata: { is_provider: true, tenant_id: null } }),
    ).toBe('/control')
  })

  it('sin membresia, o con el cliente suspendido o archivado, a /sin-acceso', () => {
    expect(
      inicioPorSesion({ sub: 'u', app_metadata: { is_provider: false, tenant_id: null } }),
    ).toBe('/sin-acceso')
    expect(
      inicioPorSesion({
        sub: 'u',
        app_metadata: { tenant_id: null, tenant_status: 'suspended' },
      }),
    ).toBe('/sin-acceso')
    // Un token sin claims (el hook no esta encendido) falla cerrado.
    expect(inicioPorSesion({ sub: 'u' })).toBe('/sin-acceso')
  })

  it('con cliente activo, al inicio del ERP', () => {
    expect(
      inicioPorSesion({
        sub: 'u',
        app_metadata: { tenant_id: TENANT, role_id: ROL, tenant_status: 'active' },
      }),
    ).toBe('/')
  })
})

describe('middleware con Supabase configurado y SIN sesion', () => {
  const antes = { ...process.env }
  beforeEach(() => {
    // Una URL a la que nadie contesta: sin cookie de sesion, getUser() no
    // sale a la red.
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_prueba'
    // supabase-js 2.110 exige un WebSocket nativo al crear el cliente (lo
    // trae Node 22, el runtime de Next y Vercel). En Node 20 basta la forma:
    // estas pruebas no abren Realtime.
    if (typeof globalThis.WebSocket === 'undefined') {
      vi.stubGlobal('WebSocket', class {})
    }
    vi.resetModules()
  })
  afterEach(() => {
    process.env = { ...antes }
  })

  async function pedir(ruta: string) {
    const { middleware } = await import('../middleware')
    return middleware(new NextRequest(new URL(ruta, 'http://localhost:3150')))
  }

  it('una pantalla manda al login y recuerda a donde iba', async () => {
    const r = await pedir('/pos')
    expect(r.status).toBe(307)
    const destino = new URL(r.headers.get('location')!)
    expect(destino.pathname).toBe('/login')
    expect(destino.searchParams.get('siguiente')).toBe('/pos')
  })

  it('lo que llama un cron NO se manda al login: se protege con su secreto', async () => {
    for (const ruta of ['/api/eventos/despachar', '/api/salud', '/api/alertas', '/api/ecf/x/y']) {
      const r = await pedir(ruta)
      expect(r.headers.get('location'), ruta).toBeNull()
    }
  })

  it('el login y los enlaces de invitacion abren sin sesion', async () => {
    for (const ruta of [
      '/login',
      '/auth/invitacion/' + 'a'.repeat(64),
      '/auth/invitacion/' + 'a'.repeat(64) + '/entrar',
      '/sin-acceso',
    ]) {
      const r = await pedir(ruta)
      expect(r.headers.get('location'), ruta).toBeNull()
    }
  })
})

describe('middleware en modo demostracion', () => {
  it('no estorba: sin Supabase no hay login que exigir', async () => {
    vi.resetModules()
    const { middleware } = await import('../middleware')
    const r = await middleware(new NextRequest(new URL('/pos', 'http://localhost:3100')))
    expect(r.headers.get('location')).toBeNull()
  })
})
