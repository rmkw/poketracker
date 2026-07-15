# Pokémon Amazon México Tracker

Monitor local para vigilar la disponibilidad y el precio de un producto de
Amazon México y enviar una alerta por Telegram cuando cumpla las condiciones.

El flujo principal permite vigilar uno o varios productos:

- Pokémon TCG: 30TH Celebration Elite Trainer Box
- ASIN `B0H78BB9TY` y los ASIN que agregues en `AMAZON_ASINS`
- precio máximo predeterminado de $1,300 MXN
- vendedor Amazon México
- envío realizado por Amazon México
- compra o preventa disponible públicamente

Este proyecto **no compra**, no agrega productos al carrito, no inicia checkout
y no almacena credenciales de Amazon ni datos de pago.

## Requisitos

- Node.js 22.12.0 o posterior
- pnpm
- un bot de Telegram y el identificador del chat receptor

## Instalación restringida

El lockfile fija las versiones e integridades de los paquetes. Para instalar sin
ejecutar scripts de instalación de dependencias:

```bash
pnpm install --frozen-lockfile --ignore-scripts
```

Después puedes revisar las dependencias conocidas con:

```bash
pnpm audit --prod
```

## Configuración

Crea el archivo privado de entorno:

```bash
cp .env.example .env
```

Configuración mínima:

```env
AMAZON_ASINS=B0H78BB9TY
MAX_PRICE=1300
CHECK_INTERVAL_MINUTES=1
POKEMON_ALERT_STATE_FILE=.pokemon-alert-state.json
PRICE_HISTORY_FILE=.pokemon-price-history.json
AMAZON_SCRAPER_PROVIDER=auto
DECODO_AUTH_TOKEN=token_de_decodo
DECODO_REQUEST_TIMEOUT_SECONDS=120
DEBUG=false

TELEGRAM_BOT_TOKEN=token_generado_por_botfather
TELEGRAM_CHAT_ID=identificador_del_chat
```

`AMAZON_PRODUCTS` configura límites individuales con `ASIN:precio`, separados
por comas. El ejemplo vigila `B0H78BB9TY` hasta $1,300 y `B0H783FY5Z` hasta
$600. `AMAZON_ASINS`, `MAX_PRICE` y `POKEMON_ASIN` siguen disponibles por
compatibilidad.

`.env` está ignorado por Git. No pongas tokens reales en `.env.example`.

Con `AMAZON_SCRAPER_PROVIDER=auto`, el monitor usa Decodo cuando encuentra una
credencial real y conserva el acceso directo como respaldo. En esta conexión el
acceso directo recibe CAPTCHA, por lo que Decodo es necesario para la prueba
real. Turso no se utiliza en este flujo.

Cuando usa Decodo, el monitor consulta el target `amazon_pricing` con JSON
parseado y sin renderizado JavaScript. Así valida precio, vendedor y envío sin
descargar HTML renderizado. Si el proveedor no puede responder, la revisión
falla de forma segura y no genera una alerta incompleta.

## Comandos principales

Prueba Telegram sin consultar Amazon:

```bash
pnpm telegram:test
```

Comandos disponibles desde el chat autorizado del bot:

```text
/estado          estado general, intervalo y productos
/1min            revisar cada minuto
/5min            revisar cada cinco minutos
/pausar_todo     detener las consultas de todos los productos
/reanudar_todo   reanudar las consultas
/pausar1         pausar el primer producto
/reanudar1       reanudar el primer producto
/pausar2         pausar el segundo producto
/reanudar2       reanudar el segundo producto
/ayuda           mostrar los comandos disponibles
```

También se puede indicar el ASIN, por ejemplo `/pausar B0H78BB9TY`. Un comando
desconocido responde con ayuda y no detiene el monitor.

Ejecuta una sola revisión:

```bash
pnpm track:mx
```

Mantén el monitor activo localmente:

```bash
pnpm track:mx:watch
```

El modo continuo espera `CHECK_INTERVAL_MINUTES` entre revisiones. Con Decodo
el mínimo aceptado es un minuto; sin Decodo se mantiene en cinco minutos para
no forzar el acceso directo de Amazon. Cada revisión consulta una vez por ASIN:
dos ASIN cada minuto consumen 2,880 consultas diarias de Decodo.

