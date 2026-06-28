# Conway Conquerors — Hostinger Business Node.js

## Configuración en hPanel

### Framework preset
Elegí **"Other"** o dejalo en blanco. No es un framework conocido.

### Build command
Dejalo **vacío** (o escribí `echo ok`). No hay paso de compilación.

### Output directory  
Dejalo **vacío**. Los archivos estáticos los sirve el mismo `server.js`.

### Start command
```
node server.js
```
(hPanel lo detecta solo desde el script `"start"` del package.json, pero si pide confirmación, ponés esto)

### Node.js version
Elegí **Node.js 18** (ya lo hace automáticamente, no necesitás tocar nada).

### Environment variables
No son obligatorias. Hostinger inyecta `PORT` automáticamente.
Si querés definirla explícitamente por las dudas:
```
PORT = 3000
```

### ¿Base de datos?
**No.** No agregar nada de MySQL, Redis ni similares. El juego no usa base de datos.

---

## Estructura de archivos

Subí (o conectá el repo con) esta carpeta completa:
```
conways-conquerors-vps/
├── server.js          ← el servidor
├── package.json       ← con "start": "node server.js"
├── index.html         ← landing page
├── favicon.svg
└── play/
    ├── index.html     ← el juego
    └── game.js
```

## Dominio personalizado

En hPanel → Hosting → tu app Node → **Dominios** → asociá tu dominio.
Hostinger maneja el proxy 80/443 → tu app, y el SSL lo activan desde ahí también.
No necesitás configurar nginx manualmente.

## Multijugador online: WebSocket con fallback automático

El cliente intenta primero WebSocket (menor latencia). Si el proxy del hosting
descarta el handshake (síntoma: el modo online se quedaba en "loading"), a los
4 segundos **cae automáticamente a HTTP long-polling** contra `/api/send` y
`/api/poll` — que funciona en cualquier hosting que sirva HTTP, incluido
Hostinger Node. No hay nada que configurar: la conmutación es transparente
y ambos transportes hablan el mismo protocolo contra el mismo servidor.

Nota: las salas viven en memoria. Si Hostinger reinicia la app (se ve en los
logs como un nuevo banner de arranque), las partidas en curso se cortan —
es esperado y no requiere acción.

## Flujo online (v5.2) y seguridad

**Cómo funciona una partida online:**
1. El host elige *Host online game* → el lobby queda visible mostrando el
   código de sala y un **link directo** (https://tudominio.com/play/?room=CODIGO),
   que además se copia solo al portapapeles.
2. El rival abre ese link (entra directo) o elige *Join online game* y tipea el código.
3. Cuando ambos están conectados, la partida arranca sola.

**Errores claros:** código inexistente o sala llena ya no dejan la pantalla
colgada — muestran el motivo y un botón para volver.

**Límites anti-abuso por IP** (detrás del proxy se usa x-forwarded-for):
- 3 salas abiertas simultáneas por IP
- 12 sesiones de polling por IP
- 15 intentos de join por minuto por IP
- Las salas con más de 2 horas se eliminan solas.
