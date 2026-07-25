---
name: tour-writer
description: Escribe el tour de tutorial interactivo de un módulo de REGB ERP analizando su UI real — pasos, textos, tips de experto y recompensas. Úsalo cuando se pida crear, mejorar o revisar el tutorial, el onboarding o la ayuda de un módulo.
---

# Escribir un tour de REGB ERP

Ningún módulo se publica sin tour. Tu meta: que el usuario haga su primera transacción real en menos de 48 horas sin llamar a soporte.

## Paso 1 — Lee la UI real

Antes de escribir una palabra, lee `modules/<id>/ui/` y lista:

- Las pantallas del módulo y sus rutas
- Los 3 flujos que un usuario hace todos los días
- Los elementos con `data-tour="..."` (si no existen, agrégalos tú)
- Los conceptos que un usuario nuevo NO conoce (ej. "en tránsito", "asiento", "kardex")

## Paso 2 — Elige los pasos

6 a 10 pasos. Estructura recomendada:

| #   | Propósito                                                        |
| --- | ---------------------------------------------------------------- |
| 1   | **Dónde estás** — ubica el módulo en el sidebar                  |
| 2   | **Qué ves** — explica la pantalla principal y cómo leerla        |
| 3   | **La acción diaria** — con `action: 'click'`, el usuario lo hace |
| 4   | **El concepto clave** — el que no es obvio y causa errores       |
| 5   | **La segunda acción** — con `action: 'click'`                    |
| 6   | **Dónde ver el resultado** — reportes o dashboard                |
| 7-9 | Casos frecuentes, atajos, integración con otros módulos          |
| 10  | **Cierre** — recompensa + sugerencia del siguiente tour          |

## Paso 3 — Escribe

```typescript
export default defineTour({
  id: '<módulo>.intro',
  title: '<verbo + resultado>', // "Domina tu inventario"
  estimatedMinutes: 6,
  reward: { xp: 100, badge: '<módulo>-rookie' },
  audience: ['rol', 'rol'],
  steps: [
    {
      target: '[data-tour="..."]',
      title: '<máx. 5 palabras>',
      body: '<máx. 2 frases>',
      placement: 'right' | 'top' | 'bottom' | 'left',
      action: 'click', // opcional, obliga a interactuar
      tip: '<lo que solo sabe quien ya lo usó>',
      video: 'nombre-30s.mp4', // opcional
    },
  ],
  onComplete: async (ctx) => {
    await ctx.awardBadge('<módulo>-rookie')
    await ctx.suggestNext('<módulo>.advanced')
  },
})
```

## Reglas de escritura

1. **Español dominicano neutro, tuteo.** Cálido, directo, sin solemnidad.
2. **Máximo 2 frases por paso.** Si no cabe, son dos pasos.
3. **Explica el porqué, no solo el dónde.**
   ❌ "Haz clic en Transferir para transferir."
   ✅ "Las transferencias quedan _en tránsito_ hasta que el destino confirma — así nadie vende lo que va en camino."
4. **Mínimo 2 pasos con `action: 'click'`.** Leer no enseña; hacer sí.
5. **Un `tip` de experto por tour** — un dato operativo real ("Ajustes sobre $10,000 requieren aprobación del gerente").
6. **Cero jerga sin explicar.** Si dices "asiento contable", defínelo en 6 palabras la primera vez.
7. **Nunca "es fácil", "simplemente", "solo tienes que".**
8. **Título en verbo + resultado**, no el nombre del módulo.

## Paso 4 — Lo que acompaña al tour

Además del tour, escribe para el módulo:

- **Estado vacío**: ilustración + frase con humor + acción primaria + secundaria + enlace al tour
- **Tooltips `?`** de los 5 campos menos obvios
- **3 mensajes de error** en formato _qué pasó · por qué · qué hacer_
- **Entrada en el checklist** de puesta en marcha con su XP

## Paso 5 — Verifica

- [ ] Todos los `target` existen realmente en la UI
- [ ] El tour se completa de principio a fin sin bloquearse
- [ ] Se puede saltar y retomar donde quedó
- [ ] El progreso guarda en `tour_progress`
- [ ] Funciona en móvil (los `placement` cambian en pantallas pequeñas)
