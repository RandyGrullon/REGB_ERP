import { spawn } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Impresora termica y gaveta de efectivo.
 *
 * Dos caminos distintos porque son dos cosas distintas:
 *
 *  - El TICKET es HTML y lo imprime Chromium con `webContents.print`. Es
 *    exactamente la misma pagina de 80 mm que ya usa la version web, asi
 *    que el papel sale igual en las dos y no hay dos maquetaciones que
 *    mantener. Lo unico que anade el escritorio es `silent`: sin dialogo.
 *
 *  - La GAVETA no es imprimir: es mandarle a la impresora un pulso ESC/POS
 *    crudo por el puerto. Chromium no puede escribir bytes sueltos —solo
 *    sabe pintar—, asi que se manda por el sistema operativo.
 *
 * En Windows se copia el archivo binario al recurso compartido de la
 * impresora. Es el metodo que funciona sin compilar modulos nativos, y
 * compilar nativos en el equipo de un colmado es exactamente lo que no se
 * puede pedir. A cambio, la impresora tiene que estar COMPARTIDA con un
 * nombre — queda escrito en la guia de instalacion.
 */

/**
 * ESC p m t1 t2 — abre la gaveta conectada al puerto RJ11 de la impresora.
 *
 * `m=0` es el pin 2, que es el que usa practicamente toda gaveta del
 * mercado. Los tiempos van en unidades de 2 ms: 25 y 250 son los valores
 * que recomiendan los manuales de Epson y los clones respetan.
 */
export const PULSO_GAVETA = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])

export interface OpcionesImpresora {
  /** Nombre compartido de la impresora, ej. `TERMICA80`. */
  recursoCompartido?: string
  /** Equipo donde esta compartida. Por defecto, este. */
  equipo?: string
}

/** Abre la gaveta. Devuelve por que no se pudo, si no se pudo. */
export async function abrirGaveta(o: OpcionesImpresora): Promise<{ ok: boolean; error?: string }> {
  if (!o.recursoCompartido) {
    return {
      ok: false,
      error:
        'No hay impresora configurada. Comparte la termica en Windows con un nombre y ponlo en los ajustes.',
    }
  }

  const archivo = join(tmpdir(), `regb-gaveta-${Date.now()}.bin`)
  try {
    writeFileSync(archivo, PULSO_GAVETA)
    const destino = `\\\\${o.equipo ?? '%COMPUTERNAME%'}\\${o.recursoCompartido}`

    await new Promise<void>((resolve, reject) => {
      // `copy /b` copia en binario: sin `/b`, cmd corta el archivo en el
      // primer 0x1a y el pulso nunca llega entero.
      const p = spawn('cmd', ['/c', 'copy', '/b', archivo, destino], { windowsHide: true })
      let err = ''
      p.stderr.on('data', (d) => (err += String(d)))
      p.on('error', reject)
      p.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(err.trim() || `copy devolvio ${code}`)),
      )
    })
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'No se pudo mandar el pulso a la impresora.',
    }
  } finally {
    try {
      unlinkSync(archivo)
    } catch {
      /* el temporal se lo lleva el sistema */
    }
  }
}
