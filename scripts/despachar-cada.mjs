#!/usr/bin/env node
/**
 * Despacha el bus de eventos cada N segundos, para un servidor propio.
 *
 * Next no tiene procesos de fondo: el despachador es un endpoint
 * (`/api/eventos/despachar`) que alguien tiene que llamar. En Vercel lo
 * llama Vercel Cron; en Supabase, `pg_cron` + `pg_net` (docs/defi-v1.md
 * §4.9). En un VPS o en el servidor del cliente, este bucle, corriendo al
 * lado de `next start` (pm2, systemd, un servicio de Windows).
 *
 * Sin nada que lo llame, los asientos contables automaticos, las
 * automatizaciones y los webhooks se quedan en la cola para siempre.
 *
 *   REGB_URL=https://erp.midominio.do REGB_CRON_SECRET=... node scripts/despachar-cada.mjs 30
 */
const BASE = process.env.REGB_URL ?? 'http://localhost:3100'
const SECRETO = process.env.REGB_CRON_SECRET ?? process.env.CRON_SECRET ?? ''
const CADA = Math.max(5, Number(process.argv[2] ?? 30)) * 1000

async function una() {
  const inicio = Date.now()
  try {
    const res = await fetch(`${BASE}/api/eventos/despachar?limite=200`, {
      method: 'POST',
      headers: SECRETO ? { authorization: `Bearer ${SECRETO}` } : {},
    })
    const cuerpo = await res.json().catch(() => ({}))
    const hora = new Date().toISOString()
    if (!res.ok) console.error(`${hora} ✗ ${res.status} ${cuerpo.error ?? ''}`)
    else console.log(`${hora} ✓ ${JSON.stringify(cuerpo)} (${Date.now() - inicio} ms)`)
  } catch (e) {
    console.error(`${new Date().toISOString()} ✗ ${e instanceof Error ? e.message : e}`)
  }
}

console.log(`Despachando ${BASE} cada ${CADA / 1000} s. Ctrl+C para parar.`)
await una()
setInterval(una, CADA)
