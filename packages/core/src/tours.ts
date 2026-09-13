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
]

export function toursFor(licensedModules: Set<string>): Tour[] {
  return TOURS.filter((t) => licensedModules.has(t.moduleId))
}
