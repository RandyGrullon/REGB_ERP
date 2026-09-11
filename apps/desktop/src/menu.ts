import type { MenuItemConstructorOptions } from 'electron'

/**
 * Menu y atajos del escritorio, en espanol.
 *
 * El import de arriba es SOLO de tipos: TypeScript lo borra al compilar, y
 * por eso este archivo se puede probar con vitest en Node sin arrancar
 * Electron. No metas aqui nada que llame a `Menu` o a `app`.
 *
 * Por que un menu propio y no el de Electron: el que trae por defecto esta
 * en ingles, dice "Toggle Developer Tools" y ofrece cosas que en una caja
 * registradora no pintan nada. En un mostrador dominicano el menu se lee en
 * espanol o no se lee.
 *
 * Por que acceleradores de menu y NO `globalShortcut`: los atajos globales
 * los captura el sistema entero, asi que la caja le robaria F2 a cualquier
 * otro programa que el dueno tenga abierto. Los del menu solo funcionan
 * cuando la ventana de REGB esta al frente, que es exactamente lo que se
 * quiere.
 */

export interface AccionesMenu {
  /** Lleva la ventana a la pantalla de cobro. */
  abrirCaja: () => void
  abrirGaveta: () => void
  sincronizarAhora: () => void
  recargar: () => void
  alternarHerramientas: () => void
  acercaDe: () => void
  salir: () => void
}

export function construirMenu(a: AccionesMenu, esMac: boolean): MenuItemConstructorOptions[] {
  const menuApp: MenuItemConstructorOptions[] = esMac
    ? [
        {
          label: 'REGB ERP',
          submenu: [
            { label: 'Acerca de REGB ERP', click: () => a.acercaDe() },
            { type: 'separator' },
            { label: 'Ocultar REGB ERP', role: 'hide' },
            { label: 'Ocultar otros', role: 'hideOthers' },
            { label: 'Mostrar todo', role: 'unhide' },
            { type: 'separator' },
            { label: 'Salir de REGB ERP', role: 'quit' },
          ],
        },
      ]
    : []

  const archivo: MenuItemConstructorOptions = {
    label: 'Archivo',
    submenu: esMac
      ? [{ label: 'Cerrar ventana', role: 'close' }]
      : [{ label: 'Salir', accelerator: 'CmdOrCtrl+Q', click: () => a.salir() }],
  }

  // Sin este menu, en macOS no funcionan Cmd+C ni Cmd+V dentro de la app:
  // alli el portapapeles cuelga de los roles del menu, no del navegador.
  // El cajero busca clientes copiando y pegando cedulas todo el dia.
  const editar: MenuItemConstructorOptions = {
    label: 'Editar',
    submenu: [
      { label: 'Deshacer', role: 'undo' },
      { label: 'Rehacer', role: 'redo' },
      { type: 'separator' },
      { label: 'Cortar', role: 'cut' },
      { label: 'Copiar', role: 'copy' },
      { label: 'Pegar', role: 'paste' },
      { label: 'Seleccionar todo', role: 'selectAll' },
    ],
  }

  const caja: MenuItemConstructorOptions = {
    label: 'Caja',
    submenu: [
      // F-keys porque es lo que ya tienen en la mano: los POS de toda la
      // vida se manejan asi y el personal viene entrenado de otro sistema.
      { label: 'Abrir caja', accelerator: 'F2', click: () => a.abrirCaja() },
      { label: 'Abrir gaveta de efectivo', accelerator: 'F4', click: () => a.abrirGaveta() },
      { type: 'separator' },
      {
        label: 'Subir ventas pendientes ahora',
        accelerator: 'CmdOrCtrl+Shift+S',
        click: () => a.sincronizarAhora(),
      },
    ],
  }

  const ver: MenuItemConstructorOptions = {
    label: 'Ver',
    submenu: [
      { label: 'Recargar', accelerator: 'CmdOrCtrl+R', click: () => a.recargar() },
      // Sin acelerador escrito a mano: el rol ya trae el correcto de cada
      // sistema (F11 en Windows y Linux, Ctrl+Cmd+F en macOS).
      { label: 'Pantalla completa', role: 'togglefullscreen' },
      { type: 'separator' },
      { label: 'Acercar', role: 'zoomIn' },
      { label: 'Alejar', role: 'zoomOut' },
      { label: 'Tamano normal', role: 'resetZoom' },
      { type: 'separator' },
      {
        label: 'Herramientas de desarrollo',
        accelerator: 'CmdOrCtrl+Shift+I',
        click: () => a.alternarHerramientas(),
      },
    ],
  }

  const ayuda: MenuItemConstructorOptions = {
    label: 'Ayuda',
    role: 'help',
    submenu: [{ label: 'Acerca de REGB ERP', click: () => a.acercaDe() }],
  }

  return [...menuApp, archivo, editar, caja, ver, ayuda]
}
