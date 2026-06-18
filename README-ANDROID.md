# Conway's Conquerors — App de Android (TWA)

La forma más eficiente de tener app instalable y publicable en Play Store es una
**Trusted Web Activity (TWA)**: un contenedor nativo oficial de Google (el mismo
mecanismo que usan apps como Twitter Lite) que carga tu dominio a pantalla
completa, sin barra de navegador. Ventajas decisivas para este proyecto:

- **Cero código nativo que mantener** — la app ES https://terriblecrow.com/play/.
- **Las actualizaciones del juego llegan al instante**: deployás el sitio y todas
  las apps instaladas ya corren la versión nueva. No re-publicás en el Store.
- **El multijugador funciona tal cual**: la app usa la misma API (/api/*) y
  WebSocket/polling del sitio. No hay que "exponer" nada nuevo: la API ya está
  expuesta en tu dominio.
- Pesa ~1-2 MB.

El sitio ya quedó preparado (esta versión incluye todo):
- `play/manifest.webmanifest` — identidad de la app (nombre, colores, pantalla completa)
- `play/icons/` — íconos 192/512 normales y maskable
- `play/sw.js` — service worker network-first (nunca sirve código viejo; la API jamás se intercepta)
- `/.well-known/assetlinks.json` — verificación dominio↔app (falta tu huella, ver paso 3)

> Requisito previo: el sitio desplegado y accesible por HTTPS en tu dominio.

---

## Opción A — Bubblewrap (CLI oficial de Google)

### 1. Generar el proyecto

En tu máquina (necesita Node 18+; Bubblewrap descarga solo el JDK y el SDK de Android):

```bash
npm i -g @bubblewrap/cli
mkdir conquerors-android && cd conquerors-android
bubblewrap init --manifest https://terriblecrow.com/play/manifest.webmanifest
```

Respuestas sugeridas al asistente:
- **Domain**: terriblecrow.com
- **Application ID**: `com.terriblecrow.conquerors`
- **Display mode**: standalone · **Orientation**: portrait
- **Signing key**: dejá que cree uno nuevo (`android.keystore`) y **guardá la
  contraseña**: ese archivo firma todas tus versiones futuras.

### 2. Compilar

```bash
bubblewrap build
```

Genera:
- `app-release-signed.apk` → instalable directo en tu teléfono (pasalo por
  USB/Drive y abrilo; habilitá "instalar apps desconocidas" si lo pide).
- `app-release-bundle.aab` → el formato que sube a Google Play.

### 3. Vincular dominio y app (quita la barra del navegador)

Obtené la huella SHA-256 de tu keystore:

```bash
keytool -list -v -keystore android.keystore -alias android | grep SHA256
```

Pegá esa huella (formato `AA:BB:CC:...`) en `/.well-known/assetlinks.json`
del sitio, reemplazando el placeholder, y redeployá. Verificá que
`https://terriblecrow.com/.well-known/assetlinks.json` responda el JSON.

> Si publicás en Play con "Play App Signing", Google re-firma la app: agregá
> TAMBIÉN la huella que muestra Play Console → Setup → App integrity.
> assetlinks.json acepta varias huellas en el array.

### 4. Publicar en Google Play

1. Cuenta de desarrollador en https://play.google.com/console (pago único de 25 USD).
2. Crear app → subir el `.aab` en Production (o Internal testing primero).
3. Completar ficha: descripción, capturas (sacalas del juego en el teléfono),
   ícono 512px (usá `play/icons/icon-512.png`), clasificación de contenido
   (juego de estrategia, sin compras, sin anuncios — trámite corto).
4. Revisión de Google: típicamente 1-3 días la primera vez.

---

## Opción B — PWABuilder (sin instalar nada)

Si preferís no tocar una terminal: entrá a https://www.pwabuilder.com, pegá
`https://terriblecrow.com/play/`, y el sitio genera el paquete Android (TWA)
descargable con su keystore. Mismos pasos 3 y 4 de arriba para assetlinks y Play.

---

## Bonus inmediato: instalable sin Store

Con el manifest + service worker ya desplegados, cualquier Android con Chrome
muestra **"Agregar a pantalla de inicio" / "Instalar app"** al visitar
https://terriblecrow.com/play/ — pantalla completa, ícono propio, sin pasar por
el Store. Útil para que tus amigos la instalen hoy mismo mientras tramitás Play.

## Notas técnicas

- **iOS**: la misma PWA se instala desde Safari → Compartir → "Agregar a inicio".
- **¿Y una API nueva?** No hace falta: la TWA consume el sitio tal cual, y el
  juego ya habla con el servidor por `/api/send` + `/api/poll` (o WebSocket
  cuando el proxy lo permite). Una app nativa "de verdad" con UI propia sí
  necesitaría endpoints adicionales, pero multiplicaría el mantenimiento por
  cero beneficio para un juego que ya es 100% web.
- **Actualizaciones**: subí cambios al sitio → bump del parámetro `?v=` en
  game.js y del nombre de caché en sw.js → todos los clientes (web y app)
  reciben la versión nueva en la próxima apertura.
