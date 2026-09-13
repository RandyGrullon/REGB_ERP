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
  /**
   * Valor de `data-tour` del elemento a resaltar en la pantalla de
   * destino. Opcional: sin el, la guia sale igual y no resalta nada.
   *
   * Es un NOMBRE, no un selector CSS. El contenido de un tour es dato
   * editable, y un selector crudo dejaria que ese dato apuntara a
   * cualquier cosa del documento; con el atributo, lo unico alcanzable
   * es lo que la UI marco a proposito.
   */
  target?: string
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
        target: 'empresa-nueva',
        tip: 'Si facturas con mas de un RNC, agregalos todos ahora: cambiar despues obliga a re-emitir comprobantes.',
      },
      {
        title: 'Abre tus sucursales',
        body: 'Cada local, almacen o punto de venta es una sucursal. El inventario se cuenta por sucursal.',
        action: { label: 'Ir a Sucursales', path: '/sucursales' },
        target: 'sucursal-nueva',
      },
      {
        title: 'Invita a tu equipo',
        body: 'Cada quien entra con su propio usuario. Nunca compartas una clave: la bitacora deja de servir si dos personas son "el mismo" usuario.',
        action: { label: 'Ir a Usuarios', path: '/usuarios' },
        target: 'usuario-invitar',
        tip: 'Empieza con roles estrechos. Ampliar permisos es facil; explicar un descuadre no.',
      },
      {
        title: 'Sube tu catalogo',
        body: 'Exporta tus productos a CSV desde donde los tengas hoy y subelos. Si algo sale mal, deshaces la importacion completa.',
        action: { label: 'Ir a Importar', path: '/importar' },
        target: 'importar-csv',
      },
      {
        title: 'Ajusta lo que ve cada rol',
        body: 'El cajero no necesita ver los costos. Oculta modulos por rol y la ruta directa devuelve 403, no datos.',
        action: { label: 'Ir a Roles y permisos', path: '/roles' },
        target: 'rol-modulos-visibles',
      },
    ],
  },
  {
    id: 'core.permisos',
    // 'rbac' NO es un modulo del catalogo. `toursFor` filtra por los
    // modulos licenciados del tenant, asi que con ese id este tour no se
    // le enseñaba NUNCA a nadie -escrito, mantenido y muerto-. Los
    // permisos los declara cada modulo pero quien los reparte es 'users'.
    moduleId: 'users',
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
      {
        title: 'Empieza estrecho y ve abriendo',
        body: 'Dale a cada quien lo justo para su trabajo. Ampliar un permiso toma diez segundos; explicar quien toco un precio, semanas.',
        action: { label: 'Ver la bitacora', path: '/auditoria' },
        tip: 'Todo queda en la bitacora con usuario, hora y el valor de antes. Es lo que te salva en una discusion con un empleado.',
      },
    ],
  },
  {
    id: 'core.marketplace',
    // Mismo caso que 'rbac': no hay modulo 'marketplace' en el catalogo.
    // El marketplace es parte de la configuracion del tenant.
    moduleId: 'settings',
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
      {
        title: 'Unos modulos piden otros',
        body: 'Facturar necesita catalogo; contabilizar necesita facturar. Si le falta uno, te lo dice antes de cobrarte, no despues.',
        action: { label: 'Abrir Marketplace', path: '/marketplace' },
        tip: 'Los que dicen "recomendado" son opcionales: el modulo funciona sin ellos, solo que con menos.',
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
  {
    id: 'f4.compras',
    moduleId: 'purchase-orders',
    title: 'Pide al proveedor y recibe con el costo real',
    summary: 'Confirmar es la promesa del proveedor; recibir es lo que de verdad entra.',
    xp: 50,
    steps: [
      {
        title: 'Registra tus proveedores',
        body: 'Nombre, RNC y cuantos dias de credito te da. Es lo minimo para armar una orden.',
        action: { label: 'Ir a Proveedores', path: '/compras/proveedores' },
      },
      {
        title: 'Una orden nace en borrador',
        body: 'Le agregas productos con el costo que este proveedor te cotizo hoy, no el que dice el catalogo. En borrador se corrige libremente.',
        action: { label: 'Ir a Compras', path: '/compras' },
      },
      {
        title: 'Confirmar NO mueve inventario',
        body: 'Al reves que un pedido de venta: confirmar es la promesa del proveedor, no la tuya. El almacen no cambia hasta que de verdad llega el camion.',
        tip: 'Si necesitas saber cuanto tienes comprometido con proveedores, es la suma de las ordenes confirmadas, no de las recibidas.',
      },
      {
        title: 'Recibe completo o por partes',
        body: 'El camion trae 80 de 100 pedidos: recibe esos 80 hoy y el resto cuando llegue. El estado de la orden se mueve solo.',
        action: { label: 'Ir a Compras', path: '/compras' },
      },
      {
        title: 'El costo real es el que promedia',
        body: 'Si el proveedor te cobra distinto a lo cotizado, declaralo al recibir. Ese es el costo que entra al promedio ponderado del inventario, no el que pediste.',
        tip: 'Una diferencia grande y repetida con el mismo proveedor es la senal de que hay que renegociar o buscar otro.',
      },
      {
        title: 'Cancelar no revierte lo recibido',
        body: 'Cancelar una orden detiene lo que falta por llegar. Lo que ya entro al almacen se queda —ya es tuyo—, igual que una entrega ya hecha en un pedido de venta.',
      },
    ],
  },
  // -- Facturacion y cumplimiento con la DGII --------------------------
  {
    id: 'f5.ecf',
    moduleId: 'e-invoice',
    title: 'Factura electronica sin sustos',
    summary: 'Lo que la DGII exige, en el orden en que hay que hacerlo.',
    xp: 60,
    steps: [
      {
        title: 'Primero el certificado, sin el no hay nada',
        body: 'Necesitas un certificado digital de PERSONA FISICA emitido bajo la Ley 126-02. No lo emite la DGII: lo vende una entidad acreditada por INDOTEL y tarda dias.',
        action: { label: 'Abrir Factura electronica', path: '/facturacion-electronica' },
        tip: 'Sacalo a nombre de quien firma de verdad. Un certificado prestado firma facturas que legalmente hizo otra persona.',
      },
      {
        title: 'Empieza en el ambiente de pruebas',
        body: 'La DGII tiene tres ambientes: pruebas, certificacion y produccion. Se pasa por los tres en ese orden, y en los dos primeros nada de lo que mandes cuenta.',
        tip: 'Deja el ambiente en pruebas hasta que la DGII te certifique. Cambiarlo antes manda facturas de verdad que despues hay que anular.',
      },
      {
        title: 'Copia tus tres URL al formulario de la DGII',
        body: 'La DGII te manda a TU sistema los comprobantes que otros te emiten. Aqui tienes las tres direcciones que te piden en el formulario de postulacion.',
        action: { label: 'Ver mis URL', path: '/facturacion-electronica' },
        tip: 'Esas URL llevan una clave dentro. No las publiques ni las mandes por WhatsApp a nadie que no sea la DGII.',
      },
      {
        title: 'Por debajo de RD$250,000 va por otro camino',
        body: 'Una factura de consumo bajo ese monto se manda como RESUMEN y a un servidor distinto. El sistema lo decide solo, pero conviene que sepas que existen dos caminos.',
        tip: 'Ese es el camino normal de una tienda. Si ves un monto rondando el limite, revisa antes de emitir: cruzarlo cambia el formato.',
      },
      {
        title: 'Mandar no es lo mismo que aceptado',
        body: 'Cuando envias, la DGII te da un numero de seguimiento y nada mas. El veredicto llega despues, aparte. Una factura enviada todavia puede ser rechazada.',
        action: { label: 'Ver enviados', path: '/facturacion-electronica' },
      },
      {
        title: 'Si se te cae el internet, sigues vendiendo',
        body: 'Emites igual y tienes 72 horas para remitirlo. Si lo que se cayo es el sistema entero, puedes usar papel hasta 15 dias, con la leyenda que manda la norma.',
        tip: 'Las 72 horas corren desde la emision, no desde que vuelve el internet. Manda lo pendiente el mismo dia que se restablezca.',
      },
    ],
  },
  {
    id: 'f5.ncf',
    moduleId: 'ar',
    title: 'NCF: que secuencia usar y cuando',
    summary: 'El tipo de comprobante lo decide tu cliente, no tu.',
    xp: 35,
    steps: [
      {
        title: 'El tipo depende de quien compra',
        body: 'Con RNC y que va a deducir el ITBIS, credito fiscal. Sin RNC, consumo. Poner el tipo equivocado obliga a anular y re-emitir.',
        action: { label: 'Ir a Comprobantes', path: '/cobrar/ncf' },
      },
      {
        title: 'Carga tus secuencias antes de venderlas',
        body: 'La DGII te autoriza rangos con fecha de vencimiento. Cargalos aqui y el sistema va tomando el siguiente numero solo.',
        action: { label: 'Cargar secuencia', path: '/cobrar/ncf' },
        tip: 'Pon una alerta cuando te queden 50. Quedarte sin NCF un sabado es no poder facturar hasta el lunes.',
      },
      {
        title: 'Un numero usado no se reusa jamas',
        body: 'Si anulas una factura, ese NCF queda quemado. El siguiente sigue la secuencia: nunca se rellenan huecos.',
        tip: 'Los huecos no son problema. Reusar un numero si lo es, y sale en la 607.',
      },
      {
        title: 'Vencido no sirve aunque sobren numeros',
        body: 'Cada rango tiene fecha limite. Pasada esa fecha, los numeros que queden se pierden y hay que pedir rango nuevo.',
      },
      {
        title: 'La 606 y la 607 salen de aqui',
        body: 'Lo que factures y lo que te facturen arma los reportes que se suben a la DGII cada mes. Si el NCF esta mal, el reporte sale mal.',
        action: { label: 'Ver reportes DGII', path: '/cobrar/dgii' },
        tip: 'Revisa la 607 ANTES del dia 20, no ese mismo dia. Corregir un NCF obliga a tocar la factura.',
      },
    ],
  },
  // -- Dinero que entra y que sale -------------------------------------
  {
    id: 'f6.tesoreria',
    moduleId: 'treasury',
    title: 'Saber cuanto tienes de verdad',
    summary: 'Cuentas, movimientos y el flujo de las proximas semanas.',
    xp: 40,
    steps: [
      {
        title: 'Registra tus cuentas',
        body: 'Banco, caja chica, efectivo. Cada una con su saldo del dia que empiezas: ese es el punto de partida y no se vuelve a tocar.',
        action: { label: 'Ir a Tesoreria', path: '/tesoreria' },
      },
      {
        title: 'Un movimiento no se edita, se contra-asienta',
        body: 'Si registraste mal, haces el movimiento contrario. El libro queda completo y se ve que hubo una correccion, que es justo lo que quiere un auditor.',
        tip: 'Escribe en el concepto por que corriges. Dentro de seis meses ni tu te acuerdas.',
      },
      {
        title: 'Las transferencias son un solo acto',
        body: 'Mover plata entre dos cuentas tuyas crea las dos patas a la vez. Nunca las registres por separado: es como se descuadra una conciliacion.',
        action: { label: 'Ver transferencias', path: '/tesoreria' },
      },
      {
        title: 'El flujo te avisa antes de que duela',
        body: 'Cruza lo que te deben con lo que debes y te dice si llegas a fin de mes. Se mira los lunes, no el dia que falta la plata.',
        action: { label: 'Ver flujo de caja', path: '/tesoreria/flujo' },
        tip: 'Si el flujo se pone rojo en tres semanas, tienes tres semanas para cobrar. Enterarte el viernes no te deja margen.',
      },
      {
        title: 'Concilia con el estado del banco',
        body: 'Subes el estado de cuenta y el sistema casa lo que cuadra. Lo que no casa es lo unico que tienes que mirar con ojos.',
        action: { label: 'Ir a Conciliacion', path: '/conciliacion' },
      },
    ],
  },
  {
    id: 'f6.pagar',
    moduleId: 'ap',
    title: 'Pagarle a tus proveedores',
    summary: 'Que debes, a quien, y cuando conviene pagarlo.',
    xp: 35,
    steps: [
      {
        title: 'La factura del proveedor entra aqui',
        body: 'Con su NCF, su fecha y su vencimiento. De aqui sale tu 606, asi que el NCF tiene que ser el que trae el papel.',
        action: { label: 'Ir a Cuentas por pagar', path: '/pagar' },
      },
      {
        title: 'Lo que vence esta semana, primero',
        body: 'La lista se ordena por vencimiento. Pagar antes de tiempo es regalarle flujo al proveedor; pagar tarde es perder credito.',
        tip: 'Si el proveedor da descuento por pronto pago, compara ese descuento con lo que te cuesta el dinero. Muchas veces conviene.',
      },
      {
        title: 'Un pago puede cubrir varias facturas',
        body: 'Registras el pago y lo repartes entre las facturas que salda. Los saldos se ajustan solos.',
        action: { label: 'Registrar pago', path: '/pagar' },
      },
      {
        title: 'Retenciones: se descuentan, no se regalan',
        body: 'Si le retienes ITBIS o ISR a un proveedor, esa plata es de la DGII y tu la guardas hasta declararla. No es tuya aunque este en tu cuenta.',
        tip: 'Separa las retenciones del saldo disponible en tu cabeza. Es el error que mas descuadra a una pyme.',
      },
      {
        title: 'Cruza con lo que recibiste',
        body: 'La factura del proveedor deberia cuadrar con la orden de compra y con lo que entro al almacen. Las tres cosas, no dos.',
        action: { label: 'Ver recepciones', path: '/recepciones' },
      },
    ],
  },
  // -- Gente ------------------------------------------------------------
  {
    id: 'f7.empleados',
    moduleId: 'employees',
    title: 'Tu gente, en un solo sitio',
    summary: 'El expediente que necesitas cuando el Ministerio pregunta.',
    xp: 30,
    steps: [
      {
        title: 'Un expediente por persona',
        body: 'Cedula, fecha de entrada, cargo, salario y contrato. De aqui sale la nomina, la TSS y cualquier carta que te pidan.',
        action: { label: 'Ir a Empleados', path: '/empleados' },
      },
      {
        title: 'La fecha de entrada decide casi todo',
        body: 'De ella salen las vacaciones, la antiguedad y la prestacion laboral. Ponla bien desde el primer dia: cambiarla despues recalcula anos de historia.',
        tip: 'Si migras de otro sistema, la fecha que vale es la del contrato original, no la del dia que cargaste el dato.',
      },
      {
        title: 'Quien le reporta a quien',
        body: 'Marca el supervisor de cada quien. Con eso se arma el organigrama solo y las aprobaciones saben a quien pedirle permiso.',
        action: { label: 'Ver organigrama', path: '/empleados/organigrama' },
      },
      {
        title: 'Un empleado que sale no se borra',
        body: 'Se da de baja con su fecha y su motivo. Tienes que poder responder por el dentro de cinco anos, y borrarlo te deja sin con que.',
        tip: 'El motivo de salida importa: desahucio, despido y renuncia se liquidan distinto.',
      },
      {
        title: 'Guarda los documentos ahi mismo',
        body: 'Contrato, cedula, certificados. El dia de una inspeccion los quieres en un sitio, no en tres carpetas y un WhatsApp.',
        action: { label: 'Ir a Archivos', path: '/archivos' },
      },
    ],
  },
  {
    id: 'f7.nomina',
    moduleId: 'payroll',
    title: 'Correr la nomina sin rezar',
    summary: 'Del periodo al pago, con la TSS cuadrada.',
    xp: 55,
    steps: [
      {
        title: 'Primero el periodo, despues los calculos',
        body: 'Abres el periodo -quincenal o mensual- y el sistema toma lo que haya de asistencia, horas extra, prestamos y comisiones.',
        action: { label: 'Ir a Nomina', path: '/payroll' },
      },
      {
        title: 'Revisa ANTES de procesar',
        body: 'Un periodo procesado queda inmutable, igual que un pago. Es a proposito: la nomina es un documento legal, no un borrador.',
        action: { label: 'Correr nomina', path: '/payroll/run' },
        tip: 'Mira primero los que cambiaron de salario o entraron a mitad de mes. Ahi esta el 90% de los errores.',
      },
      {
        title: 'Las deducciones de ley no son opcionales',
        body: 'AFP, SFS e ISR salen calculados segun los topes vigentes. Si cambia un tope, cambia aqui y no en cada empleado.',
      },
      {
        title: 'Si te equivocaste, ajustas en el siguiente',
        body: 'No se reabre un periodo cerrado. Se hace el ajuste en el periodo siguiente, que es como lo pide cualquier auditoria.',
        tip: 'Avisale a la persona antes de que vea el ajuste en su volante. Un descuento sin explicar cuesta mas que el error.',
      },
      {
        title: 'Los reportes que te van a pedir',
        body: 'Volantes, resumen por departamento y lo que sube a la TSS. Todo del mismo periodo, sin exportar a Excel a mano.',
        action: { label: 'Ver reportes', path: '/payroll/reports' },
      },
    ],
  },
  {
    id: 'f7.asistencia',
    moduleId: 'attendance',
    title: 'Quien entro, a que hora y desde donde',
    summary: 'Marcaje, tardanzas y horas extra que despues paga la nomina.',
    xp: 30,
    steps: [
      {
        title: 'Define el horario de cada quien',
        body: 'Sin horario no hay tardanza que medir: el sistema no sabe si las 9:15 es tarde o temprano.',
        action: { label: 'Ir a Asistencia', path: '/asistencia' },
      },
      {
        title: 'Geocercas para quien trabaja fuera',
        body: 'Si tienes gente en ruta o en obra, marcas un area y el marcaje solo cuenta dentro de ella.',
        action: { label: 'Configurar geocercas', path: '/asistencia/geocercas' },
        tip: 'Deja la geocerca holgada. Un GPS urbano se equivoca 20 metros facil y vas a pasar el dia corrigiendo marcajes buenos.',
      },
      {
        title: 'Las horas extra se aprueban, no se acumulan solas',
        body: 'Quedarse tarde no es hora extra hasta que el supervisor la aprueba. Asi no te llega una sorpresa en la nomina.',
      },
      {
        title: 'Corregir un marcaje deja rastro',
        body: 'Se puede corregir, y queda quien lo corrigio y que decia antes. Es lo que te protege si alguien reclama.',
        action: { label: 'Ver la bitacora', path: '/auditoria' },
      },
    ],
  },
  {
    id: 'f7.vacaciones',
    moduleId: 'time-off',
    title: 'Vacaciones y permisos',
    summary: 'El saldo sale de la ley y de la fecha de entrada, no de la memoria.',
    xp: 25,
    steps: [
      {
        title: 'El saldo se calcula solo',
        body: 'Sale de la antiguedad segun el Codigo de Trabajo. No lo lleves en una libreta aparte: van a discrepar.',
        action: { label: 'Ir a Vacaciones', path: '/vacaciones' },
      },
      {
        title: 'La persona pide, el supervisor aprueba',
        body: 'La solicitud va a quien le reporta segun el organigrama. Si no hay supervisor marcado, no hay a quien mandarla.',
      },
      {
        title: 'Una solicitud resuelta ya no se toca',
        body: 'Aprobada o rechazada queda firme. Si hay que cambiarla, se crea otra: asi el saldo siempre cuadra con el historial.',
        action: { label: 'Aprobar solicitudes', path: '/vacaciones/aprobar' },
      },
      {
        title: 'Mira el calendario antes de aprobar',
        body: 'Dos de la misma area la misma semana deja un hueco. El calendario te lo ensena antes de que sea un problema.',
        tip: 'En temporada alta cierra las fechas por adelantado. Negar despues de aprobar es lo que crea resentimiento.',
      },
    ],
  },
  {
    id: 'f7.gastos',
    moduleId: 'expenses',
    title: 'Gastos que se reembolsan',
    summary: 'Del comprobante al reembolso, con quien aprueba en el medio.',
    xp: 25,
    steps: [
      {
        title: 'Con foto del comprobante',
        body: 'Sin comprobante no hay gasto deducible. La foto se adjunta desde el telefono en el momento, no el viernes de memoria.',
        action: { label: 'Ir a Gastos', path: '/gastos' },
      },
      {
        title: 'Si trae NCF, sirve para la 606',
        body: 'Un gasto con NCF de credito fiscal entra en tu declaracion. Uno sin NCF es gasto igual, pero no deduce.',
        tip: 'Enseñale a tu gente a pedir factura con RNC. Esa costumbre se paga sola.',
      },
      {
        title: 'Aprobar es de quien supervisa',
        body: 'El gasto va al supervisor. Un gasto rechazado o ya reembolsado queda inmutable.',
        action: { label: 'Aprobar gastos', path: '/gastos/aprobar' },
      },
      {
        title: 'El reembolso sale por tesoreria',
        body: 'Cuando apruebas, queda por pagar. Se paga como cualquier otra cosa y afecta tu flujo de caja.',
        action: { label: 'Ver tesoreria', path: '/tesoreria' },
      },
    ],
  },
  // -- Contabilidad y finanzas ------------------------------------------
  {
    id: 'f8.contabilidad',
    moduleId: 'accounting',
    title: 'Contabilidad que se alimenta sola',
    summary: 'El catalogo de cuentas, los asientos y por que casi nunca los escribes a mano.',
    xp: 50,
    steps: [
      {
        title: 'Empieza por el catalogo de cuentas',
        body: 'Es la columna vertebral. Si lo armas mal, los estados financieros salen mal por mucho que los asientos esten bien.',
        action: { label: 'Ver cuentas', path: '/contabilidad/cuentas' },
        tip: 'Usa el catalogo que ya usa tu contador. Inventar uno nuevo te obliga a traducir cada mes.',
      },
      {
        title: 'Casi todo se contabiliza solo',
        body: 'Vender, comprar, pagar y cobrar generan su asiento. Escribir asientos a mano se deja para ajustes y depreciaciones.',
        action: { label: 'Ir a Contabilidad', path: '/contabilidad' },
      },
      {
        title: 'Un asiento tiene que cuadrar para contabilizarse',
        body: 'Minimo dos lineas y el debito igual al credito. Mientras no cuadre se queda en borrador y no afecta nada.',
      },
      {
        title: 'Contabilizado es inmutable',
        body: 'Un asiento ya contabilizado no se edita ni se borra. Se corrige con otro asiento, y los dos quedan a la vista.',
        tip: 'Es lo mismo que el kardex y que la nomina: en este sistema lo que ya afecto un libro no se reescribe.',
      },
      {
        title: 'La balanza es tu chequeo diario',
        body: 'Si la balanza no cuadra, algo grave paso. Mirala antes de cerrar el mes, no despues.',
        action: { label: 'Ver balanza', path: '/contabilidad/balanza' },
      },
      {
        title: 'El mayor te dice de donde salio cada cifra',
        body: 'Cuando una cuenta tiene un numero raro, el mayor te lleva al movimiento exacto que lo causo.',
        action: { label: 'Ver mayor', path: '/contabilidad/mayor' },
      },
    ],
  },
  {
    id: 'f8.presupuestos',
    moduleId: 'budgets',
    title: 'Presupuesto contra lo que pasa de verdad',
    summary: 'Poner el numero es facil; lo util es la desviacion.',
    xp: 30,
    steps: [
      {
        title: 'Un presupuesto por cuenta y por periodo',
        body: 'Defines cuanto esperas gastar o vender en cada cuenta, mes a mes. Sin periodo no hay con que comparar.',
        action: { label: 'Ir a Presupuestos', path: '/presupuestos' },
      },
      {
        title: 'Lo real entra solo',
        body: 'No tienes que cargar nada: lo ejecutado sale de la contabilidad. Tu solo pones lo planeado.',
      },
      {
        title: 'La desviacion es la unica columna que importa',
        body: 'Nadie mira el presupuesto, todo el mundo mira donde se paso. Ordena por desviacion y atiende las tres primeras.',
        action: { label: 'Ver desviaciones', path: '/presupuestos' },
        tip: 'Una desviacion pequena todos los meses es peor que una grande un mes. La primera es un problema estructural.',
      },
      {
        title: 'Revisar es normal, no es fracaso',
        body: 'Si el negocio cambio, cambia el presupuesto y deja dicho por que. Un presupuesto que nadie revisa deja de usarse en marzo.',
      },
    ],
  },
  {
    id: 'f8.centros-costo',
    moduleId: 'cost-centers',
    title: 'Saber que parte del negocio gana',
    summary: 'Repartir ingresos y gastos por sucursal, linea o proyecto.',
    xp: 30,
    steps: [
      {
        title: 'Un centro de costo es una pregunta',
        body: 'Crea uno por cada cosa cuya rentabilidad quieras saber: una sucursal, una linea de producto, un cliente grande.',
        action: { label: 'Ir a Centros de costo', path: '/centros-costo' },
        tip: 'Empieza con tres o cuatro. Veinte centros de costo que nadie llena no dicen nada.',
      },
      {
        title: 'Se marca al registrar, no al final',
        body: 'Cada factura y cada gasto lleva su centro. Repartirlo despues es adivinar.',
      },
      {
        title: 'Lo que no se puede repartir, se prorratea',
        body: 'El alquiler no es de una sucursal sola. Se reparte con una regla fija y se deja escrita.',
        tip: 'La regla importa menos que mantenerla igual. Cambiarla cada mes hace incomparables los resultados.',
      },
      {
        title: 'El resultado por centro es lo que decide',
        body: 'Ahi ves cual linea sostiene a cual. Es la informacion con la que se cierra un local o se duplica otro.',
        action: { label: 'Ver reportes', path: '/reportes' },
      },
    ],
  },
  {
    id: 'f8.activos',
    moduleId: 'fixed-assets',
    title: 'Activos fijos y depreciacion',
    summary: 'Lo que compraste y vale varios anos.',
    xp: 30,
    steps: [
      {
        title: 'Que es activo y que es gasto',
        body: 'Si dura mas de un ano y vale, es activo: se deprecia. Si se consume, es gasto. Confundirlos deforma tu resultado.',
        action: { label: 'Ir a Activos fijos', path: '/activos-fijos' },
      },
      {
        title: 'La vida util decide la cuota',
        body: 'Cada categoria tiene su vida util y su metodo. De ahi sale la depreciacion mensual, calculada sola.',
        tip: 'Usa las categorias fiscales dominicanas. Inventar vidas utiles te deja con dos contabilidades.',
      },
      {
        title: 'La depreciacion es un asiento mas',
        body: 'Cada mes genera su asiento contra la cuenta correspondiente. No hay que acordarse.',
        action: { label: 'Ver contabilidad', path: '/contabilidad' },
      },
      {
        title: 'Vender o dar de baja tiene consecuencia',
        body: 'Al darlo de baja se calcula la ganancia o perdida contra el valor en libros. Ese numero va al resultado del mes.',
      },
    ],
  },
  {
    id: 'f8.monedas',
    moduleId: 'multicurrency',
    title: 'Vender y comprar en dolares',
    summary: 'Tasas, diferencias cambiarias y en que moneda queda tu libro.',
    xp: 35,
    steps: [
      {
        title: 'Tu libro es en pesos, pases lo que pases',
        body: 'Puedes facturar en dolares, pero la contabilidad y la DGII son en pesos. Todo se convierte al registrar.',
        action: { label: 'Ir a Monedas', path: '/monedas' },
      },
      {
        title: 'La tasa es la del dia de la operacion',
        body: 'No la de hoy ni la del cierre: la del dia. Cargala a diario o el historico queda inservible.',
        tip: 'Usa la tasa de tu banco, no la del Banco Central, si es a la que tu de verdad conviertes.',
      },
      {
        title: 'Si cobras despues, la diferencia es real',
        body: 'Facturaste a 58 y cobraste a 61: esa diferencia es ganancia cambiaria y va al resultado. No es un error de cuadre.',
        action: { label: 'Ver una moneda', path: '/monedas' },
      },
      {
        title: 'Revisa los saldos en moneda al cerrar',
        body: 'Las cuentas por cobrar en dolares se revaluan al cierre. Sin eso, tu balance dice un numero que ya no es.',
      },
    ],
  },
  {
    id: 'f8.listas-precio',
    moduleId: 'price-lists',
    title: 'Precios distintos para clientes distintos',
    summary: 'Mayorista, detalle y promocion, sin descuentos a ojo.',
    xp: 30,
    steps: [
      {
        title: 'Una lista por tipo de cliente',
        body: 'Mayorista, detalle, empleado. Cada cliente queda amarrado a la suya y el precio sale solo al facturar.',
        action: { label: 'Ir a Listas de precio', path: '/listas-precio' },
      },
      {
        title: 'Por monto fijo o por porcentaje sobre el costo',
        body: 'Si trabajas por margen, define el porcentaje: cuando suba el costo, el precio se mueve solo y no vendes perdiendo.',
        tip: 'El error clasico de una pyme es subir el costo y olvidar el precio. Un margen definido te cubre.',
      },
      {
        title: 'Las promociones llevan fecha',
        body: 'Una lista con vigencia se apaga sola. Nada de acordarse el lunes de quitar el precio del fin de semana.',
        action: { label: 'Ver una lista', path: '/listas-precio' },
      },
      {
        title: 'Un descuento fuera de lista se pide',
        body: 'El vendedor puede pedirlo, pero queda quien lo autorizo. Un descuento sin dueno es margen que se va sin explicacion.',
      },
    ],
  },
  // -- Almacen y compras -------------------------------------------------
  {
    id: 'f9.transferencias',
    moduleId: 'transfers',
    title: 'Mover mercancia entre almacenes',
    summary: 'Sale de uno, entra en otro, y en el medio esta en transito.',
    xp: 25,
    steps: [
      {
        title: 'Una transferencia tiene dos momentos',
        body: 'Sale hoy y llega manana. Mientras tanto la mercancia esta en transito: ni en el origen ni en el destino.',
        action: { label: 'Ir a Transferencias', path: '/transferencias' },
        tip: 'Ese estado intermedio es lo que evita que la misma caja aparezca contada dos veces.',
      },
      {
        title: 'Quien recibe confirma lo que llego',
        body: 'Si salieron 10 y llegaron 9, se confirma 9. La diferencia queda registrada y hay algo concreto que investigar.',
      },
      {
        title: 'Una diferencia repetida no es casualidad',
        body: 'La misma ruta perdiendo siempre lo mismo es un problema de proceso o de persona, no de conteo.',
        action: { label: 'Ver movimientos', path: '/inventory/movements' },
      },
      {
        title: 'El costo viaja con la mercancia',
        body: 'Transferir no cambia el costo ni genera ganancia. Si tu inventario cambia de valor al transferir, algo esta mal configurado.',
      },
    ],
  },
  {
    id: 'f9.conteos',
    moduleId: 'stock-counts',
    title: 'Contar el inventario sin parar la tienda',
    summary: 'Conteos ciclicos en vez de un inventario general al ano.',
    xp: 35,
    steps: [
      {
        title: 'Cuenta poco y seguido',
        body: 'Un inventario general cierra la tienda un dia entero y para marzo ya no vale. Conteos ciclicos cuentan una zona por semana.',
        action: { label: 'Ir a Conteos', path: '/conteos-ciclicos' },
      },
      {
        title: 'Lo caro y lo que se mueve, mas veces',
        body: 'No todo merece la misma frecuencia. Lo de alto valor y alta rotacion se cuenta mensual; el resto, dos veces al ano.',
        tip: 'Suele ser el 20% de los articulos el que causa el 80% de las diferencias. Empieza por ahi.',
      },
      {
        title: 'El que cuenta no ve el sistema',
        body: 'Si el contador ve que deberia haber 40, va a escribir 40. El conteo a ciegas es el unico que sirve.',
        action: { label: 'Abrir un conteo', path: '/conteos-ciclicos' },
      },
      {
        title: 'El ajuste es un movimiento, no un borron',
        body: 'Cuadrar el sistema con lo contado genera un movimiento de ajuste con su motivo. El kardex queda entero.',
      },
      {
        title: 'La diferencia en dinero es la que duele',
        body: 'Diez tornillos no es lo mismo que un televisor. Mira las diferencias valorizadas, no las cantidades.',
        action: { label: 'Ver inventario', path: '/inventory' },
      },
    ],
  },
  {
    id: 'f9.lotes',
    moduleId: 'lots-serials',
    title: 'Lotes, series y vencimientos',
    summary: 'Poder decir exactamente cual unidad se vendio a quien.',
    xp: 35,
    steps: [
      {
        title: 'Lote o serie, segun el producto',
        body: 'Lote es un grupo que entro junto. Serie es una unidad concreta. Un electrodomestico lleva serie; un cable, lote.',
        action: { label: 'Ir a Lotes', path: '/lotes' },
      },
      {
        title: 'Se captura al recibir, no al vender',
        body: 'Si no lo capturas al entrar, despues no hay de donde sacarlo. Es el paso que la gente se salta cuando tiene prisa.',
        tip: 'La serie que importa es la del fabricante, no un numero que te inventes: es la que va a traer el cliente en la garantia.',
      },
      {
        title: 'Lo que vence primero, sale primero',
        body: 'El sistema te propone el lote mas viejo. Saltartelo es como se acumula mercancia vencida en el fondo del almacen.',
      },
      {
        title: 'Para eso sirve de verdad: un retiro',
        body: 'Si el fabricante retira un lote, en un minuto sabes a que clientes les vendiste de ese lote. Sin esto, llamas a todos.',
        action: { label: 'Ver movimientos', path: '/inventory/movements' },
      },
      {
        title: 'Y para la garantia',
        body: 'El cliente llega con la serie: sabes cuando la vendiste, con que factura y si esta en garantia. Sin discutir.',
      },
    ],
  },
  {
    id: 'f9.barras',
    moduleId: 'barcode',
    title: 'Codigos de barra y etiquetas',
    summary: 'Escanear en vez de teclear, que es donde se cuelan los errores.',
    xp: 25,
    steps: [
      {
        title: 'Un codigo por producto, y que sea el del fabricante',
        body: 'Si el producto ya trae codigo, usa ese. Inventar el tuyo te obliga a re-etiquetar todo lo que entra.',
        action: { label: 'Ir a Codigos de barra', path: '/codigos-barra' },
      },
      {
        title: 'Imprime etiquetas para lo que no trae',
        body: 'Lo que llega sin codigo -a granel, importado, fraccionado- se etiqueta al recibir.',
        action: { label: 'Imprimir etiquetas', path: '/codigos-barra/etiquetas' },
        tip: 'Etiqueta en el almacen, no en la caja. Un producto sin codigo en la caja es una fila parada.',
      },
      {
        title: 'Escanear sirve en toda la cadena',
        body: 'Al recibir, al contar, al transferir y al vender. El escaner no se equivoca de digito; los dedos si.',
        action: { label: 'Probar escaneo', path: '/codigos-barra/escaneo' },
      },
      {
        title: 'Dos productos con el mismo codigo es un lio',
        body: 'El sistema no te deja repetir codigo. Si te pasa al importar, te lo dice antes de cargar.',
      },
    ],
  },
  {
    id: 'f9.proveedores',
    moduleId: 'suppliers',
    title: 'Tus proveedores',
    summary: 'RNC, condiciones de pago y con cual conviene quedarse.',
    xp: 25,
    steps: [
      {
        title: 'El RNC no es opcional',
        body: 'De el sale tu 606. Un proveedor sin RNC te deja un hueco en la declaracion que despues hay que perseguir.',
        action: { label: 'Ir a Proveedores', path: '/compras/proveedores' },
      },
      {
        title: 'Las condiciones deciden tu flujo',
        body: 'Contado, 15 o 30 dias. Guardalas aqui y la factura calcula su vencimiento sola.',
        tip: 'Negociar 15 dias mas con tu proveedor grande es mas facil que conseguir un prestamo por lo mismo.',
      },
      {
        title: 'El historial es tu argumento',
        body: 'Cuanto le compraste el ano pasado es con lo que pides mejor precio. Lo tienes aqui, no en la memoria.',
        action: { label: 'Ver un proveedor', path: '/compras/proveedores' },
      },
      {
        title: 'Un proveedor que no cumple, cuesta',
        body: 'Entregas tarde o incompletas te dejan sin vender. Anotalo: cuando llegue la renegociacion vas con datos.',
      },
    ],
  },
  {
    id: 'f9.requisiciones',
    moduleId: 'requisitions',
    title: 'Pedir antes de comprar',
    summary: 'Quien pide, quien aprueba y de ahi sale la orden.',
    xp: 25,
    steps: [
      {
        title: 'Una requisicion es una peticion interna',
        body: 'Alguien necesita algo y lo pide. Todavia no es una compra ni compromete plata.',
        action: { label: 'Ir a Requisiciones', path: '/requisiciones' },
      },
      {
        title: 'Se aprueba antes de cotizar',
        body: 'Asi nadie pierde el tiempo cotizando algo que no se va a comprar, y nadie compra por su cuenta.',
        tip: 'Pon un monto a partir del cual se exige aprobacion. Pedir permiso para una caja de lapices desgasta el proceso.',
      },
      {
        title: 'Aprobada, se convierte en orden',
        body: 'De la requisicion sale la orden de compra sin volver a teclear nada.',
        action: { label: 'Ir a Compras', path: '/compras' },
      },
      {
        title: 'Lo que se pide mucho, se compra mejor',
        body: 'Si el mismo articulo se pide cada semana, conviene un acuerdo con el proveedor en vez de diez ordenes sueltas.',
      },
    ],
  },
  {
    id: 'f9.rfq',
    moduleId: 'rfq',
    title: 'Pedir cotizaciones y comparar',
    summary: 'Tres proveedores, una tabla, una decision defendible.',
    xp: 25,
    steps: [
      {
        title: 'Un pedido de cotizacion a varios a la vez',
        body: 'Mandas la misma lista a tres proveedores. Comparar peras con peras empieza por pedir lo mismo.',
        action: { label: 'Ir a Cotizaciones de compra', path: '/cotizaciones' },
      },
      {
        title: 'Las respuestas entran y se comparan',
        body: 'Precio, plazo y condiciones lado a lado. El mas barato con 30 dias de entrega puede ser el mas caro.',
        action: { label: 'Comparar', path: '/cotizaciones' },
      },
      {
        title: 'Deja escrito por que elegiste',
        body: 'Si no fue el mas barato, di por que. Es lo que te cubre cuando alguien revise la compra dentro de un ano.',
        tip: 'Esa nota vale mas que el ahorro. Una compra sin justificar es lo primero que salta en una auditoria.',
      },
      {
        title: 'De la ganadora sale la orden',
        body: 'Eliges y se genera la orden de compra con los precios de esa cotizacion.',
        action: { label: 'Ir a Compras', path: '/compras' },
      },
    ],
  },
  {
    id: 'f9.recepciones',
    moduleId: 'receipts',
    title: 'Recibir lo que llega',
    summary: 'El momento en que la mercancia se vuelve tuya y entra al costo.',
    xp: 30,
    steps: [
      {
        title: 'Recibir es lo que mueve el inventario',
        body: 'La orden de compra no suma stock. Lo que suma es la recepcion, cuando la mercancia esta fisicamente en el almacen.',
        action: { label: 'Ir a Recepciones', path: '/recepciones' },
      },
      {
        title: 'Cuenta antes de firmar',
        body: 'Recibes lo que llego, no lo que dice el conduce. Si faltan tres, recibes lo que hay y queda la diferencia.',
        tip: 'Firmar el conduce sin contar es regalarle el problema al que descubra el faltante dentro de dos semanas.',
      },
      {
        title: 'El costo real se declara aqui',
        body: 'Si el proveedor cobro distinto a lo cotizado, se pone el costo real. Ese es el que entra al promedio del inventario.',
      },
      {
        title: 'Lo que llega mal, se devuelve con papel',
        body: 'Mercancia danada o equivocada se registra como devolucion. Asi el proveedor tiene que reconocerla y tu inventario no la carga.',
        action: { label: 'Ver inventario', path: '/inventory' },
      },
    ],
  },
  // -- Comercial y clientes ----------------------------------------------
  {
    id: 'f10.crm',
    moduleId: 'crm',
    title: 'Tus clientes y todo lo hablado con ellos',
    summary: 'Para que la relacion no viva en el telefono de un vendedor.',
    xp: 30,
    steps: [
      {
        title: 'Una ficha por cliente, no por venta',
        body: 'Contactos, RNC, condiciones y todo lo conversado. Cuando el vendedor se va, el cliente se queda.',
        action: { label: 'Ir a Clientes', path: '/crm' },
      },
      {
        title: 'Anota lo hablado el mismo dia',
        body: 'Una llamada sin anotar es una llamada que no existio. El proximo que atienda a ese cliente va a ciegas.',
        tip: 'Dos lineas bastan: que pidio y que le prometiste. Lo prometido sin anotar es como se pierde un cliente.',
      },
      {
        title: 'El historial de compra es el argumento',
        body: 'Que compro, cuando y cuanto. Con eso vendes mas, no con insistir.',
        action: { label: 'Ver un cliente', path: '/crm' },
      },
      {
        title: 'Un cliente que dejo de comprar te avisa solo',
        body: 'Si compraba cada mes y lleva tres sin aparecer, algo paso. Enterarte en enero no sirve de nada.',
      },
    ],
  },
  {
    id: 'f10.pipeline',
    moduleId: 'pipeline',
    title: 'Oportunidades y cierre',
    summary: 'Saber que va a entrar el mes que viene, no adivinarlo.',
    xp: 30,
    steps: [
      {
        title: 'Una oportunidad es una venta que todavia no es',
        body: 'Con monto, fecha probable y en que etapa va. Sin esas tres cosas no se puede proyectar nada.',
        action: { label: 'Ir a Pipeline', path: '/pipeline' },
      },
      {
        title: 'Las etapas son del mundo real',
        body: 'Contactado, cotizado, negociando, cerrado. Si tu proceso tiene otra etapa, ponla; si tiene una que nadie usa, quitala.',
      },
      {
        title: 'Mover la fecha no es avanzar',
        body: 'Una oportunidad que lleva cuatro meses moviendose de fecha esta muerta. Cerrala como perdida y libera el tiempo.',
        action: { label: 'Ver oportunidades', path: '/pipeline' },
        tip: 'Un pipeline lleno de zombis miente mas que uno vacio: te hace creer que viene plata que no viene.',
      },
      {
        title: 'Lo perdido ensena mas que lo ganado',
        body: 'Marca por que se perdio. Si el motivo repetido es el precio, tienes un problema de precio, no de vendedores.',
      },
    ],
  },
  {
    id: 'f10.cotizaciones',
    moduleId: 'quotes',
    title: 'Cotizar y convertir en venta',
    summary: 'Del presupuesto al pedido sin volver a teclear.',
    xp: 25,
    steps: [
      {
        title: 'Una cotizacion no compromete inventario',
        body: 'Puedes cotizar lo que no tienes. Reservar stock por una cotizacion es como te quedas sin vender lo que si estaba pagado.',
        action: { label: 'Ir a Cotizaciones', path: '/cotizaciones-venta' },
      },
      {
        title: 'Ponle fecha de vencimiento',
        body: 'Un precio no puede durar para siempre, menos con costos que suben. Vencida, se re-cotiza.',
        tip: 'Quince dias es lo normal. Si tu proveedor te cambia precio cada semana, pon una semana.',
      },
      {
        title: 'Aprobada, se vuelve pedido de un clic',
        body: 'No se copia a mano: se convierte. Retecleary es donde se cuelan los precios que no eran.',
        action: { label: 'Ver cotizaciones', path: '/cotizaciones-venta' },
      },
      {
        title: 'Las que no cierran tambien informan',
        body: 'Si cotizas mucho y cierras poco, el problema esta en el precio o en a quien le cotizas.',
      },
    ],
  },
  {
    id: 'f10.fidelizacion',
    moduleId: 'loyalty',
    title: 'Puntos y cupones',
    summary: 'Que el cliente vuelva, que es mas barato que conseguir uno nuevo.',
    xp: 25,
    steps: [
      {
        title: 'Define cuanto vale un punto ANTES de darlos',
        body: 'Los puntos son una deuda tuya. Si no sabes cuanto te cuesta cada uno, no sabes cuanto estas regalando.',
        action: { label: 'Ir a Fidelizacion', path: '/fidelizacion' },
        tip: 'Entre 1% y 3% del ticket es lo normal. Mas que eso se come el margen de una tienda de electronicos.',
      },
      {
        title: 'Se acumulan en la caja, sin papeles',
        body: 'El cliente da su cedula o su telefono y los puntos entran solos. Una tarjeta de carton se pierde.',
      },
      {
        title: 'Los cupones llevan reglas y fecha',
        body: 'Monto minimo, productos que aplican y vencimiento. Un cupon sin reglas se usa donde menos te conviene.',
        action: { label: 'Ver cupones', path: '/fidelizacion/cupones' },
      },
      {
        title: 'Mira si de verdad vuelven',
        body: 'El programa sirve si los clientes con puntos compran mas seguido que los demas. Si no, es un descuento disfrazado.',
      },
    ],
  },
  {
    id: 'f10.comisiones',
    moduleId: 'commissions',
    title: 'Comisiones que nadie discute',
    summary: 'La regla clara, el calculo automatico y el pago por nomina.',
    xp: 30,
    steps: [
      {
        title: 'El plan se define antes del mes',
        body: 'Porcentaje, meta y sobre que se calcula. Cambiar la regla a mitad de mes es la forma mas rapida de perder un vendedor bueno.',
        action: { label: 'Ir a Planes de comision', path: '/comisiones/planes' },
      },
      {
        title: 'Sobre el margen, no sobre la venta',
        body: 'Si comisionas sobre la venta, el vendedor regala descuentos. Sobre el margen, defiende el precio contigo.',
        tip: 'Es el cambio que mas margen recupera en una pyme, y no cuesta nada mas que decirlo.',
      },
      {
        title: 'Se calcula solo sobre lo facturado',
        body: 'Cada factura suma a quien la vendio. Sin planillas paralelas que nunca cuadran.',
        action: { label: 'Ver comisiones', path: '/comisiones' },
      },
      {
        title: 'Comision de lo que no se cobro, no',
        body: 'Si la factura no se cobro, la comision espera. Si no, pagas por ventas que terminan siendo incobrables.',
        tip: 'Dilo por escrito al empezar. Descubrirlo el dia del pago es una pelea segura.',
      },
    ],
  },
  {
    id: 'f10.portal',
    moduleId: 'customer-portal',
    title: 'Que el cliente se atienda solo',
    summary: 'Sus facturas y su estado de cuenta, sin llamarte.',
    xp: 25,
    steps: [
      {
        title: 'Cada cliente tiene su enlace propio',
        body: 'Entra con un enlace unico y ve solo lo suyo: sus facturas, lo que debe y lo que pago.',
        action: { label: 'Ir a Portal de clientes', path: '/portal-clientes' },
      },
      {
        title: 'Ese enlace es una llave',
        body: 'Quien lo tenga ve esa cuenta. Mandalo al correo del cliente, no a un grupo.',
        tip: 'Si un cliente lo comparte de mas, genera otro. El viejo deja de servir en el acto.',
      },
      {
        title: 'La mitad de las llamadas es preguntar el saldo',
        body: 'Con el portal esa llamada no ocurre. Es tiempo que le devuelves a quien atiende el telefono.',
      },
      {
        title: 'Lo que ve es lo que hay, al momento',
        body: 'No es un PDF de la semana pasada. Si le aplicaste un pago hace cinco minutos, ya lo ve.',
        action: { label: 'Ver cartera', path: '/cobrar/cartera' },
      },
    ],
  },
  {
    id: 'f10.mesa-ayuda',
    moduleId: 'helpdesk',
    title: 'Soporte con tickets',
    summary: 'Para que un reclamo no se quede en un WhatsApp sin leer.',
    xp: 25,
    steps: [
      {
        title: 'Todo reclamo es un ticket',
        body: 'Con dueno, prioridad y estado. Lo que entra por el telefono y no se registra, no existe y se olvida.',
        action: { label: 'Ir a Mesa de ayuda', path: '/mesa-de-ayuda' },
      },
      {
        title: 'Prioridad la pone el impacto, no quien grita',
        body: 'Un cliente sin poder operar va primero que una molestia de un cliente ruidoso.',
      },
      {
        title: 'Sin dueno no se resuelve',
        body: 'Un ticket de todos es un ticket de nadie. Asigna aunque sea provisional.',
        action: { label: 'Ver tickets', path: '/mesa-de-ayuda' },
        tip: 'Responder "lo estamos viendo" cuenta. El silencio es lo que convierte un reclamo en una resena mala.',
      },
      {
        title: 'Lo que se repite se arregla de raiz',
        body: 'Cinco tickets del mismo producto no son cinco problemas: son uno. Miralo por producto, no por ticket.',
      },
    ],
  },
  {
    id: 'f10.contratos',
    moduleId: 'contracts',
    title: 'Contratos y renovaciones',
    summary: 'Que ninguno se venza sin que te enteres.',
    xp: 25,
    steps: [
      {
        title: 'Carga el contrato con sus fechas',
        body: 'Inicio, fin y aviso previo. La fecha que importa no es la de vencimiento: es la de avisar.',
        action: { label: 'Ir a Contratos', path: '/contratos' },
      },
      {
        title: 'La renovacion se avisa con tiempo',
        body: 'Si el contrato pide avisar 60 dias antes, el sistema te avisa a los 60. Enterarte el dia del vencimiento es renovarlo sin querer.',
        tip: 'Es el error mas caro de esta lista: un contrato que se renueva solo por un ano porque nadie miro el calendario.',
      },
      {
        title: 'Guarda el documento firmado',
        body: 'El PDF firmado va con el registro. El dia que haya discusion, lo quieres en un clic.',
        action: { label: 'Ver un contrato', path: '/contratos' },
      },
      {
        title: 'Lo que factura el contrato, que lo facture solo',
        body: 'Si es un monto fijo mensual, que se genere solo. Facturar a mano lo recurrente es donde se olvidan meses.',
      },
    ],
  },
  // -- Produccion y proyectos --------------------------------------------
  {
    id: 'f11.manufactura',
    moduleId: 'manufacturing',
    title: 'Producir y saber cuanto te costo',
    summary: 'Ordenes de produccion que consumen materia prima y entregan producto.',
    xp: 40,
    steps: [
      {
        title: 'Una orden de produccion transforma inventario',
        body: 'Consume materia prima y entrega producto terminado. Las dos puntas mueven el kardex.',
        action: { label: 'Ir a Produccion', path: '/produccion' },
      },
      {
        title: 'El costo del producto sale de lo que consumio',
        body: 'Materiales mas mano de obra mas gastos indirectos. Si no cargas los tres, tu producto parece mas barato de lo que es.',
        tip: 'El que se olvida siempre es el indirecto. Es el que se come el margen sin que nadie lo vea.',
      },
      {
        title: 'La merma se registra, no se disimula',
        body: 'Lo que se dana o se pierde en el proceso tiene su movimiento. Sin eso, el inventario cuadra en papel y no en el piso.',
        action: { label: 'Ver una orden', path: '/produccion' },
      },
      {
        title: 'Producir sin material no arranca',
        body: 'Si falta materia prima, la orden te lo dice antes. Enterarte a media produccion es parar la linea.',
      },
      {
        title: 'Compara lo planeado con lo que gastaste',
        body: 'Si siempre consumes mas de lo que dice la formula, la formula esta mal o hay merma que nadie mide.',
      },
    ],
  },
  {
    id: 'f11.bom',
    moduleId: 'bom',
    title: 'La formula de cada producto',
    summary: 'Que lleva y cuanto, que es de donde sale el costo.',
    xp: 30,
    steps: [
      {
        title: 'Una lista de materiales es una receta',
        body: 'Que componentes lleva una unidad y en que cantidad. De aqui salen el costo y lo que hay que comprar.',
        action: { label: 'Ir a Listas de materiales', path: '/bom' },
      },
      {
        title: 'Incluye la merma esperada',
        body: 'Si al cortar se pierde un 5%, ponlo en la formula. Si no, cada orden va a quedar corta de material.',
        tip: 'Saca el porcentaje de tus ordenes reales, no de lo que deberia ser.',
      },
      {
        title: 'Una formula puede llevar otra dentro',
        body: 'Un subensamble es un producto que a su vez tiene formula. El costo se acumula hacia arriba solo.',
        action: { label: 'Ver una formula', path: '/bom' },
      },
      {
        title: 'Cambiar la formula no cambia lo ya producido',
        body: 'Lo fabricado guarda el costo del dia que se fabrico. Si no, el historico cambiaria cada vez que sube un componente.',
      },
    ],
  },
  {
    id: 'f11.mrp',
    moduleId: 'mrp',
    title: 'Que comprar y cuando',
    summary: 'Cruza lo que vas a producir con lo que tienes.',
    xp: 35,
    steps: [
      {
        title: 'El MRP resta, nada mas',
        body: 'Lo que necesitas menos lo que tienes menos lo que ya viene en camino. Lo que falta es lo que hay que comprar.',
        action: { label: 'Ir a MRP', path: '/mrp' },
      },
      {
        title: 'El tiempo de entrega manda',
        body: 'Un componente que tarda 45 dias hay que pedirlo 45 dias antes. Sin ese dato el calculo te dice que compres tarde.',
        tip: 'Pon el plazo real de tu proveedor, no el que te prometio. Suele haber dos semanas de diferencia.',
      },
      {
        title: 'Las sugerencias no compran solas',
        body: 'El sistema propone; tu apruebas. Una compra automatica sin ojos encima es como se acumula lo que no se vende.',
        action: { label: 'Ver sugerencias', path: '/mrp' },
      },
      {
        title: 'Si el plan cambia, corre otra vez',
        body: 'Un pedido grande que entra cambia todo lo que hay que comprar. El calculo es de hoy, no del lunes.',
      },
    ],
  },
  {
    id: 'f11.piso',
    moduleId: 'shopfloor',
    title: 'Que esta pasando en la planta ahora',
    summary: 'Estaciones, avance y donde se traba la produccion.',
    xp: 30,
    steps: [
      {
        title: 'Cada orden pasa por estaciones',
        body: 'Corte, ensamble, empaque. Saber en cual esta cada orden es saber para cuando la tienes.',
        action: { label: 'Ir a Piso de planta', path: '/piso-de-planta' },
      },
      {
        title: 'El operario reporta desde su puesto',
        body: 'Marca lo que empieza y lo que termina. Sin eso, el avance es lo que alguien cree.',
      },
      {
        title: 'La estacion con cola es tu cuello de botella',
        body: 'Donde se acumula trabajo es lo unico que limita tu produccion. Mejorar cualquier otra estacion no cambia nada.',
        action: { label: 'Ver una orden', path: '/piso-de-planta' },
        tip: 'Es contraintuitivo: acelerar una estacion que no es el cuello solo hace la cola mas larga.',
      },
      {
        title: 'Las paradas se anotan con su motivo',
        body: 'Falta de material, averia, falta de gente. Sin motivo no hay nada que arreglar.',
      },
    ],
  },
  {
    id: 'f11.proyectos',
    moduleId: 'projects',
    title: 'Proyectos con tareas y fechas',
    summary: 'Quien hace que y para cuando.',
    xp: 30,
    steps: [
      {
        title: 'Un proyecto es un conjunto de tareas con fin',
        body: 'Con fecha de entrega y responsable. Si no tiene fin, es una operacion, no un proyecto.',
        action: { label: 'Ir a Proyectos', path: '/proyectos' },
      },
      {
        title: 'Cada tarea con dueno y fecha',
        body: 'Una tarea sin responsable no la hace nadie; una sin fecha se hace ultima. Siempre las dos cosas.',
      },
      {
        title: 'Lo que depende de algo, marcalo',
        body: 'Si no puedes pintar hasta que sequen, esa dependencia tiene que estar. Asi un retraso mueve lo que tiene que mover.',
        action: { label: 'Ver un proyecto', path: '/proyectos' },
        tip: 'El retraso no duele por la tarea que se atrasa, sino por las cinco que la esperaban.',
      },
      {
        title: 'El avance se reporta, no se supone',
        body: 'Un proyecto que "va bien" hasta la semana antes de entregar es un proyecto que nadie midio.',
      },
    ],
  },
  {
    id: 'f11.costeo',
    moduleId: 'project-costing',
    title: 'Cuanto te esta costando ese proyecto',
    summary: 'Horas, materiales y gastos contra lo que cobraste.',
    xp: 35,
    steps: [
      {
        title: 'Todo lo que se gasta lleva el proyecto',
        body: 'Horas, materiales, compras y gastos. Lo que no se carga al proyecto lo termina pagando otro.',
        action: { label: 'Ir a Costeo de proyectos', path: '/costeo-proyectos' },
      },
      {
        title: 'Las horas son el costo que mas se olvida',
        body: 'La gente cuesta aunque ya este en nomina. Un proyecto que no carga horas siempre parece rentable.',
        action: { label: 'Ir a Hojas de tiempo', path: '/hojas-de-tiempo' },
        tip: 'Ponle a cada quien un costo por hora que incluya prestaciones. El salario solo se queda corto un 30%.',
      },
      {
        title: 'Compara contra lo presupuestado, no al final',
        body: 'Enterarte al cerrar de que perdiste no sirve. Miralo cada semana, cuando todavia puedes cambiar algo.',
        action: { label: 'Ver un proyecto', path: '/costeo-proyectos' },
      },
      {
        title: 'Lo que el cliente pidio de mas, se cobra',
        body: 'Los cambios fuera de alcance se registran y se cotizan. Regalarlos es de donde sale la perdida de casi todo proyecto.',
      },
    ],
  },
  {
    id: 'f11.hojas-tiempo',
    moduleId: 'timesheets',
    title: 'Hojas de tiempo',
    summary: 'En que se va el dia de tu gente.',
    xp: 25,
    steps: [
      {
        title: 'Se llena el mismo dia',
        body: 'Reconstruir la semana el viernes es inventar. Y esos numeros inventados son los que luego costean el proyecto.',
        action: { label: 'Ir a Hojas de tiempo', path: '/hojas-de-tiempo' },
      },
      {
        title: 'Cada hora va a un proyecto o a interno',
        body: 'Que exista la opcion de interno es importante: obligar a cargar todo a un cliente deforma el costeo de ese cliente.',
      },
      {
        title: 'El supervisor aprueba',
        body: 'Aprobadas, las horas entran al costo del proyecto y a la nomina si son extra.',
        action: { label: 'Ver horas', path: '/hojas-de-tiempo' },
        tip: 'Si un proyecto lleva el triple de horas de lo estimado, el problema esta en el estimado. Ajustalo para el proximo.',
      },
      {
        title: 'Sirve para cotizar mejor',
        body: 'Lo que de verdad tarda un trabajo sale de aqui. Cotizar de memoria es como se pierde plata tres veces con el mismo cliente.',
      },
    ],
  },
  {
    id: 'f11.calidad',
    moduleId: 'quality',
    title: 'Control de calidad',
    summary: 'Inspecciones, no conformidades y que no se repita.',
    xp: 30,
    steps: [
      {
        title: 'Define que se inspecciona y como',
        body: 'Un plan dice que se mide, con que criterio y cada cuanto. Sin plan, la inspeccion es una opinion.',
        action: { label: 'Ir a Planes de calidad', path: '/calidad/planes' },
      },
      {
        title: 'Inspecciona al recibir y al producir',
        body: 'Detectar un defecto al recibir cuesta una devolucion. Detectarlo en casa del cliente cuesta el cliente.',
        action: { label: 'Nueva inspeccion', path: '/calidad/inspecciones/nueva' },
      },
      {
        title: 'Lo que falla se registra como no conformidad',
        body: 'Con su causa y su accion correctiva. Un defecto arreglado sin registrar se repite el mes que viene.',
        action: { label: 'Ver no conformidades', path: '/calidad/no-conformidades' },
        tip: 'La causa casi nunca es "descuido". Si esa es tu respuesta, no llegaste a la causa.',
      },
      {
        title: 'Mide si de verdad bajaron',
        body: 'Las mismas no conformidades tres meses seguidos significan que la accion correctiva no corrigio nada.',
      },
    ],
  },
  // -- Campo, flota y mantenimiento --------------------------------------
  {
    id: 'f12.servicio-campo',
    moduleId: 'field-service',
    title: 'Tecnicos en la calle',
    summary: 'Ordenes de servicio, ruta del dia y firma del cliente.',
    xp: 35,
    steps: [
      {
        title: 'Una orden de servicio por visita',
        body: 'Cliente, que hay que hacer y cuando. El tecnico la ve en su telefono sin que nadie lo llame.',
        action: { label: 'Ir a Servicio en campo', path: '/servicio-en-campo' },
      },
      {
        title: 'Agrupa por zona, no por orden de llegada',
        body: 'Cinco visitas en la misma zona rinden mas que cinco cruzando la ciudad. La gasolina y las horas son tu costo real.',
        tip: 'Deja siempre un hueco para la urgencia del dia. Una agenda llena al 100% se cae con la primera emergencia.',
      },
      {
        title: 'El tecnico reporta desde ahi',
        body: 'Que hizo, que repuestos uso y cuanto tardo. Los repuestos salen del inventario en ese momento.',
        action: { label: 'Ver una orden', path: '/servicio-en-campo' },
      },
      {
        title: 'La firma del cliente cierra la visita',
        body: 'Firma en el telefono y queda la constancia. Es lo que evita el "nunca vinieron" tres semanas despues.',
      },
      {
        title: 'De ahi sale la factura',
        body: 'Mano de obra y repuestos ya estan. Facturar no es volver a teclear, es confirmar.',
        action: { label: 'Ir a Cuentas por cobrar', path: '/cobrar' },
      },
    ],
  },
  {
    id: 'f12.flota',
    moduleId: 'fleet',
    title: 'Vehiculos y lo que cuestan',
    summary: 'Combustible, mantenimiento y documentos al dia.',
    xp: 25,
    steps: [
      {
        title: 'Una ficha por vehiculo',
        body: 'Placa, marca, ano y a quien esta asignado. Tambien los documentos: seguro, marbete, revision.',
        action: { label: 'Ir a Flota', path: '/flota' },
      },
      {
        title: 'Los vencimientos avisan solos',
        body: 'Seguro y marbete tienen fecha. Que te pare la AMET por un marbete vencido cuesta mas que el marbete.',
        tip: 'Renueva con dos semanas de margen. Dejarlo para el ultimo dia es como se vencen.',
      },
      {
        title: 'El combustible por vehiculo, no en bulto',
        body: 'Si todo el gasto va a una cuenta, no sabes cual camion se come la plata. Cargalo a cada uno.',
        action: { label: 'Ver un vehiculo', path: '/flota' },
      },
      {
        title: 'Un vehiculo viejo tiene un punto de venta',
        body: 'Cuando el mantenimiento del ano se acerca a lo que vale, toca cambiarlo. El dato lo tienes aqui.',
      },
    ],
  },
  {
    id: 'f12.mantenimiento',
    moduleId: 'maintenance',
    title: 'Mantener los equipos antes de que paren',
    summary: 'Preventivo programado en vez de correctivo a las tres de la manana.',
    xp: 30,
    steps: [
      {
        title: 'Registra los equipos que importan',
        body: 'Los que si paran, te paran. Una nevera de exhibicion o un compresor entran; una silla, no.',
        action: { label: 'Ir a Equipos', path: '/mantenimiento/equipos' },
      },
      {
        title: 'Programa el preventivo por uso o por tiempo',
        body: 'Cada 500 horas o cada 3 meses, lo que llegue primero. El sistema genera la orden sola.',
        tip: 'El preventivo siempre parece caro hasta la primera parada en plena temporada.',
      },
      {
        title: 'Lo correctivo tambien se registra',
        body: 'Que se dano, que se cambio y cuanto costo. Es el historial que te dice cuando el equipo ya no vale la pena.',
        action: { label: 'Ver un equipo', path: '/mantenimiento/equipos' },
      },
      {
        title: 'Mide cuanto para cada equipo',
        body: 'Horas fuera de servicio al mes. El que mas para es el que hay que atender o sustituir, no el que mas se queja.',
      },
    ],
  },
  {
    id: 'f12.rutas',
    moduleId: 'logistics',
    title: 'Rutas de entrega',
    summary: 'Que sale hoy, con quien y en que orden.',
    xp: 30,
    steps: [
      {
        title: 'Una ruta agrupa entregas de un dia',
        body: 'Con su vehiculo y su chofer. Lo que no entra hoy pasa a manana, pero se sabe.',
        action: { label: 'Ir a Rutas', path: '/rutas' },
      },
      {
        title: 'El orden de las paradas es plata',
        body: 'Ordenar por zona en vez de por cliente ahorra horas y combustible todos los dias.',
        tip: 'Deja las entregas dificiles temprano. A las cuatro de la tarde nadie quiere pelear con un parqueo.',
      },
      {
        title: 'La entrega se confirma en la puerta',
        body: 'Quien recibio y a que hora. Sin eso, un reclamo de "no llego" no tiene como resolverse.',
        action: { label: 'Ver una ruta', path: '/rutas' },
      },
      {
        title: 'Lo que no se pudo entregar tiene motivo',
        body: 'Cerrado, direccion mala, cliente sin plata. El motivo repetido es lo que hay que arreglar.',
      },
    ],
  },
  // -- Sistema, datos y automatizacion -----------------------------------
  {
    id: 'f13.importar',
    moduleId: 'imports',
    title: 'Traer tus datos de donde los tengas',
    summary: 'Del Excel de siempre al sistema, sin perder nada.',
    xp: 35,
    steps: [
      {
        title: 'Empieza por el catalogo',
        body: 'Productos primero, despues clientes, despues saldos. En ese orden, porque cada uno necesita el anterior.',
        action: { label: 'Ir a Importar', path: '/importar' },
      },
      {
        title: 'Baja la plantilla y llenala',
        body: 'Cada importacion tiene su plantilla con las columnas exactas. Inventarse columnas es la causa numero uno de que falle.',
      },
      {
        title: 'Te avisa ANTES de cargar',
        body: 'Revisa el archivo y te ensena los errores fila por fila. Corriges el Excel y vuelves a subir.',
        action: { label: 'Subir archivo', path: '/importar' },
        tip: 'Prueba primero con 20 filas. Si esas entran bien, sube las 3,000.',
      },
      {
        title: 'Una importacion se deshace completa',
        body: 'Si te equivocaste, se revierte entera. No hay que borrar 3,000 productos a mano.',
      },
      {
        title: 'Los saldos iniciales se cargan una vez',
        body: 'Inventario, cuentas por cobrar y por pagar del dia que arrancas. Esa es tu foto de partida.',
        tip: 'Escoge un corte limpio: fin de mes. Arrancar a mitad de mes obliga a cuadrar dos sistemas a la vez.',
      },
    ],
  },
  {
    id: 'f13.respaldos',
    moduleId: 'backup',
    title: 'Respaldos que de verdad sirven',
    summary: 'Un respaldo que nunca se restauro no es un respaldo.',
    xp: 30,
    steps: [
      {
        title: 'Mira cuando fue el ultimo',
        body: 'Aqui ves la fecha y el tamano. Un respaldo de hace tres semanas es casi lo mismo que ninguno.',
        action: { label: 'Ir a Respaldos', path: '/respaldos' },
      },
      {
        title: 'Guardalo fuera de aqui',
        body: 'Un respaldo en el mismo sitio que los datos no protege del incendio ni del ransomware. Bajalo y guardalo aparte.',
        tip: 'Tres copias, dos medios, una fuera del local. Es la regla de siempre y sigue siendo la buena.',
      },
      {
        title: 'Pruebalo restaurando',
        body: 'Un archivo que nadie abrio puede estar corrupto y no lo sabes hasta el dia que lo necesitas.',
        action: { label: 'Ver respaldos', path: '/respaldos' },
      },
      {
        title: 'Antes de cualquier cosa grande, uno a mano',
        body: 'Antes de una importacion masiva o un cambio de precios general, respalda. Cuesta un minuto.',
      },
    ],
  },
  {
    id: 'f13.auditoria',
    moduleId: 'audit',
    title: 'Quien hizo que, y cuando',
    summary: 'La bitacora que te salva la discusion.',
    xp: 25,
    steps: [
      {
        title: 'Todo queda registrado',
        body: 'Crear, cambiar y borrar dejan rastro con usuario, hora y el valor de antes.',
        action: { label: 'Ir a Auditoria', path: '/auditoria' },
      },
      {
        title: 'La bitacora no se edita ni se borra',
        body: 'Ni tu puedes. Una bitacora que alguien puede retocar no sirve de prueba de nada.',
      },
      {
        title: 'Se busca por persona, por fecha o por documento',
        body: 'Cuando aparece un precio raro, vas directo a quien lo toco y que decia antes.',
        action: { label: 'Buscar en la bitacora', path: '/auditoria' },
        tip: 'Por eso cada quien necesita su propio usuario. Si tres personas comparten una clave, la bitacora no dice nada.',
      },
      {
        title: 'Lo delicado se guarda tapado',
        body: 'Claves y llaves de acceso no quedan en claro en la bitacora, solo una huella de que cambiaron.',
      },
    ],
  },
  {
    id: 'f13.automatizaciones',
    moduleId: 'automations',
    title: 'Que el sistema haga lo repetitivo',
    summary: 'Cuando pase esto, haz aquello.',
    xp: 30,
    steps: [
      {
        title: 'Una automatizacion es disparador mas accion',
        body: 'Cuando el stock baje de X, avisa. Cuando una factura venza, manda recordatorio.',
        action: { label: 'Ir a Automatizaciones', path: '/automatizaciones' },
      },
      {
        title: 'Empieza por lo que ya haces a mano',
        body: 'Lo que haces cada lunes sin falta es lo primero que conviene automatizar. No inventes procesos nuevos.',
        tip: 'Automatizar un proceso malo lo hace malo mas rapido. Arreglalo primero.',
      },
      {
        title: 'Pruebala antes de soltarla',
        body: 'Una regla mal puesta manda cien correos a tus clientes. Correla primero en modo prueba.',
        action: { label: 'Ver reglas', path: '/automatizaciones' },
      },
      {
        title: 'Revisa las que ya nadie mira',
        body: 'Una alerta que salta todos los dias deja de leerse. Si pasa eso, el umbral esta mal.',
      },
    ],
  },
  {
    id: 'f13.notificaciones',
    moduleId: 'notifications',
    title: 'Enterarte de lo que importa',
    summary: 'Pocas alertas y que cada una signifique algo.',
    xp: 20,
    steps: [
      {
        title: 'Elige por donde te llega',
        body: 'Dentro del sistema, correo o el telefono. Lo urgente al telefono; el resto, dentro.',
        action: { label: 'Ir a Notificaciones', path: '/notificaciones' },
      },
      {
        title: 'Cada quien configura las suyas',
        body: 'Al cajero no le sirve una alerta de contabilidad. Si le llega todo, deja de mirar.',
        tip: 'Menos alertas y mejores. Veinte al dia es lo mismo que cero.',
      },
      {
        title: 'Lo que de verdad para el negocio',
        body: 'Quedarte sin NCF, un rechazo de la DGII, stock en cero de lo que mas vendes. Esas si.',
        action: { label: 'Ver notificaciones', path: '/notificaciones' },
      },
      {
        title: 'Si no vas a hacer nada, no es alerta',
        body: 'Una notificacion que no cambia lo que haces es ruido. Quitala.',
      },
    ],
  },
  // -- Los que faltaban ---------------------------------------------------
  {
    id: 'f14.copiloto',
    moduleId: 'ai-copilot',
    title: 'Preguntarle al sistema en español',
    summary: 'Respuestas sobre TUS datos, sin aprender a hacer reportes.',
    xp: 25,
    steps: [
      {
        title: 'Preguntale como le hablarias a un empleado',
        body: 'Cuanto vendi este mes, quien me debe mas, que producto no se mueve. Sin menus ni filtros.',
        action: { label: 'Abrir el copiloto', path: '/copiloto' },
      },
      {
        title: 'Solo ve lo que tu ves',
        body: 'Responde con los datos de tu empresa y con los permisos de tu usuario. A un cajero no le va a decir los costos.',
        tip: 'Por eso nunca le des tu usuario a otra persona: el copiloto responderia con tu nivel de acceso.',
      },
      {
        title: 'Verifica lo que suene raro',
        body: 'Si una cifra te sorprende, pidele de donde salio y comprueba en el reporte. Es una ayuda, no la fuente.',
        action: { label: 'Ver reportes', path: '/reportes' },
      },
      {
        title: 'No decide por ti',
        body: 'Te dice que pasa; que hacer al respecto sigue siendo tuyo.',
      },
    ],
  },
  {
    id: 'f14.api',
    moduleId: 'api-webhooks',
    title: 'Conectar otro sistema con este',
    summary: 'Llaves de acceso y avisos automaticos hacia afuera.',
    xp: 30,
    steps: [
      {
        title: 'Una llave por integracion, nunca compartida',
        body: 'Si la tienda en linea y el contador usan la misma llave, no puedes cortarle a uno sin cortarle al otro.',
        action: { label: 'Ir a API y webhooks', path: '/api-webhooks' },
      },
      {
        title: 'La llave se ve UNA vez',
        body: 'Al crearla la copias y la guardas donde guardas tus claves. Despues no se vuelve a mostrar: se genera otra.',
        tip: 'No la mandes por WhatsApp ni la escribas en un correo. Quien la tenga entra como tu.',
      },
      {
        title: 'Los webhooks avisan cuando algo pasa',
        body: 'En vez de que el otro sistema pregunte cada minuto, este le avisa cuando hay una venta nueva.',
        action: { label: 'Ver webhooks', path: '/api-webhooks' },
      },
      {
        title: 'Si dejas de usar una integracion, borra su llave',
        body: 'Una llave viva de un sistema que ya no usas es una puerta abierta que nadie vigila.',
      },
    ],
  },
  {
    id: 'f14.cuenta',
    moduleId: 'auth',
    title: 'Tu cuenta y tu seguridad',
    summary: 'Clave, segundo factor y por que no se comparte.',
    xp: 20,
    steps: [
      {
        title: 'Tu usuario es tuyo y de nadie mas',
        body: 'Todo lo que se haga con el queda a tu nombre en la bitacora. Prestarlo es responder por lo que haga otro.',
        action: { label: 'Ir a Mi cuenta', path: '/perfil' },
      },
      {
        title: 'Activa el segundo factor',
        body: 'Una clave sola se adivina o se filtra. Con segundo factor, saberla no alcanza.',
        tip: 'Hazlo hoy, no cuando pase algo. Toma dos minutos.',
      },
      {
        title: 'Cierra sesion en equipos que no son tuyos',
        body: 'Un equipo compartido con la sesion abierta es la cuenta abierta.',
        action: { label: 'Ver mis sesiones', path: '/perfil' },
      },
      {
        title: 'Si sospechas, cambia la clave ya',
        body: 'Cambiarla cierra las sesiones abiertas. Es lo primero, antes de averiguar que paso.',
      },
    ],
  },
  {
    id: 'f14.conciliacion',
    moduleId: 'bank-rec',
    title: 'Cuadrar con el banco',
    summary: 'Lo que el banco dice contra lo que tu tienes.',
    xp: 30,
    steps: [
      {
        title: 'Sube el estado de cuenta',
        body: 'El archivo que baja tu banco. El sistema casa solo lo que coincide en monto y fecha.',
        action: { label: 'Ir a Conciliacion', path: '/conciliacion' },
      },
      {
        title: 'Lo que no casa es tu trabajo',
        body: 'Cheques sin cobrar, depositos en transito, comisiones que no registraste. Eso es todo lo que hay que mirar.',
        tip: 'Las comisiones y los ITBIS bancarios son lo que mas descuadra, y casi nadie los registra hasta conciliar.',
      },
      {
        title: 'Concilia cada mes, no cada seis',
        body: 'Una diferencia de este mes se encuentra en minutos. De hace seis meses, en dias.',
        action: { label: 'Ver conciliaciones', path: '/conciliacion' },
      },
      {
        title: 'Una diferencia que no aparece, se investiga',
        body: 'No la fuerces con un ajuste. Un descuadre que se tapa vuelve el mes que viene mas grande.',
      },
    ],
  },
  {
    id: 'f14.beneficios',
    moduleId: 'benefits',
    title: 'Beneficios y prestamos a empleados',
    summary: 'Seguro, planes y descuentos por nomina.',
    xp: 25,
    steps: [
      {
        title: 'Los planes se definen una vez',
        body: 'Seguro medico, plan dental, lo que ofrezcas. Despues inscribes gente, no configuras de nuevo.',
        action: { label: 'Ir a Planes', path: '/beneficios/planes' },
      },
      {
        title: 'La inscripcion es por persona',
        body: 'Quien entra, desde cuando y cuanto aporta cada parte. De ahi sale el descuento en nomina.',
        action: { label: 'Ir a Beneficios', path: '/beneficios' },
      },
      {
        title: 'Un prestamo se descuenta solo',
        body: 'Defines cuotas y la nomina las descuenta hasta saldarlo. Un prestamo saldado queda inmutable.',
        tip: 'Pon un tope de cuanto del sueldo puede irse en descuentos. Sin tope, alguien termina cobrando cero.',
      },
      {
        title: 'Cancelar no borra el historial',
        body: 'Una inscripcion cancelada se queda con su fecha. Hace falta para responder por lo que se descontaba antes.',
      },
    ],
  },
  {
    id: 'f14.bi',
    moduleId: 'bi',
    title: 'Reportes y tableros',
    summary: 'Los numeros que se miran, no los que se pueden sacar.',
    xp: 30,
    steps: [
      {
        title: 'Empieza por tres numeros, no por treinta',
        body: 'Ventas, margen y cuanto te deben. Si solo pudieras ver tres, esos.',
        action: { label: 'Ir a Reportes', path: '/reportes' },
      },
      {
        title: 'Compara siempre contra algo',
        body: 'Un numero solo no dice nada. Contra el mes pasado o contra el ano pasado, si.',
        tip: 'En un negocio con temporada, compara contra el mismo mes del ano pasado, no contra el mes anterior.',
      },
      {
        title: 'Guarda el reporte que usas',
        body: 'Si armas el mismo filtro cada lunes, guardalo. Rehacerlo es donde se pierde la costumbre de mirarlo.',
        action: { label: 'Ver un reporte', path: '/reportes' },
      },
      {
        title: 'Todo reporte se exporta',
        body: 'A Excel o PDF, para el contador o el banco. Los datos son tuyos y salen cuando quieras.',
      },
    ],
  },
  {
    id: 'f14.sucursales',
    moduleId: 'branches',
    title: 'Varias sucursales',
    summary: 'Cada local con su inventario y su caja, todo en una empresa.',
    xp: 25,
    steps: [
      {
        title: 'Una sucursal es un sitio con inventario propio',
        body: 'Local, almacen o punto de venta. El stock se cuenta por sucursal, no en bulto.',
        action: { label: 'Ir a Sucursales', path: '/sucursales' },
      },
      {
        title: 'Cada quien ve la suya',
        body: 'El encargado de un local ve su sucursal. Quien administra las ve todas.',
        tip: 'Es lo que evita que un cajero de un local venda stock que esta en otro.',
      },
      {
        title: 'Mover entre sucursales es transferir',
        body: 'Nunca ajustes de menos en una y de mas en otra. La transferencia deja el rastro de las dos puntas.',
        action: { label: 'Ir a Transferencias', path: '/transferencias' },
      },
      {
        title: 'Compara el resultado de cada una',
        body: 'Cual vende mas por metro, cual tiene mas merma. Es la informacion con la que se abre o se cierra un local.',
      },
    ],
  },
  {
    id: 'f14.chat',
    moduleId: 'chat',
    title: 'Hablar dentro del sistema',
    summary: 'Para que lo del trabajo no viva en WhatsApp.',
    xp: 20,
    steps: [
      {
        title: 'Conversaciones por tema o por area',
        body: 'Un canal por sucursal o por proyecto. Lo que se decide ahi queda donde se trabaja.',
        action: { label: 'Ir a Chat', path: '/chat' },
      },
      {
        title: 'Se puede mencionar un documento',
        body: 'Hablar de una factura con el enlace al lado evita el "cual factura" y tres mensajes de mas.',
      },
      {
        title: 'Lo urgente no va por chat',
        body: 'Si algo tiene que pasar, hazlo tarea o ticket. Un mensaje se lo lleva el scroll.',
        action: { label: 'Ver conversaciones', path: '/chat' },
        tip: 'La regla simple: si tiene dueno y fecha, no es un mensaje.',
      },
      {
        title: 'Quien entra despues lee lo de antes',
        body: 'Un empleado nuevo se pone al dia leyendo el canal. Eso un grupo de WhatsApp no lo da.',
      },
    ],
  },
  {
    id: 'f14.tablero',
    moduleId: 'dashboard',
    title: 'Tu pantalla de inicio',
    summary: 'Lo primero que ves al entrar, y que deberia ser.',
    xp: 20,
    steps: [
      {
        title: 'El tablero es de cada quien',
        body: 'Lo que le sirve al dueno no le sirve al cajero. Cada usuario arma el suyo.',
        action: { label: 'Ir al inicio', path: '/' },
      },
      {
        title: 'Los modulos aportan sus tarjetas',
        body: 'Activas un modulo y aparecen sus indicadores. Apagas uno y desaparecen. No hay que configurar nada.',
      },
      {
        title: 'Pocas tarjetas y grandes',
        body: 'Un tablero con quince cosas no se mira. Con cuatro, si.',
        tip: 'Si llevas una semana sin mirar una tarjeta, quitala. El tablero es para actuar, no para decorar.',
      },
      {
        title: 'De la tarjeta al detalle',
        body: 'Toda tarjeta lleva al sitio donde se resuelve. Ver que te deben mucho sin poder ir a cobrar no sirve.',
        action: { label: 'Ir a Cuentas por cobrar', path: '/cobrar' },
      },
    ],
  },
  {
    id: 'f14.firma',
    moduleId: 'e-sign',
    title: 'Firmar documentos',
    summary: 'Contratos y aprobaciones sin imprimir ni escanear.',
    xp: 25,
    steps: [
      {
        title: 'Sube el documento y marca quien firma',
        body: 'Uno o varios firmantes, en el orden que haga falta.',
        action: { label: 'Ir a Firma electronica', path: '/firma-electronica' },
      },
      {
        title: 'Cada firmante recibe su enlace',
        body: 'Firma desde su telefono. No hace falta que tenga cuenta en el sistema.',
      },
      {
        title: 'Queda constancia de quien, cuando y desde donde',
        body: 'Eso es lo que hace la firma defendible. Un PDF con una imagen pegada no lo es.',
        action: { label: 'Ver documentos', path: '/firma-electronica' },
        tip: 'No la confundas con el certificado de la DGII: eso es otra cosa y solo sirve para facturar.',
      },
      {
        title: 'Firmado, el documento se congela',
        body: 'Si hay que cambiar algo, se firma uno nuevo. Tocar un documento firmado invalida la firma.',
      },
    ],
  },
  {
    id: 'f14.ecommerce',
    moduleId: 'ecommerce',
    title: 'Vender en linea con el mismo inventario',
    summary: 'Una sola existencia para la tienda y para la web.',
    xp: 30,
    steps: [
      {
        title: 'El inventario es uno solo',
        body: 'Lo que se vende en la web descuenta del mismo stock que el mostrador. Dos inventarios separados es como se vende lo que no hay.',
        action: { label: 'Ir a Tienda en linea', path: '/ecommerce' },
      },
      {
        title: 'Elige que productos salen',
        body: 'No todo tiene que estar en linea. Marca lo que si, con su foto y su descripcion.',
        tip: 'Sin foto no se vende. Es el trabajo aburrido que decide si la tienda funciona.',
      },
      {
        title: 'El pedido web entra como cualquier otro',
        body: 'Llega a la misma lista de pedidos, se prepara igual y se factura igual.',
        action: { label: 'Ir a Pedidos', path: '/pedidos' },
      },
      {
        title: 'Deja un margen de stock',
        body: 'Si tienes 3, publica 2. El tercero te salva del cliente que compro en linea lo que acabas de vender en el mostrador.',
      },
    ],
  },
  {
    id: 'f14.archivos',
    moduleId: 'files',
    title: 'Documentos donde toca',
    summary: 'Adjuntos pegados al cliente, al producto o a la factura.',
    xp: 20,
    steps: [
      {
        title: 'El archivo vive con el registro',
        body: 'El contrato con el cliente, la ficha con el producto, el conduce con la recepcion. No en una carpeta suelta.',
        action: { label: 'Ir a Archivos', path: '/archivos' },
      },
      {
        title: 'Nombres que se entiendan',
        body: 'Contrato-2026-Ferreteria.pdf, no escaneo7.pdf. Dentro de un ano lo vas a agradecer.',
      },
      {
        title: 'Ve quien lo subio y cuando',
        body: 'Cada archivo trae su rastro. Si hay dos versiones de un contrato, sabes cual es la ultima.',
        action: { label: 'Ver archivos', path: '/archivos' },
        tip: 'Sube version nueva en vez de borrar la vieja. Borrar te deja sin con que comparar.',
      },
      {
        title: 'Solo lo ve quien puede ver el registro',
        body: 'Si no tienes acceso al empleado, no ves su contrato. El permiso del archivo es el del sitio donde esta.',
      },
    ],
  },
  {
    id: 'f14.portal-empleado',
    moduleId: 'hr-portal',
    title: 'Que el empleado se atienda solo',
    summary: 'Volantes, saldo de vacaciones y cartas, sin pasar por recursos humanos.',
    xp: 25,
    steps: [
      {
        title: 'Su volante lo baja el',
        body: 'Cada quien entra y baja el suyo. Recursos humanos deja de imprimir y repartir papeles.',
        action: { label: 'Ir al portal', path: '/portal' },
      },
      {
        title: 'Ve su saldo de vacaciones al momento',
        body: 'La pregunta que mas se repite en toda empresa deja de hacerse.',
      },
      {
        title: 'Pide permisos desde ahi',
        body: 'La solicitud va a su supervisor sin papeles de por medio.',
        action: { label: 'Ir a Vacaciones', path: '/vacaciones' },
      },
      {
        title: 'Los anuncios llegan a todos',
        body: 'Lo que antes era un papel en la pared. Y se sabe quien lo leyo.',
        action: { label: 'Ver anuncios', path: '/portal/anuncios' },
        tip: 'Usalo para lo que de verdad es de todos. Si publicas cada cosa, dejan de entrar.',
      },
    ],
  },
  {
    id: 'f14.captura-facturas',
    moduleId: 'invoice-capture',
    title: 'Facturas de proveedor sin teclear',
    summary: 'Foto o PDF, y los datos salen solos.',
    xp: 25,
    steps: [
      {
        title: 'Sube la foto o el PDF',
        body: 'Lee el RNC, el NCF, la fecha y el monto. Tu confirmas, no tecleas.',
        action: { label: 'Ir a Cuentas por pagar', path: '/pagar' },
      },
      {
        title: 'Revisa SIEMPRE el NCF y el monto',
        body: 'Son los dos que van a la 606. Un digito mal leido te lo devuelve la DGII.',
        tip: 'Una factura arrugada o con sello encima se lee mal. Esas conviene teclearlas.',
      },
      {
        title: 'El archivo se queda pegado',
        body: 'La imagen original queda con el registro. Es tu respaldo si alguien pregunta.',
        action: { label: 'Ver archivos', path: '/archivos' },
      },
      {
        title: 'Captura el mismo dia que llega',
        body: 'Un monton de facturas del mes acumuladas es como se pasan las fechas de la 606.',
      },
    ],
  },
  {
    id: 'f14.marketing',
    moduleId: 'marketing',
    title: 'Campanas a tus clientes',
    summary: 'Mandar a quien toca, no a todos.',
    xp: 25,
    steps: [
      {
        title: 'Segmenta antes de mandar',
        body: 'Los que compraron esto, los que no vienen hace tres meses. Mandarle a todos lo mismo es como te dejan de leer.',
        action: { label: 'Ir a Marketing', path: '/marketing' },
      },
      {
        title: 'La lista sale de tus clientes reales',
        body: 'No hace falta exportar a otro sistema: el segmento se arma con tu historial de ventas.',
      },
      {
        title: 'Mide lo que vendio, no lo que abrio',
        body: 'Una campana con muchas aperturas y cero ventas no funciono. La venta es la medida.',
        action: { label: 'Ver campanas', path: '/marketing' },
        tip: 'Manda menos y mejor. Dos campanas buenas al mes rinden mas que ocho.',
      },
      {
        title: 'Respeta a quien se da de baja',
        body: 'Si alguien pide no recibir, se respeta. Insistir cuesta el cliente, no solo el correo.',
      },
    ],
  },
  {
    id: 'f14.empresas',
    moduleId: 'orgs',
    title: 'Una o varias empresas',
    summary: 'Cada RNC con su contabilidad, bajo una misma cuenta.',
    xp: 25,
    steps: [
      {
        title: 'Una empresa es un RNC',
        body: 'Si facturas con dos RNC, son dos empresas: contabilidad, NCF e inventario separados.',
        action: { label: 'Ir a Empresas', path: '/empresas' },
      },
      {
        title: 'Los datos salen en cada factura',
        body: 'Razon social, RNC, direccion y telefono. Revisalos una vez, porque van impresos en todo.',
        tip: 'El telefono va con guiones en la factura electronica. Es un requisito de formato de la DGII.',
      },
      {
        title: 'Cambias de empresa arriba',
        body: 'La barra de la izquierda cambia de empresa sin cerrar sesion. Lo que ves es siempre de una sola.',
      },
      {
        title: 'Nunca se mezclan',
        body: 'Ni por error ni a proposito: los datos de una empresa no se ven desde otra. Lo asegura la base, no la pantalla.',
        action: { label: 'Ver empresas', path: '/empresas' },
      },
    ],
  },
  {
    id: 'f14.pagos',
    moduleId: 'payments',
    title: 'Cobrar con tarjeta y transferencia',
    summary: 'Formas de pago, comisiones y cuando entra la plata.',
    xp: 25,
    steps: [
      {
        title: 'Cada forma de pago se registra aparte',
        body: 'Efectivo, tarjeta, transferencia. Cuadrar la caja empieza por saber cuanto entro de cada una.',
        action: { label: 'Ir a Punto de venta', path: '/pos' },
      },
      {
        title: 'La tarjeta cobra comision y tarda',
        body: 'Vendes 1,000 y te entran 970 en dos dias. Si no registras la comision, la caja nunca cuadra.',
        tip: 'Esa comision es gasto deducible. Registrala bien y la recuperas en la declaracion.',
      },
      {
        title: 'Un pago puede ser mixto',
        body: 'Mitad efectivo y mitad tarjeta es normal. Se reparte en el momento, no despues.',
        action: { label: 'Ver cobros', path: '/cobros' },
      },
      {
        title: 'Cuadra el turno al cerrar',
        body: 'Lo contado contra lo registrado, por forma de pago. La diferencia se explica hoy, no manana.',
        action: { label: 'Ver turnos', path: '/pos/shifts' },
      },
    ],
  },
  {
    id: 'f14.desempeno',
    moduleId: 'performance',
    title: 'Evaluaciones de desempeno',
    summary: 'Metas, evaluacion y planes de mejora.',
    xp: 25,
    steps: [
      {
        title: 'Primero las metas, despues la evaluacion',
        body: 'Evaluar sin metas puestas al principio es opinar. Definelas al empezar el periodo.',
        action: { label: 'Ir a Desempeno', path: '/desempeno' },
      },
      {
        title: 'Una evaluacion enviada es inmutable',
        body: 'Igual que un pago: una vez enviada no se retoca. Es lo que la hace valer en una discusion.',
        tip: 'Revisala dos veces antes de enviar. Lo escrito ahi puede terminar en una demanda laboral.',
      },
      {
        title: 'La 360 recoge varias voces',
        body: 'Supervisor, pares y la propia persona. Una sola opinion mide tanto al que evalua como al evaluado.',
        action: { label: 'Ver evaluaciones', path: '/desempeno' },
      },
      {
        title: 'Un plan de mejora tiene fecha',
        body: 'Sin fecha ni seguimiento es una queja por escrito. Resuelto queda inmutable, como la evaluacion.',
      },
    ],
  },
  {
    id: 'f14.reclutamiento',
    moduleId: 'recruiting',
    title: 'Contratar gente',
    summary: 'De la vacante al expediente de empleado.',
    xp: 25,
    steps: [
      {
        title: 'Abre la vacante con lo que de verdad pides',
        body: 'Cargo, salario y requisitos. Una vacante vaga trae candidatos vagos.',
        action: { label: 'Ir a Reclutamiento', path: '/reclutamiento' },
      },
      {
        title: 'Los candidatos van avanzando por etapas',
        body: 'Recibido, entrevista, prueba, oferta. Saber donde esta cada uno evita perder al bueno por tardanza.',
      },
      {
        title: 'Una aplicacion resuelta queda firme',
        body: 'Contratado o rechazado, no se vuelve a mover. Y el rechazado se guarda: la proxima vacante empieza ahi.',
        action: { label: 'Ver candidatos', path: '/reclutamiento' },
        tip: 'Avisale siempre al que no quedo. Cuesta un minuto y es lo que decide si te recomienda o no.',
      },
      {
        title: 'Contratado se vuelve empleado',
        body: 'Sus datos pasan al expediente sin volver a teclearlos.',
        action: { label: 'Ir a Empleados', path: '/empleados' },
      },
    ],
  },
  {
    id: 'f14.recursos',
    moduleId: 'resources',
    title: 'Reservar salas y equipos',
    summary: 'Lo que se comparte, sin choques.',
    xp: 20,
    steps: [
      {
        title: 'Un recurso es algo que se comparte',
        body: 'Una sala, un vehiculo, un equipo de medicion. Lo que dos personas pueden necesitar a la vez.',
        action: { label: 'Ir a Recursos', path: '/recursos' },
      },
      {
        title: 'Dos reservas no se pisan',
        body: 'El sistema no deja reservar lo ya reservado. Ahi se acaba la discusion de quien llego primero.',
      },
      {
        title: 'Reserva con dueno',
        body: 'Cada reserva tiene a quien reclamarle si no aparece o si deja el equipo sucio.',
        action: { label: 'Ver reservas', path: '/recursos' },
        tip: 'Cancela lo que no vas a usar. Una sala reservada y vacia es peor que una ocupada.',
      },
      {
        title: 'Lo que siempre esta lleno, hace falta mas',
        body: 'Si un recurso vive reservado, el dato para comprar otro ya lo tienes.',
      },
    ],
  },
  {
    id: 'f14.busqueda',
    moduleId: 'search',
    title: 'Encontrar cualquier cosa rapido',
    summary: 'Un solo campo para todo el sistema.',
    xp: 20,
    steps: [
      {
        title: 'Ctrl+K abre la busqueda',
        body: 'Desde donde estes. Escribe el nombre de un cliente, un numero de factura o un producto.',
        action: { label: 'Ir al inicio', path: '/' },
      },
      {
        title: 'Tambien busca acciones',
        body: 'Escribe "nueva factura" y te lleva. No hace falta acordarse en que menu estaba.',
        tip: 'Es lo mas rapido del sistema. Quien lo usa deja de navegar por menus.',
      },
      {
        title: 'Solo encuentra lo que puedes ver',
        body: 'La busqueda respeta tus permisos: no va a mostrarte lo que la pantalla te oculta.',
      },
      {
        title: 'Busca por lo que recuerdes',
        body: 'Un pedazo del nombre, el RNC o el numero. No hace falta que sea exacto.',
        action: { label: 'Ir a Clientes', path: '/crm' },
      },
    ],
  },
  {
    id: 'f14.capacitacion',
    moduleId: 'training',
    title: 'Capacitar a tu gente',
    summary: 'Cursos, inscripciones y constancia de quien lo hizo.',
    xp: 25,
    steps: [
      {
        title: 'Registra los cursos que das',
        body: 'Internos o externos, con su fecha y su duracion. Hace falta para el expediente y para la ley.',
        action: { label: 'Ir a Capacitacion', path: '/capacitacion' },
      },
      {
        title: 'Inscribe y lleva la asistencia',
        body: 'Quien fue y quien no. Un curso sin lista de asistencia no le consta a nadie.',
      },
      {
        title: 'Una inscripcion resuelta queda firme',
        body: 'Completado o no completado no se vuelve a tocar. Es la constancia.',
        action: { label: 'Ver cursos', path: '/capacitacion' },
        tip: 'Guarda el certificado como archivo adjunto. El dia de una auditoria de seguridad laboral te lo van a pedir.',
      },
      {
        title: 'Capacita a quien lo necesita',
        body: 'Cruza lo que falta en las evaluaciones con los cursos. Capacitar a ciegas es gastar.',
      },
    ],
  },
]

export function toursFor(licensedModules: Set<string>): Tour[] {
  return TOURS.filter((t) => licensedModules.has(t.moduleId))
}
