/**
 * Contenido de los tours (§5.1 core 14, S13).
 *
 * Los pasos son DATOS, no codigo: cada modulo aporta su tour y el motor
 * los pinta igual. Un modulo nuevo trae su tour sin tocar el core.
 */

export interface TourStep {
  title: string
  body: string
  /** A donde lleva "Hazlo ahora". Relativo, sin query string. */
  action?: { label: string; path: string }
  /** Lo que sabe quien ya lleva tiempo usando un ERP. */
  tip?: string
}

export interface Tour {
  id: string
  /** Modulo que lo aporta: si no esta licenciado, el tour no aparece. */
  moduleId: string
  title: string
  summary: string
  xp: number
  steps: TourStep[]
}

export const TOURS: Tour[] = [
  {
    id: 'core.bienvenida',
    moduleId: 'tour',
    title: 'Primeros pasos en REGB',
    summary: 'Lo minimo para dejar de usar Excel: tu empresa, tu gente y tu catalogo.',
    xp: 50,
    steps: [
      {
        title: 'Confirma los datos de tu empresa',
        body: 'Tu razon social y tu RNC salen en cada factura. Revisalos una vez y olvidate.',
        action: { label: 'Ir a Empresas', path: '/empresas' },
        tip: 'Si facturas con mas de un RNC, agregalos todos ahora: cambiar despues obliga a re-emitir comprobantes.',
      },
      {
        title: 'Abre tus sucursales',
        body: 'Cada local, almacen o punto de venta es una sucursal. El inventario se cuenta por sucursal.',
        action: { label: 'Ir a Sucursales', path: '/sucursales' },
      },
      {
        title: 'Invita a tu equipo',
        body: 'Cada quien entra con su propio usuario. Nunca compartas una clave: la bitacora deja de servir si dos personas son "el mismo" usuario.',
        action: { label: 'Ir a Usuarios', path: '/usuarios' },
        tip: 'Empieza con roles estrechos. Ampliar permisos es facil; explicar un descuadre no.',
      },
      {
        title: 'Sube tu catalogo',
        body: 'Exporta tus productos a CSV desde donde los tengas hoy y subelos. Si algo sale mal, deshaces la importacion completa.',
        action: { label: 'Ir a Importar', path: '/importar' },
      },
      {
        title: 'Ajusta lo que ve cada rol',
        body: 'El cajero no necesita ver los costos. Oculta modulos por rol y la ruta directa devuelve 403, no datos.',
        action: { label: 'Ir a Roles y permisos', path: '/roles' },
      },
    ],
  },
  {
    id: 'core.permisos',
    moduleId: 'rbac',
    title: 'Como ocultar modulos a un rol',
    summary: 'Quien ve que, y por que la URL directa tampoco funciona.',
    xp: 30,
    steps: [
      {
        title: 'Un rol es una lista de permisos',
        body: 'Cada modulo declara los suyos (ver, crear, editar, borrar). El rol concede o niega.',
        action: { label: 'Abrir Roles', path: '/roles' },
      },
      {
        title: 'Negar siempre gana',
        body: 'Si un rol concede "ventas.*" pero niega "ventas.descuento", el descuento queda negado. La denegacion pesa mas que el comodin.',
      },
      {
        title: 'El servidor tambien comprueba',
        body: 'Ocultar el boton no es seguridad. Cada ruta y cada accion vuelven a verificar el permiso en el servidor, y la base de datos filtra por su cuenta.',
        tip: 'Pruebalo: cambia de rol arriba a la derecha y escribe una ruta que ese rol no tenga. Sale 404.',
      },
    ],
  },
  {
    id: 'core.marketplace',
    moduleId: 'marketplace',
    title: 'Como funciona el marketplace',
    summary: 'Empieza con lo minimo y agrega piezas cuando el negocio las pida.',
    xp: 20,
    steps: [
      {
        title: 'Pagas por lo que activas',
        body: 'Cada modulo tiene precio de instalacion y mensualidad, distintos segun tu plan. Lo ves antes de activar.',
        action: { label: 'Abrir Marketplace', path: '/marketplace' },
      },
      {
        title: 'Prueba 14 dias gratis',
        body: 'Casi todo modulo se puede probar. Si no lo activas al terminar, deja de verse — pero tus datos quedan intactos por si vuelves.',
      },
      {
        title: 'Desinstalar nunca borra',
        body: 'Apagar un modulo lo esconde y deja de cobrarse. Los datos siguen ahi el dia que lo reactives.',
      },
    ],
  },
  // -- F4: los modulos con los que un negocio deja Excel -----------------
  {
    id: 'f4.catalogo',
    moduleId: 'products',
    title: 'Arma tu catalogo',
    summary: 'Lo que vendes, a que precio y con que impuesto. Todo lo demas cuelga de aqui.',
    xp: 40,
    steps: [
      {
        title: 'Trae lo que ya tienes',
        body: 'No teclees mil productos. Exporta a CSV desde donde los tengas y subelos: si algo sale mal deshaces la importacion completa.',
        action: { label: 'Ir a Importar', path: '/importar' },
        tip: 'Importa primero 10 filas de prueba. Si esas quedan bien, el resto tambien.',
      },
      {
        title: 'Agrupa por categorias',
        body: 'Las categorias son para encontrar y para reportar, no para decorar. Con 8 o 10 alcanza; una por producto no sirve para nada.',
        action: { label: 'Ir a Categorias', path: '/products/categories' },
      },
      {
        title: 'Revisa el ITBIS de cada producto',
        body: 'La mayoria lleva 18%, pero los alimentos sin procesar estan exentos. Un impuesto mal puesto no se nota vendiendo: se nota declarando.',
        action: { label: 'Ir al Catalogo', path: '/products' },
        tip: 'El arroz, la habichuela y el platano van exentos. La galleta y el refresco, no.',
      },
      {
        title: 'Pon el codigo de barras',
        body: 'Con el codigo cargado, el lector de la caja resuelve el producto solo. Sin el, el cajero lo busca por nombre y la fila crece.',
        action: { label: 'Ir al Catalogo', path: '/products' },
      },
      {
        title: 'Marca que lleva inventario',
        body: 'Un servicio, como una instalacion o una hora de mano de obra, se vende pero no se cuenta. Desmarcalo y deja de aparecer en existencias.',
      },
      {
        title: 'Un producto no se borra, se desactiva',
        body: 'Borrarlo romperia las ventas viejas que lo mencionan. Desactivado deja de venderse y el historial sigue completo.',
        tip: 'Si un producto desaparecio, casi siempre esta desactivado. Revisa el filtro de la lista.',
      },
    ],
  },
  {
    id: 'f4.inventario',
    moduleId: 'inventory',
    title: 'Cuadra tu inventario',
    summary: 'Cuanto tienes, cuanto vale y por que cambio. El libro no se edita: se corrige.',
    xp: 60,
    steps: [
      {
        title: 'Carga tus existencias iniciales',
        body: 'Cuenta lo que hay hoy y registralo como ajuste de entrada, con su costo. Sin costo, la valorizacion del inventario nace mal.',
        action: { label: 'Ir a Movimientos', path: '/inventory/movements' },
        tip: 'Hazlo un domingo o de noche. Cargar existencias mientras vendes garantiza que no cuadre.',
      },
      {
        title: 'Entiende el semaforo',
        body: 'Verde es que hay de sobra; amarillo, que llegaste al punto de reorden; rojo, que ya no tienes. El punto de reorden lo pones tu por producto.',
        action: { label: 'Ir a Existencias', path: '/inventory' },
      },
      {
        title: 'Disponible no es lo mismo que fisico',
        body: 'Lo apartado para un pedido confirmado sigue en el almacen pero ya tiene dueno. Disponible es fisico menos apartado, y es lo unico que puedes prometer.',
        action: { label: 'Ir a Existencias', path: '/inventory' },
      },
      {
        title: 'El costo es promedio ponderado',
        body: 'Cada entrada recalcula el promedio; las salidas consumen a ese promedio. Comprar mas caro sube el costo de todo lo que tienes, no solo de lo nuevo.',
      },
      {
        title: 'Un movimiento no se edita ni se borra',
        body: 'El kardex es un libro: para corregir se hace el movimiento contrario y quedan los dos. Eso es lo que hace que un conteo sea defendible.',
        action: { label: 'Ir a Movimientos', path: '/inventory/movements' },
        tip: 'Si alguien te ofrece arreglar un movimiento directo en la base, di que no. Ahi empieza el descuadre.',
      },
      {
        title: 'Cuenta por partes, no todo de golpe',
        body: 'Un conteo ciclico toma una zona a la vez y compara con lo que dice el sistema. Cerrar la tienda para contarlo todo cuesta mas de lo que corrige.',
        action: { label: 'Ir a Conteos', path: '/inventory/counts' },
      },
    ],
  },
  {
    id: 'f4.pedidos',
    moduleId: 'sales-orders',
    title: 'Vende a credito sin perder el hilo',
    summary: 'Del pedido a la entrega, con el stock apartado desde que confirmas.',
    xp: 50,
    steps: [
      {
        title: 'Registra tus clientes',
        body: 'Nombre, RNC y a cuantos dias le fias. El RNC se verifica al guardarlo: un digito mal escrito hace rebotar el reporte del mes.',
        action: { label: 'Ir a Clientes', path: '/pedidos/clientes' },
        tip: 'Los dias de credito que pongas aqui son los que despues deciden quien esta en mora.',
      },
      {
        title: 'Un pedido nace en borrador',
        body: 'En borrador se corrige libremente y no toca el inventario. Nada se aparta hasta que lo confirmas.',
        action: { label: 'Ir a Pedidos', path: '/pedidos' },
      },
      {
        title: 'Confirmar aparta, no entrega',
        body: 'Al confirmar, la mercancia queda con dueno pero sigue en el almacen. Es lo que evita venderle el mismo saco a dos clientes.',
      },
      {
        title: 'Lo que no alcanza queda en backorder',
        body: 'Si pides 25 y hay 20, se apartan 20 y 5 quedan pendientes. El pedido no se rechaza: te dice exactamente cuanto te falta.',
        tip: 'Revisa el backorder antes de comprar. Es tu lista de compras hecha por los clientes.',
      },
      {
        title: 'Entrega completo o por partes',
        body: 'Entregar es lo que saca la mercancia del almacen. Puedes entregar parcial las veces que haga falta; el estado del pedido se mueve solo.',
        action: { label: 'Ir a Pedidos', path: '/pedidos' },
      },
      {
        title: 'Entregado no es cobrado',
        body: 'La factura se crea aparte, a proposito: automatizarla con la entrega produce facturas duplicadas el dia que algo se reintenta.',
        action: { label: 'Ir a Por cobrar', path: '/cobrar' },
      },
    ],
  },
  {
    id: 'f4.caja',
    moduleId: 'pos',
    title: 'Abre y cierra caja sin descuadres',
    summary: 'Turno, venta al contado y arqueo. Con lector de codigo y ticket impreso.',
    xp: 50,
    steps: [
      {
        title: 'Todo empieza con un turno',
        body: 'Abre el turno con el efectivo con que arrancas. Sin turno no hay arqueo, y sin arqueo nadie responde por la gaveta.',
        action: { label: 'Ir a Turnos', path: '/pos/shifts' },
        tip: 'Un turno por cajero y por caja. Dos personas en el mismo turno hacen imposible saber de quien fue el faltante.',
      },
      {
        title: 'Escanea o busca',
        body: 'El lector de codigo de barras es un teclado: teclea el codigo y manda Enter. No hace falta instalar nada, solo que el producto tenga su codigo cargado.',
        action: { label: 'Ir a Caja', path: '/pos' },
      },
      {
        title: 'Cobra mezclando formas de pago',
        body: 'Una parte en efectivo y otra en tarjeta es normal. Registralas por separado: si las juntas, el arqueo del efectivo deja de cuadrar.',
      },
      {
        title: 'El comprobante fiscal sale solo',
        body: 'Cliente con RNC recibe B01, para que pueda deducir el ITBIS; el de mostrador, B02. Si no hay secuencia cargada la caja no se traba, pero el ticket lo dice.',
        action: { label: 'Ir a Comprobantes', path: '/cobrar/ncf' },
      },
      {
        title: 'Imprime en termica de 80 mm',
        body: 'Una termica USB se instala como impresora normal. Desde Cierres, toca el numero del ticket y mandalo al papel.',
        action: { label: 'Ir a Cierres', path: '/pos/reports' },
      },
      {
        title: 'Cierra contando de verdad',
        body: 'Cuenta el efectivo antes de mirar lo esperado. Si miras primero, cuentas para que cuadre, y ahi se pierde el control.',
        action: { label: 'Ir a Turnos', path: '/pos/shifts' },
        tip: 'Una diferencia pequena y constante casi nunca es robo: suele ser vuelto mal dado o un precio desactualizado.',
      },
      {
        title: 'Anular deja rastro',
        body: 'Un ticket anulado no desaparece: se marca, devuelve la mercancia al almacen y su NCF se declara como anulado. Un hueco en la numeracion es lo que llama la atencion de la DGII.',
      },
    ],
  },
  {
    id: 'f4.cobrar',
    moduleId: 'ar',
    title: 'Cobra lo que te deben',
    summary: 'Facturas, comprobantes fiscales, antiguedad de saldos y lo que se declara.',
    xp: 60,
    steps: [
      {
        title: 'Carga tu autorizacion de la DGII',
        body: 'Es lo primero: sin una secuencia de NCF vigente no puedes emitir una factura valida. Pedirla toma dias, asi que gestionala antes de necesitarla.',
        action: { label: 'Ir a Comprobantes', path: '/cobrar/ncf' },
        tip: 'La pantalla te avisa cuando quedan pocos o esta por vencer. Hazle caso la primera vez que lo diga.',
      },
      {
        title: 'Factura desde el pedido entregado',
        body: 'La factura toma las lineas del pedido y consume un NCF. Ese numero no vuelve nunca, ni aunque despues la anules.',
        action: { label: 'Ir a Por cobrar', path: '/cobrar' },
      },
      {
        title: 'El saldo se calcula, no se guarda',
        body: 'El pendiente sale de restar cobros y notas de credito al total. Guardarlo como numero suelto es como se desincroniza una cartera.',
      },
      {
        title: 'Registra cobros parciales',
        body: 'Un cliente que abona la mitad deja la factura en pagada parcialmente. No se acepta cobrar mas del saldo: eso es un anticipo, no un cobro.',
      },
      {
        title: 'Lee la antiguedad por tramos',
        body: 'De 1 a 30 dias es normal; pasando 60, empieza a doler; sobre 90, casi nunca se cobra completo. Envejece el saldo pendiente, no el total.',
        action: { label: 'Ir a Cartera', path: '/cobrar/cartera' },
        tip: 'Llama a los de 31 a 60. Los de mas de 90 ya son una negociacion, no una llamada.',
      },
      {
        title: 'Revisa lo que vas a declarar',
        body: 'El 607 junta tus ventas del mes, facturas y caja, y el 608 los comprobantes anulados. Miralo antes de la fecha limite, no el dia 20.',
        action: { label: 'Ir a Reportes DGII', path: '/cobrar/dgii' },
      },
    ],
  },
]

export function toursFor(licensedModules: Set<string>): Tour[] {
  return TOURS.filter((t) => licensedModules.has(t.moduleId))
}
