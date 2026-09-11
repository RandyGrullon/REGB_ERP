/**
 * ═══════════════════════════════════════════════════════════════════════
 *  Tokens de Aurora para React Native.
 *
 *  Los valores NO viven aqui: viven en packages/config/tokens.json, que es
 *  la fuente unica de verdad de web, movil y escritorio. Este archivo solo
 *  los traduce a la forma que entiende React Native, que no tiene variables
 *  CSS ni `color-mix()`.
 *
 *  Este es el UNICO archivo del paquete donde puede aparecer un color, y ni
 *  siquiera escrito a mano: siempre leido de tokens.json. La prueba de humo
 *  (aurora.test.ts) falla si algun otro archivo de src/ escribe un hex.
 *
 *  A proposito NO importa nada de 'react-native': asi los tokens se pueden
 *  cargar en Node (las pruebas) y desde web o escritorio si hiciera falta.
 *  El hook que mira el tema del sistema vive en useTema.ts.
 * ═══════════════════════════════════════════════════════════════════════
 */
import tokens from '@regb/config/tokens'

/** Los dos temas de Aurora. En movil manda el sistema operativo. */
export type Tema = 'claro' | 'oscuro'

/** tokens.json nombra las variantes en ingles; de la frontera hacia adentro van en espanol. */
const VARIANTE: Record<Tema, 'light' | 'dark'> = { claro: 'light', oscuro: 'dark' }

type GruposColor = typeof tokens.color
type Grupo = keyof GruposColor

/**
 * Resuelve un color de tokens.json para un tema.
 *
 * El `as` es necesario porque cada grupo trae ademas un `$comment` para
 * humanos, que no es un token.
 */
function color<G extends Grupo>(grupo: G, nombre: keyof GruposColor[G], tema: Tema): string {
  const entrada = tokens.color[grupo][nombre] as { dark: string; light: string }
  return entrada[VARIANTE[tema]]
}

// ───────────────────────────────────────────────────────────────────────
//  Color
// ───────────────────────────────────────────────────────────────────────

/**
 * Paleta de un tema.
 *
 * Dos familias semanticas, no una: `relleno` es el color de fondo de puntos,
 * barras e insignias (umbral de componente, 3:1) y `textoEstado` es el mismo
 * estado ajustado para LEERSE (AA 4.5:1). Usar el de relleno como texto es
 * exactamente el error que tokens.json existe para impedir.
 */
export interface ColoresTema {
  superficie: {
    /** Hundido: campos, bloques de codigo. */
    profunda: string
    /** Panel de navegacion. */
    honda: string
    /** Area de contenido. */
    base: string
    /** Tarjetas y filas. */
    elevada: string
    /** Modales, hojas, presionado. */
    superpuesta: string
    /** Fondo de un campo de formulario. */
    campo: string
  }
  borde: { normal: string; fuerte: string }
  marca: { base: string; hover: string; activo: string; suave: string; brillante: string }
  acento: { ciruela: string; ciruelaClara: string; arena: string }
  relleno: { exito: string; alerta: string; peligro: string; info: string; neutral: string }
  textoEstado: { exito: string; alerta: string; peligro: string; info: string; neutral: string }
  texto: {
    primario: string
    secundario: string
    apagado: string
    enlace: string
    sobreMarca: string
  }
  categoria: {
    core: string
    estandar: string
    avanzado: string
    vertical: string
    enterprise: string
    proveedor: string
  }
}