Detén el modo continuo con `Ctrl+C`.

El dashboard local permite pausar/reanudar todo o cada producto individualmente.
Un producto pausado no hace consultas a Decodo. Para Windows, ejecuta una vez
`run-monitor.cmd` o programa ese archivo con el Programador de tareas usando el
disparador **Al iniciar sesión**. El dashboard continúa en `http://127.0.0.1:4321`
mientras ejecutes `pnpm dev`; sus controles se conectan solo al monitor local.

## Condiciones de la alerta

Telegram recibe un mensaje únicamente cuando:

1. existe una señal pública de compra o preventa;
2. el producto no aparece agotado;
3. el precio es igual o menor que `MAX_PRICE`;
4. vende Amazon México;
5. envía Amazon México;
6. ese mismo estado todavía no fue alertado.

La firma de la alerta considera el precio, vendedor, remitente y disponibilidad,
pero ignora textos variables como la fecha estimada de entrega.

Cada precio encontrado se guarda localmente cuando cambia, incluso si la oferta
no cumple aún las condiciones. Telegram se mantiene breve: nombre del producto
y enlace directo a Amazon; la hora del mensaje indica cuándo se detectó.

Si Telegram falla, la alerta no se marca como enviada y se intenta nuevamente
en la siguiente revisión. Si el producto se agota y después regresa con las
mismas condiciones, vuelve a alertar.

## Estado y diagnósticos

El último estado se guarda localmente en:

```text
.pokemon-alert-state.json
```

La escritura es atómica y el archivo está ignorado por Git.

El historial por ASIN se guarda en `.pokemon-price-history.json`, también
ignorado por Git. Se conservan hasta 300 cambios por ASIN de forma predeterminada.

Cuando Amazon devuelve CAPTCHA, una respuesta incompleta o faltan campos
importantes de una oferta disponible, el HTML se guarda en `diagnostics/`.
Estos archivos también están ignorados por Git.

Activa información detallada con:

```env
DEBUG=true
```

## Restricciones de dirección

La primera versión observa únicamente la oferta pública. Si Amazon muestra una
restricción para una dirección concreta, el monitor la registra en DEBUG, pero
no intenta iniciar sesión ni validar el checkout.

Por eso una alerta confirma disponibilidad pública, no que Amazon vaya a aceptar
una dirección específica al finalizar la compra.

## Pruebas y build

Ejecuta las pruebas del parser y del estado local:

```bash
pnpm test
```

Comprueba el proyecto Astro:

```bash
pnpm build
```

El dashboard heredado usa Turso y es independiente del monitor local.

## Solución de problemas

### Telegram responde 401

El token no coincide con un bot activo. Verifícalo con BotFather y con el método
`getMe`. Si el token fue compartido públicamente, revócalo y genera otro.

### Telegram responde chat not found

Abre el chat con el bot, presiona Start, envía un mensaje y obtén nuevamente
`message.chat.id` mediante `getUpdates`.

### Amazon devuelve CAPTCHA o bloqueo

Revisa el archivo creado en `diagnostics/`. Configura `DECODO_AUTH_TOKEN` y deja
`AMAZON_SCRAPER_PROVIDER=auto` para que el monitor use el proveedor proxy. No
reduzcas el intervalo a pocos segundos ni intentes evadir el CAPTCHA
agresivamente con el acceso directo.

### Precio, vendedor o remitente no encontrados

Ejecuta una vez con `DEBUG=true` y conserva el HTML de diagnóstico. Amazon
puede variar la estructura de la página según ubicación, idioma o sesión.

## Tracker heredado opcional

El repositorio conserva el tracker original con Decodo, Turso y el dashboard
Astro:

- `pnpm track`
- `pnpm track:manual`
- `pnpm track:proxy`
- `pnpm dev`

Ese flujo requiere `DECODO_AUTH_TOKEN`, `TURSO_DATABASE_URL` y
`TURSO_AUTH_TOKEN`. El monitor `track:mx` reutiliza únicamente
`DECODO_AUTH_TOKEN`; no necesita Turso.

El workflow actual de GitHub Actions sigue apuntando al tracker heredado. No
debe activarse para el monitor Pokémon hasta terminar y validar las pruebas
locales.
