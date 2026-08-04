/**
 * Sonda de accesibilidad — WCAG 2.1 AA, las reglas que se pueden decidir
 * con la pagina ya pintada.
 *
 * Se pega en la consola del navegador (o se inyecta con el panel Browser)
 * y despues se llama a `__auditar()`, que recorre todas las rutas en un
 * iframe de 1280 px y devuelve un informe agrupado.
 *
 * No sustituye a axe ni a un lector de pantalla, y no pretende: cubre las
 * cinco familias que producen casi todos los fallos reales de una app de
 * gestion —nombre accesible, jerarquia de encabezados, landmarks, ids
 * repetidos y contraste— y las cubre sin depender de una CDN, que es lo
 * que permite correrla contra un servidor local sin internet.
 *
 * Lo que NO decide una maquina y hay que mirar a mano: orden de foco
 * logico, si un texto alternativo describe de verdad la imagen, y si el
 * flujo se puede completar solo con teclado.
 *
 *   1. pega este archivo entero en la consola
 *   2. await __auditar()
 */

window.__a11y = function (doc, win) {
  const fallos = []
  const add = (regla, criterio, detalle) =>
    fallos.push({ regla, criterio, detalle: String(detalle).slice(0, 140) })

  /** Nombre accesible, ignorando lo que este `aria-hidden` (los iconos). */
  const nombre = (el) => {
    const al = el.getAttribute('aria-label')
    if (al && al.trim()) return al
    const lb = el.getAttribute('aria-labelledby')
    if (lb) {
      const r = lb
        .split(/\s+/)
        .map((id) => doc.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim()
      if (r) return r
    }
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      if (el.id && doc.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return 'label-for'
      if (el.closest('label')) return 'label-envuelve'
      return el.getAttribute('title') || ''
    }
    const clon = el.cloneNode(true)
    clon.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove())
    return (clon.textContent || '').trim() || el.getAttribute('title') || ''
  }

  for (const el of doc.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (el.type === 'checkbox' && el.closest('label')) continue
    if (!nombre(el)) {
      add(
        'control-sin-nombre',
        '4.1.2 Nombre, funcion, valor',
        el.tagName.toLowerCase() + ' ' + (el.className || '').toString().slice(0, 60),
      )
    }
  }

  for (const img of doc.querySelectorAll('img')) {
    if (!img.hasAttribute('alt')) add('img-sin-alt', '1.1.1 Contenido no textual', img.src?.slice(-45))
  }

  const hs = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(
    (h) => h.getBoundingClientRect().height > 0,
  )
  const h1 = hs.filter((h) => h.tagName === 'H1')
  if (h1.length === 0) add('sin-h1', '1.3.1 Informacion y relaciones', 'la pagina no tiene h1')
  if (h1.length > 1) add('varios-h1', '1.3.1 Informacion y relaciones', h1.length + ' encabezados h1')
  let prev = 0
  for (const h of hs) {
    const n = Number(h.tagName[1])
    // Un salto de nivel se anuncia como "falta una seccion": quien navega
    // por encabezados se queda buscando algo que no existe.
    if (prev && n > prev + 1) {
      add(
        'salto-de-nivel',
        '1.3.1 Informacion y relaciones',
        `h${prev} -> h${n}: ${h.textContent.trim().slice(0, 40)}`,
      )
    }
    prev = n
  }

  const vistos = new Set()
  for (const el of doc.querySelectorAll('[id]')) {
    if (vistos.has(el.id)) add('id-repetido', '4.1.1 Procesamiento', el.id)
    vistos.add(el.id)
  }

  if (!doc.querySelector('main, [role=main]')) {
    add('sin-main', '1.3.1 Informacion y relaciones', 'ningun landmark main')
  }

  // ── Contraste ──────────────────────────────────────────────────────
  const lum = (c) => {
    const m = c.match(/[\d.]+/g)
    if (!m) return null
    const [r, g, b] = m.slice(0, 3).map(Number)
    const f = (v) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  /** El fondo real: sube por el arbol hasta encontrar uno opaco. */
  const fondoDe = (el) => {
    let n = el
    while (n && n !== doc.documentElement) {
      const bg = win.getComputedStyle(n).backgroundColor
      const m = bg.match(/[\d.]+/g)
      if (m && (m.length < 4 || Number(m[3]) > 0.5) && bg !== 'rgba(0, 0, 0, 0)') return bg
      n = n.parentElement
    }
    return win.getComputedStyle(doc.body).backgroundColor
  }

  const bajos = []
  for (const el of doc.querySelectorAll('p,span,a,button,td,th,li,dt,dd,label,h1,h2,h3,h4')) {
    if (el.children.length > 0) continue
    const txt = (el.textContent || '').trim()
    if (!txt || txt.length < 2) continue
    if (el.getBoundingClientRect().height === 0) continue
    const cs = win.getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue
    const l1 = lum(cs.color)
    const l2 = lum(fondoDe(el))
    if (l1 === null || l2 === null) continue
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    const px = parseFloat(cs.fontSize)
    const grande = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700)
    const min = grande ? 3 : 4.5
    if (ratio < min) bajos.push({ txt: txt.slice(0, 35), ratio: ratio.toFixed(2), min, px, color: cs.color })
  }
  // Se agrupan por color: 40 celdas del mismo token son UN problema, no 40.
  const porColor = {}
  for (const b of bajos) {
    porColor[b.color] = porColor[b.color] || { ...b, n: 0 }
    porColor[b.color].n++
  }
  for (const k in porColor) {
    const b = porColor[k]
    add(
      'contraste-bajo',
      '1.4.3 Contraste minimo',
      `${b.ratio}:1 (min ${b.min}) ${b.px}px ${k} · ${b.n} elementos · "${b.txt}"`,
    )
  }

  return fallos
}

