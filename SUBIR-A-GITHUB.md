# Cómo subir esto a GitHub

El repositorio ya está armado y con un commit inicial hecho. Solo tenés que
crear el repo vacío en GitHub y conectar este código. Tenés dos caminos.

---

## Antes de empezar

En `package.json` y `README.md` hay un placeholder `YOUR_USERNAME`. Reemplazalo
por tu usuario u organización de GitHub (por ejemplo `terriblecrow`) antes o
después de subir — es cosmético, no afecta el funcionamiento.

---

## Camino A — con la línea de comandos (recomendado)

Este ZIP incluye la carpeta `.git` con el commit inicial ya hecho. Si lo
descomprimís y tenés git instalado:

1. **Creá un repositorio vacío en GitHub.**
   Andá a https://github.com/new
   - Repository name: `conways-conquerors` (o el que prefieras)
   - Public o Private, como quieras
   - **NO** marques "Add a README", "Add .gitignore" ni "Choose a license"
     (ya vienen en el repo; si los agregás, vas a tener conflictos)
   - Create repository

2. **Conectá y subí.** GitHub te va a mostrar una URL como
   `https://github.com/TU_USUARIO/conways-conquerors.git`. En una terminal,
   dentro de la carpeta descomprimida:

   ```bash
   git remote add origin https://github.com/TU_USUARIO/conways-conquerors.git
   git branch -M main
   git push -u origin main
   ```

   Te va a pedir usuario y un token de acceso personal (no la contraseña). Si no
   tenés uno: GitHub → Settings → Developer settings → Personal access tokens →
   Tokens (classic) → Generate new token, con permiso `repo`.

Listo. El código, el historial y toda la documentación quedan publicados.

---

## Camino B — sin línea de comandos (subir por la web)

Si preferís no usar git en tu máquina:

1. Creá el repositorio vacío en GitHub como en el paso 1 de arriba, pero esta
   vez **sí** podés dejarlo completamente vacío (sin README).

2. En la página del repo recién creado, hacé clic en **"uploading an existing
   file"** (el link aparece en la pantalla inicial del repo vacío).

3. Descomprimí este ZIP en tu computadora y **arrastrá todos los archivos y
   carpetas** (menos la carpeta `.git`, que la web no necesita) a la ventana de
   subida de GitHub. Importante: arrastrá el *contenido*, no la carpeta
   contenedora, para que `server.js` quede en la raíz del repo.

4. Escribí un mensaje de commit (por ejemplo "Initial commit") y confirmá.

Con este camino no se conserva el historial de git, pero el código queda igual
de publicado y funcional.

---

## Después de subir

- **GitHub Pages no sirve para este proyecto.** El juego necesita el servidor
  Node (`server.js`) para el multiplayer, y Pages solo sirve archivos estáticos.
  El hosting sigue siendo el actual (Hostinger). GitHub es para el código y el
  historial, no para correr el juego.
- Si querés que la gente vea el juego desde el repo, el README ya tiene los
  links a terriblecrow.com arriba de todo.
- Considerá agregar "topics" al repo (game, conway, game-of-life, javascript,
  websocket) desde la página del repo, para que sea más descubrible.

---

## Qué NO se sube (y está bien que así sea)

El `.gitignore` excluye a propósito: la carpeta `data/` o `cc-data/` del
leaderboard (son datos de jugadores en tiempo de ejecución, no código),
cualquier archivo `.env` con secretos, logs y archivos del sistema. El webhook de
Discord y cualquier otra credencial viven como variables de entorno en el host,
nunca en el repositorio.
