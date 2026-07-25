---
name: aurora-ui
description: Genera componentes del design system Aurora (estética Discord) de REGB ERP, en versión web y React Native, con tokens correctos, todos los estados y accesibilidad AA. Úsalo cuando se pida crear o revisar un componente de UI, una pantalla, un mockup o auditar el estilo de la app.
---

# Aurora — design system de REGB ERP

Estética **Discord**: oscuro por defecto, denso, plano con acentos saturados, sensación de app.

## Tokens — úsalos siempre, nunca hex sueltos

```css
/* Superficies (oscuro, default) */
--bg-deepest: #1e1f22 --bg-deep: #2b2d31 --bg-base: #313338 --bg-raised: #383a40
  --bg-overlay: #404249 --bg-input: #1e1f22 --border: #3f4147 --border-strong: #4e5058
  /* Superficies (claro) */ --bg-deepest: #e3e5e8 --bg-deep: #f2f3f5 --bg-base: #ffffff
  --bg-raised: #f8f9fa --border: #e3e5e8 /* Marca */ --brand: #5865f2 --brand-hover: #4752c4
  --brand-active: #3c45a5 --accent-fuchsia: #eb459e (REGB Control) --accent-teal: #00b0b9 (IA)
  /* Semánticos */ --success: #23a559 --warning: #f0b232 --danger: #f23f43 --info: #00a8fc
  --neutral: #80848e /* Texto (oscuro / claro) */ --text-primary: #f2f3f5 / #060607
  --text-secondary: #b5bac1 / #4e5058 --text-muted: #80848e --text-link: #00a8fc / #0068e0
  /* Forma */ radios: 4 (badge) · 8 (botón/input) · 12 (tarjeta) · 16 (modal) · 999 (avatar)
  espaciado: múltiplos de 4 sombras: sm 0 1px 2px rgba(0, 0, 0, 0.2) · md 0 4px 12px
  rgba(0, 0, 0, 0.3) · lg 0 8px 24px rgba(0, 0, 0, 0.4) foco: 0 0 0 3px rgba(88, 101, 242, 0.35);
```

## Tipografía

Inter para UI · `tabular-nums` en toda columna numérica · JetBrains Mono para SKU/RNC/código.
Escala: display 32/40·700 · h1 24/32·700 · h2 20/28·600 · h3 16/24·600 · **body 14/20·400** · body-sm 13/18 · caption 12/16·500 · overline 11/14·700 MAYÚS.

## Layout canónico

`rail 72px` (empresas) · `sidebar 240px` (módulos, grupos colapsables en overline) · `contenido flex` · `members 240px` (opcional).
En <768px: sidebar → drawer, aparece nav inferior de 5 elementos.

## Qué entregas por componente

1. Versión web en `packages/ui/` (React + Tailwind + CVA)
2. Versión native en `packages/ui-native/` (mismos tokens desde `tokens.json`)
3. Todos los estados: `default · hover · active · focus · disabled · loading · error · empty`
4. Ambos temas verificados
5. Props tipadas, sin `any`
6. Nota de accesibilidad: rol ARIA, navegación por teclado, contraste medido

## Las leyes (revísalas antes de entregar)

- [ ] Cero hex hardcodeado — todo por token
- [ ] Contraste ≥ 4.5:1 en ambos temas
- [ ] Foco visible siempre; nunca `outline:none` sin reemplazo
- [ ] Estado nunca comunicado solo por color: color + icono + texto
- [ ] Táctil ≥ 44×44 px
- [ ] `prefers-reduced-motion` respetado
- [ ] Filas de tabla de 40px, encabezado sticky
- [ ] Estado vacío con ilustración + humor + acción + enlace al tour
- [ ] Alcanzable desde `Ctrl+K` si es una acción

## Microcopy

Español dominicano, tuteo, cálido y directo. "Guardamos tu cambio" > "Operación exitosa". Errores en formato **qué pasó · por qué · qué hacer**.

## Mockups

Cuando te pidan una pantalla, entrega el mockup ASCII al estilo de §12 del documento maestro antes de escribir código. Es más rápido de iterar.
