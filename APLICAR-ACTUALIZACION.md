# Actualización del repo terriblecrow/conways-conquerors → v6.8.0

Este paquete contiene SOLO los archivos que cambiaron o son nuevos respecto al
repo actual. Copialos sobre tu clon local del repo (respetando las rutas) y
hacé un commit. Los archivos del repo que NO están acá quedan intactos.

## Cómo aplicarlo

```bash
git clone https://github.com/terriblecrow/conways-conquerors.git
cd conways-conquerors
# copiá el contenido de este paquete sobre el repo (mismas rutas):
#   server.js, index.html, package.json, README.md, CHANGELOG.md,
#   README-DEPLOY.md, README-ANDROID.md, README-HOSTINGER.md
#   play/index.html, play/game.min.js, play/game.js, play/sw.js
git add -A
git commit -m "v6.8.0: online fixes, full ES/EN client, static build, domain → conwayconquerors.com"
git push
```

## Archivos incluidos y qué cambió

| Archivo | Cambio |
|---|---|
| `server.js` | Rematch con consentimiento mutuo; link de Discord migrado a conwayconquerors.com |
| `index.html` | Landing del juego al día (trailer, easter egg, dominio nuevo) |
| `package.json` | Versión 6.1.0 → **6.8.0**, `main`/`start` apuntan a `server.js` (raíz), engines Node ≥18, license MIT |
| `README.md` | Reescrito: dominio nuevo, features al día, nota sobre game.js/game.min.js y build estático |
| `CHANGELOG.md` | Nueva entrada **[6.8]** consolidando todo |
| `README-DEPLOY.md` | Dominio migrado |
| `README-ANDROID.md` | Dominio migrado (manifest, assetlinks, TWA) |
| `README-HOSTINGER.md` | Sin cambios de contenido (incluido por completitud) |
| `play/index.html` | i18n completo, botón Menú, idioma ES/EN, rotate-lock tablets, carga game.min.js?v=77 |
| `play/game.min.js` | **v6.8** — todos los cambios (rematch, predicción, desconexión, i18n, CC_STATIC, etc.) |
| `play/game.js` | Fuente legible (beautified) sincronizada con el min, misma v6.8 |
| `play/sw.js` | Cache bump a v77 |

## NO incluido (queda intacto en el repo)

`LICENSE`, `.gitignore`, `conways.service`, `nginx.conf.example`,
`RESEARCH-PAPER.md`, `TECHNICAL-PAPER.md`, `play/manifest.webmanifest`,
`play/icons/`, `favicon.svg`, `.well-known/assetlinks.json`.

Si querés actualizar también `RESEARCH-PAPER.md` / `TECHNICAL-PAPER.md` con la
V2 y los cambios nuevos, decímelo y los reviso aparte.

## Notas

- **game.js vs game.min.js:** producción carga el `.min.js`. El `game.js` es la
  versión formateada y legible del MISMO código (generada por beautify del min
  v6.8), para lectura y contribuciones. Si editás `game.js`, re-minificá a
  `game.min.js` antes de shippear, y subí la versión (`GAME_VERSION`, el `?v=`
  en `play/index.html` y el `cc-shell-v` en `play/sw.js`).
- **Dominio:** todas las llamadas a la API en el cliente son relativas (`/api/…`)
  y el WebSocket usa `location.host`, así que el juego funciona en cualquier
  dominio sin tocar código. La migración a conwayconquerors.com solo afectó
  textos/links absolutos (Discord, docs).
- **Leaderboard:** se guarda en `../cc-data/leaderboard.json`, fuera del deploy,
  para sobrevivir redeploys. No se incluye en el repo.
- **Build itch.io / offline:** está soportado por el mismo cliente vía
  `window.CC_STATIC = true` (ver README). El zip listo para itch se generó
  aparte; no es parte del repo.