function coloresDe(tema: Tema): ColoresTema {
  return {
    superficie: {
      profunda: color('surface', 'deepest', tema),
      honda: color('surface', 'deep', tema),
      base: color('surface', 'base', tema),
      elevada: color('surface', 'raised', tema),
      superpuesta: color('surface', 'overlay', tema),
      campo: color('surface', 'input', tema),
    },
    borde: {
      normal: color('border', 'default', tema),
      fuerte: color('border', 'strong', tema),
    },
    marca: {
      base: color('brand', 'default', tema),
      hover: color('brand', 'hover', tema),
      activo: color('brand', 'active', tema),
      suave: color('brand', 'soft', tema),
      // El teal profundo no se distingue sobre fondo oscuro: el anillo de
      // foco y los indicadores usan este.
      brillante: color('brand', 'bright', tema),
    },
    acento: {
      ciruela: color('accent', 'plum', tema),
      ciruelaClara: color('accent', 'plumBright', tema),
      arena: color('accent', 'sand', tema),
    },
    relleno: {
      exito: color('semantic', 'success', tema),
      alerta: color('semantic', 'warning', tema),
      peligro: color('semantic', 'danger', tema),
      info: color('semantic', 'info', tema),
      neutral: color('semantic', 'neutral', tema),
    },
    textoEstado: {
      exito: color('semanticText', 'success', tema),
      alerta: color('semanticText', 'warning', tema),
      peligro: color('semanticText', 'danger', tema),
      info: color('semanticText', 'info', tema),
      neutral: color('semanticText', 'neutral', tema),
    },
    texto: {
      primario: color('text', 'primary', tema),
      secundario: color('text', 'secondary', tema),
      apagado: color('text', 'muted', tema),
      enlace: color('text', 'link', tema),
      sobreMarca: color('text', 'onBrand', tema),
    },
    categoria: {
      core: color('moduleCategory', 'core', tema),
      estandar: color('moduleCategory', 'standard', tema),
      avanzado: color('moduleCategory', 'advanced', tema),
      vertical: color('moduleCategory', 'vertical', tema),
      enterprise: color('moduleCategory', 'enterprise', tema),
      proveedor: color('moduleCategory', 'provider', tema),
    },
  }
}

/**
 * Aplica opacidad a un color de tokens.json.
 *
 * React Native no tiene `color-mix()`, que es lo que usa la web para el
 * fondo suave de las insignias. Si el token ya trae alfa (los `rgba` de
 * marca.suave) se devuelve tal cual: pisarle la opacidad seria inventarse
 * un valor que nadie verifico.
 */
export function conAlfa(colorBase: string, alfa: number): string {
  if (colorBase.startsWith('rgba(') || colorBase.startsWith('rgb(')) return colorBase

  const limpio = colorBase.replace('#', '')
  const ancho = limpio.length === 3 || limpio.length === 4 ? 1 : 2
  const canal = (indice: number): number => {
    const trozo = limpio.slice(indice * ancho, indice * ancho + ancho)
    return Number.parseInt(ancho === 1 ? trozo + trozo : trozo, 16)
  }

  return `rgba(${canal(0)}, ${canal(1)}, ${canal(2)}, ${alfa})`
}

// ───────────────────────────────────────────────────────────────────────
//  Forma y espaciado
// ───────────────────────────────────────────────────────────────────────

/** Radios contenidos: un ERP con esquinas de juguete no se lee como herramienta. */
export const radios = {
  sm: tokens.radius.sm,
  md: tokens.radius.md,
  lg: tokens.radius.lg,
  xl: tokens.radius.xl,
  /** Pildoras y puntos de estado. */
  completo: tokens.radius.full,
} as const

/** Escala de 4 px. Nada de margenes inventados. */
export const espacio = {
  0: tokens.space['0'],
  1: tokens.space['1'],
  2: tokens.space['2'],
  3: tokens.space['3'],
  4: tokens.space['4'],
  5: tokens.space['5'],
  6: tokens.space['6'],
  8: tokens.space['8'],
  10: tokens.space['10'],
  12: tokens.space['12'],
  16: tokens.space['16'],
} as const

export const disposicion = {
  barraSuperior: tokens.layout.topBar,
  navegacionLateral: tokens.layout.sidebar,
  filaTabla: tokens.layout.tableRow,
  /** 44x44 es el minimo tactil de la ley de Aurora (§11.7). Todo lo que se toca lo cumple. */
  areaTactil: tokens.layout.touchTarget,
} as const

/** Duraciones en ms. Se ignoran cuando el sistema pide movimiento reducido. */
export const movimiento = {
  hover: tokens.motion.duration.hover,
  pagina: tokens.motion.duration.page,
  modal: tokens.motion.duration.modal,
  toast: tokens.motion.duration.toast,
  cajon: tokens.motion.duration.drawer,
} as const

