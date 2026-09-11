import { Text, type TextProps } from 'react-native'
import { useTema } from '../useTema'
import type { NombreEscala } from '../tokens'

/**
 * Texto de Aurora.
 *
 * Todo texto de la app movil pasa por aqui: asi el tamano, la altura de
 * linea y el color salen de tokens.json y no del ojo de quien escribio la
 * pantalla. Ningun `color:` a mano en las apps.
 */
export type VarianteTexto =
  'display' | 'titulo' | 'subtitulo' | 'seccion' | 'cuerpo' | 'cuerpoSm' | 'pie' | 'etiqueta'

const ESCALA: Record<VarianteTexto, NombreEscala> = {
  display: 'display',
  titulo: 'h1',
  subtitulo: 'h2',
  seccion: 'h3',
  cuerpo: 'body',
  cuerpoSm: 'bodySm',
  pie: 'caption',
  etiqueta: 'overline',
}

export type TonoTexto =
  | 'primario'
  | 'secundario'
  | 'atenuado'
  | 'enlace'
  | 'marca'
  | 'sobreMarca'
  | 'exito'
  | 'alerta'
  | 'peligro'
  | 'info'
  | 'neutral'

export interface PropsTexto extends TextProps {
  variante?: VarianteTexto
  tono?: TonoTexto
}

export function Texto({ variante = 'cuerpo', tono = 'primario', style, ...resto }: PropsTexto) {
  const tema = useTema()
  const escala = tema.tipografia[ESCALA[variante]]

  // Los tonos de estado usan `textoEstado` y NUNCA `relleno`: el color de
  // un punto o una barra cumple 3:1, que no alcanza para leerse (§11.7).
  const color: Record<TonoTexto, string> = {
    primario: tema.color.texto.primario,
    secundario: tema.color.texto.secundario,
    atenuado: tema.color.texto.apagado,
    enlace: tema.color.texto.enlace,
    marca: tema.color.marca.brillante,
    sobreMarca: tema.color.texto.sobreMarca,
    exito: tema.color.textoEstado.exito,
    alerta: tema.color.textoEstado.alerta,
    peligro: tema.color.textoEstado.peligro,
    info: tema.color.textoEstado.info,
    neutral: tema.color.textoEstado.neutral,
  }

  return (
    <Text
      style={[
        {
          color: color[tono],
          fontSize: escala.tamano,
          lineHeight: escala.altura,
          fontWeight: escala.peso,
        },
        escala.espaciadoLetra !== undefined ? { letterSpacing: escala.espaciadoLetra } : null,
        escala.mayusculas ? { textTransform: 'uppercase' as const } : null,
        style,
      ]}
      {...resto}
    />
  )
}