window.__auditar = async function (base = '?tenant=colmado-esperanza&rol=Owner') {
  const rutas = [
    '/', '/products', '/products/categories',
    '/inventory', '/inventory/movements', '/inventory/counts', '/inventory/transfers',
    '/pedidos', '/pedidos/clientes',
    '/pos', '/pos/shifts', '/pos/reports',
    '/cobrar', '/cobrar/cartera', '/cobrar/ncf', '/cobrar/dgii',
    '/usuarios', '/roles', '/empresas', '/sucursales', '/archivos', '/importar',
    '/notificaciones', '/respaldos', '/auditoria', '/configuracion', '/tutorial',
    '/perfil', '/marketplace',
  ]
  const f = document.createElement('iframe')
  f.style.cssText = 'position:fixed;left:-9999px;top:0;width:1280px;height:900px;border:0'
  document.body.appendChild(f)
  const informe = []
  for (const r of rutas) {
    await new Promise((res) => {
      f.onload = () => setTimeout(res, 400)
      f.src = r + base
    })
    try {
      const fallos = window.__a11y(f.contentDocument, f.contentWindow)
      if (fallos.length) informe.push({ ruta: r, fallos })
    } catch (e) {
      informe.push({ ruta: r, error: String(e).slice(0, 80) })
    }
  }
  f.remove()

  const porRegla = {}
  for (const p of informe) {
    for (const x of p.fallos || []) {
      porRegla[x.regla] = porRegla[x.regla] || { veces: 0, rutas: new Set(), ejemplos: new Set() }
      porRegla[x.regla].veces++
      porRegla[x.regla].rutas.add(p.ruta)
      if (porRegla[x.regla].ejemplos.size < 3) porRegla[x.regla].ejemplos.add(x.detalle)
    }
  }
  return {
    rutasRevisadas: rutas.length,
    rutasConFallos: informe.length,
    resumen: Object.entries(porRegla).map(([regla, v]) => ({
      regla,
      veces: v.veces,
      enRutas: [...v.rutas],
      ejemplos: [...v.ejemplos],
    })),
    detalle: informe,
  }
}

'sonda de accesibilidad lista — llama a __auditar()'