// ───────────────────────────────────────────────────────────────────────
//  Tipografia
// ───────────────────────────────────────────────────────────────────────

/** React Native tipa el grosor como cadena, no como numero. */
export type Peso = '400' | '500' | '600' | '700'

export interface EstiloTexto {
  tamano: number
  altura: number
  peso: Peso
  espaciadoLetra?: number
  mayusculas?: boolean
}

export type NombreEscala =
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'bodySm'
  | 'caption'
  | 'overline'

interface EscalaCruda {
  size: number
  lineHeight: number
  weight: number
  tracking?: number
  transform?: string
}

const CRUDAS: Record<NombreEscala, EscalaCruda> = tokens.font.scale

const PESOS: Record<number, Peso> = { 400: '400', 500: '500', 600: '600', 700: '700' }

function escalaDe(nombre: NombreEscala): EstiloTexto {
  const cruda = CRUDAS[nombre]
  return {
    tamano: cruda.size,
    altura: cruda.lineHeight,
    peso: PESOS[cruda.weight] ?? '400',
    // Se omiten en vez de ir en `undefined`: el repo usa exactOptionalPropertyTypes.
    ...(cruda.tracking !== undefined ? { espaciadoLetra: cruda.tracking } : {}),
    ...(cruda.transform === 'uppercase' ? { mayusculas: true } : {}),
  }
}

export const tipografia: Record<NombreEscala, EstiloTexto> = {
  display: escalaDe('display'),
  h1: escalaDe('h1'),
  h2: escalaDe('h2'),
  h3: escalaDe('h3'),
  body: escalaDe('body'),
  bodySm: escalaDe('bodySm'),
  caption: escalaDe('caption'),
  overline: escalaDe('overline'),
}

/**
 * `fontFamily` de React Native admite UNA familia, no una pila CSS como la
 * web: nos quedamos con la primera de tokens.json.
 */
function primeraFamilia(pila: string): string {
  const primera = pila.split(',')[0] ?? ''
  return primera.trim().replace(/^['"]|['"]$/g, '')
}

/**
 * Familias tipograficas.
 *
 * OJO: en movil la fuente hay que ENLAZARLA en apps/mobile (expo-font o
 * assets nativos). Una `fontFamily` sin enlazar se ignora en iOS y revienta
 * el render en Android, asi que `Texto` no aplica ninguna por defecto: usa
 * la del sistema hasta que la app pase `familia` a proposito.
 */
export const familias = {
  ui: primeraFamilia(tokens.font.family.ui),
  numerica: primeraFamilia(tokens.font.family.numeric),
  mono: primeraFamilia(tokens.font.family.mono),
} as const

/**
 * Cifras de ancho fijo para columnas de dinero y cantidades.
 *
 * Va como constante tipada y no como literal suelto porque React Native
 * espera una tupla de variantes conocidas, no un `string[]` cualquiera.
 */
export const cifrasTabulares: ['tabular-nums'] = ['tabular-nums']

// ───────────────────────────────────────────────────────────────────────
//  Los dos temas
// ───────────────────────────────────────────────────────────────────────

export interface TemaAurora {
  nombre: Tema
  color: ColoresTema
  radio: typeof radios
  espacio: typeof espacio
  tipografia: Record<NombreEscala, EstiloTexto>
  familia: typeof familias
  disposicion: typeof disposicion
  movimiento: typeof movimiento
}

function temaDe(nombre: Tema): TemaAurora {
  return {
    nombre,
    color: coloresDe(nombre),
    radio: radios,
    espacio,
    tipografia,
    familia: familias,
    disposicion,
    movimiento,
  }
}

export const temaClaro: TemaAurora = temaDe('claro')
export const temaOscuro: TemaAurora = temaDe('oscuro')

/** Los dos temas juntos, para elegir por nombre. */
export const temas: Record<Tema, TemaAurora> = {
  claro: temaClaro,
  oscuro: temaOscuro,
}
