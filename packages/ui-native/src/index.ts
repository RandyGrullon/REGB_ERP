/**
 * Aurora en nativo.
 *
 * Lo que exporta este paquete es TODO lo que apps/mobile puede usar para
 * pintar: si una pantalla necesita un color, sale de `useTema()`, jamas de
 * un hex escrito a mano. La prueba de humo `aurora.test.ts` falla si algun
 * archivo de src/ que no sea tokens.ts escribe un color.
 */
export {
  conAlfa,
  radios,
  espacio,
  disposicion,
  movimiento,
  tipografia,
  familias,
  cifrasTabulares,
  temaClaro,
  temaOscuro,
  temas,
  type Tema,
  type TemaAurora,
  type ColoresTema,
  type EstiloTexto,
  type NombreEscala,
  type Peso,
} from './tokens'

export { useTema, temaPorNombre } from './useTema'

export { Texto, type PropsTexto, type VarianteTexto, type TonoTexto } from './componentes/Texto'
export { Boton, type PropsBoton, type VarianteBoton } from './componentes/Boton'
export { Campo, type PropsCampo } from './componentes/Campo'
export { Tarjeta } from './componentes/Tarjeta'
export { Insignia, type PropsInsignia, type TonoInsignia } from './componentes/Insignia'
export { Fila, type PropsFila } from './componentes/Fila'
export { EstadoVacio, type PropsEstadoVacio } from './componentes/EstadoVacio'
