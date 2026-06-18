# Conway Conquerors — Sitio web + Juego

Paquete listo para subir. Un solo servidor Node sirve todo: la landing en `/`, el juego en `/play/` y el multijugador por WebSocket — **sin instalar nada con npm**.

## Novedades de esta versión

**Landing bilingüe (ES/EN)**: toggle de idioma en la barra de navegación, detección automática según el idioma del navegador y preferencia recordada.

**Correcciones de lógica (servidor)**:
1. Al terminar la partida por extinción, el mensaje `gameover` ahora incluye el tablero final — antes el cliente quedaba mostrando el tablero previo a la evolución, contradiciendo el marcador.
2. Pedir revancha ya no borra la sala a los 60 segundos (el temporizador de limpieza se cancela al reiniciar).
3. Los nacimientos con empate de vecinos usan un desempate determinista (igual que el cliente y el modo guiado) — el resultado ya no depende del azar.

**Mejoras gráficas (juego)**:
- Células redondeadas con bisel sutil, estilo "espécimen de laboratorio".
- Animación de evolución: las células que mueren se encogen y desvanecen; las que nacen aparecen con un pop y un anillo de luz. Funciona en local, vs CPU, modo guiado y online.
- La bomba dispara una onda expansiva dorada animada.
- Al apuntar la bomba se resalta el área 3×3 completa (antes solo las celdas ocupadas).
- Las células que colocaste este turno se marcan con un anillo dorado.
- Aviso sonoro cuando la bomba sale de cooldown.

```
terriblecrow/
├── index.html          Landing del estudio (terriblecrow.com)
├── favicon.svg         Cuervo pixelado
├── conquerors/
│   ├── index.html      Landing del juego (bilingüe EN/ES)
│   └── favicon.svg
├── play/
│   ├── index.html      El juego
│   ├── game.js
│   └── favicon.svg
├── server.js           Servidor estático + WebSocket + API de polling
├── package.json
├── nginx.conf.example
├── conways.service
└── README-DEPLOY.md
```

## Probar en tu máquina

```bash
node server.js
# Landing:  http://localhost:3000
# Juego:    http://localhost:3000/play/
```

---

## ¿Necesita base de datos?

**No.** El juego no usa base de datos: no hay cuentas, ni registro, ni partidas guardadas. Las salas online viven en la memoria del proceso Node mientras se juegan y se descartan al terminar. Las únicas preferencias (idioma de la landing, audio silenciado) se guardan en el navegador de cada visitante. No instales MySQL ni nada parecido.

## Opción A — VPS con tu dominio (recomendada: multijugador completo)

Pasos para un **VPS de Hostinger** con Ubuntu (idénticos en Hetzner, Contabo, DigitalOcean, etc.). Al final, el juego queda corriendo **en el VPS, 24/7, accesible desde tu dominio** — tu computadora no participa: ya no escucha en tu puerto local ni necesita estar encendida.

### 0. Apuntar tu dominio al VPS

En hPanel → Dominios → DNS, creá/editá el registro **A** de `tudominio.com` (y `www`) apuntando a la **IP del VPS** (la ves en hPanel → VPS). La propagación tarda de minutos a unas horas.

### 1. Instalar Node y subir los archivos

```bash
# en el VPS
sudo apt update && sudo apt install -y nodejs nginx

# desde tu máquina, subir la carpeta
scp -r conways-conquerors-web usuario@TU_IP:/opt/conways
```

### 2. Dejarlo corriendo siempre (systemd)

```bash
sudo cp /opt/conways/conways.service /etc/systemd/system/
sudo systemctl enable --now conways
sudo systemctl status conways   # debería decir "active (running)"
```

(Alternativa si preferís pm2: `npm i -g pm2 && pm2 start server.js --name conways && pm2 save`)

### 3. Nginx adelante (puerto 80/443 + WebSocket)

```bash
sudo cp /opt/conways/nginx.conf.example /etc/nginx/sites-available/conways
# editá el archivo y poné tu dominio en server_name
sudo ln -s /etc/nginx/sites-available/conways /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 4. HTTPS gratis (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tudominio.com
```

Listo: `https://tudominio.com` muestra la landing, `https://tudominio.com/play/` el juego, y el multijugador online funciona para cualquiera en internet (el cliente usa `wss://` automáticamente con HTTPS). Para jugar online: un jugador elige *Host online game*, comparte el código de sala, y el otro entra con *Join online game* desde cualquier lugar.

> Firewall: si activaste un firewall en el VPS, dejá abiertos los puertos 80 y 443 (`sudo ufw allow 80,443/tcp`). El puerto 3000 NO hace falta abrirlo al exterior — nginx hace de intermediario.

---

## Opción B — PaaS con capa gratuita (cero administración)

Render, Railway o Fly.io detectan el `package.json` y ejecutan `npm start` solos. Soportan WebSocket, así que **el multijugador funciona**. Pasos típicos (Render):

1. Subí la carpeta a un repositorio de GitHub.
2. En Render: New → Web Service → conectá el repo.
3. Build command: *(vacío)* · Start command: `node server.js`.
4. Render te da una URL `https://...onrender.com` ya con HTTPS.

> Nota: en los planes gratuitos el servidor "se duerme" tras inactividad; la primera visita tarda unos segundos.

## Opción C — Hosting compartido de Hostinger / estático (Netlify, GitHub Pages…)

Para el `public_html` del hosting compartido usá el paquete **`hostinger-public_html.zip`**: es la misma landing y el mismo juego, pero con los modos online ocultos automáticamente del menú, porque el hosting compartido no puede ejecutar Node.js. Funcionan la landing, el Local 1v1 y el vs CPU. Instrucciones dentro del propio zip (LEEME-HOSTINGER.txt).

---

## Notas

- Puerto personalizado: `PORT=8080 node server.js`.
- El servidor valida todos los movimientos: la lógica autoritativa vive en `server.js`.
- No hay base de datos ni estado persistente: reiniciar el servicio solo corta las partidas en curso.
