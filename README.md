# FX Premiere

Paleta de búsqueda para Adobe Premiere Pro con la filosofía de FX Console: invocas con un
atajo, escribes, presionas Enter y el efecto, la transición o el preset se aplica a **todos
los clips seleccionados**. Funciona en macOS y Windows.

```
Ctrl + Space  →  gsblr  →  Enter  →  Gaussian Blur en los 8 clips seleccionados
```

## Qué incluye

- **Búsqueda difusa instantánea** sobre efectos de video, efectos de audio, transiciones de
  video, transiciones de audio, tus presets y los plug-ins de terceros instalados.
  `gsblr` encuentra `Gaussian Blur`, `dtw` encuentra `Dip to White`.
- **Aplica a toda la selección** en un solo Enter, en cualquier pista de video o audio. Si
  seleccionaste video con su audio vinculado, el efecto entra en los clips que corresponden y
  los demás quedan intactos: la paleta se cierra igual y solo se queda abierta si algo falló
  de verdad.
- **Diálogo de transición**: al elegir una transición pide la duración exacta en frames
  (muestra el equivalente en segundos), la alineación respecto al corte y si va al inicio,
  al final o a ambos extremos. Recuerda lo último que usaste. Opción de añadir además el
  crossfade de audio a los clips de audio seleccionados.
- **Presets personalizados**: lee tus `.prfpset` (los del perfil de Premiere se detectan
  solos) incluyendo presets con varios efectos, keyframes y colores.
- **Motion y opacidad por texto**: escribe `scale 50`, `opacity 30`, `pos 960 540`,
  `rot 45`, `anchor 100 200`. Acepta valores relativos (`scale +10`) y porcentajes
  (`pos 50% 50%`), sin abrir Controles de efectos.
- **Comandos de edición**: Scale to Frame Size, Reset Motion & Opacity, Toggle Clip Enable.
- **Lista de recientes y favoritos**: al abrir la paleta, sin escribir nada, ves lo último que
  aplicaste con el primer elemento ya seleccionado. Enter lo repite. Nada más se dibuja hasta
  que escribes, que es lo que hace que abra rápido.
- **Crear un preset a partir de un clip**: `Cmd/Ctrl + I`, o buscando *Create Preset from Clip*,
  lista lo que el clip seleccionado tiene puesto (con cuántos parámetros y cuántos tienen
  keyframes), le pones nombre y queda como preset propio, buscable al instante y reaplicable con
  los mismos valores y keyframes. Puedes incluir o excluir Motion y Opacidad.
- Los comandos propios de la paleta se encuentran por varios nombres, en inglés y en español:
  *guardar preset*, *deshacer*, *ajustes* llegan al mismo sitio que sus nombres en inglés.
- **Favoritos con clic derecho**: el menú de cualquier fila permite marcarla o desmarcarla, y los
  favoritos se listan siempre debajo de los recientes. En los ajustes eliges cuántos de cada uno
  quieres ver, incluido ninguno.
- **Interfaz desnuda a propósito**: el campo y la lista, nada más. La fila seleccionada se marca
  con una barra celeste, sin rellenos, y la línea de abajo solo aparece cuando tiene algo que
  decir: los atajos y a cuántos clips va Enter mientras no escribes, o cómo salió lo último que
  aplicaste. Mientras escribes, desaparece. Cada atajo de esa línea es además un botón: hace lo
  mismo que su tecla.
- **La ventana se ajusta a lo que muestra**: la paleta le pide a Premiere la altura de su propia
  lista, así que no queda una caja medio vacía debajo de la barra de título. El ancho lo eliges en
  los ajustes (380, 440 o 520) porque es lo único que no se deduce del contenido.
- **Deshacer** desde la paleta con `Cmd/Ctrl + Z`.
- **Favoritos, recientes y ranking por uso**: lo que más usas sube solo.
- **Atajo configurable** desde los ajustes del panel (por defecto `Ctrl + Space`).
- **Actualización desde el propio panel**: los ajustes traen la sección *Updates* con la versión
  instalada y un botón que consulta los releases de GitHub, baja el `.zxp` y lo instala encima
  de la extensión. Cuando hay versión nueva la línea de abajo lo dice al abrir la paleta.

## Instalación

### Opción rápida

| Sistema | Instalador |
| --- | --- |
| macOS | `FX-Premiere-<versión>.pkg` (doble clic) |
| Windows | `FX-Premiere-<versión>-setup.exe` (doble clic) |
| Ambos | `FX-Premiere-<versión>.zxp` con cualquier instalador de ZXP |

Los tres artefactos se generan en `release/` y también los publica CI en cada tag.

Después de instalar: **reinicia Premiere Pro**. La extensión invisible arranca con Premiere
y toma posesión del atajo global. También puedes abrir el panel desde
`Ventana > Extensiones > FX Premiere`.

Como los binarios no están firmados con un certificado comercial, la primera vez macOS pide
clic derecho > Abrir en el `.pkg`, y Windows muestra el aviso de SmartScreen ("Más
información > Ejecutar de todas formas"). El `.zxp` no tiene ese aviso.

### Generar los instaladores tú mismo

```bash
npm install
npm run build          # bundle en dist/ + compila el helper nativo del sistema actual
npm run package:zxp    # release/FX-Premiere-<versión>.zxp (descarga ZXPSignCmd la primera vez)
npm run package:pkg    # release/FX-Premiere-<versión>.pkg (solo macOS)
# solo Windows; la versión se pasa a mano porque el .iss no la adivina
iscc /DAppVersion=$(node -p "require('./package.json').version") scripts\installer-win.iss
```

## Atajos dentro de la paleta

| Tecla | Acción |
| --- | --- |
| `Ctrl + Space` | abrir la paleta, y cerrarla si ya está abierta (configurable) |
| escribir | filtrar |
| `↑` `↓` `PgUp` `PgDn` | navegar |
| `Enter` | aplicar a la selección |
| `Shift + Enter` | invertir el diálogo de transición (mostrarlo u omitirlo) |
| `Cmd/Ctrl + Enter` | aplicar sin cerrar la paleta |
| `Tab` / `Shift + Tab` | cambiar de ámbito (Todo, Efectos, Transiciones, Presets, Comandos, Favoritos) |
| `Cmd/Ctrl + D` | marcar o desmarcar favorito (también con clic derecho en la fila) |
| `Cmd/Ctrl + I` | crear un preset con lo que tenga el clip seleccionado |
| `Cmd/Ctrl + Z` | deshacer el último cambio |
| `Cmd/Ctrl + R` | reindexar efectos |
| `Cmd/Ctrl + ,` | ajustes |
| `Esc` | cerrar (o volver atrás desde un diálogo) |

En el diálogo de transición `↑` `↓` cambian la duración de frame en frame (`Shift` de cinco
en cinco) y `Enter` aplica.

## Cambiar el atajo

Ajustes (`Cmd/Ctrl + ,`, o escribiendo «settings») > *Open the palette* > presiona la combinación que
quieras. Se aplica al instante, sin reiniciar Premiere.

Dos advertencias sobre `Ctrl + Space`:

- En macOS puede estar tomado por *Seleccionar la fuente de entrada anterior* si tienes
  varios idiomas de teclado. Desactívalo en Ajustes del sistema > Teclado > Atajos, o elige
  otra combinación.
- En Windows puede chocar con el cambio de IME en teclados asiáticos.

Si otra aplicación ya reservó la combinación, los ajustes lo informan en el estado del
listener.

## Actualizar

Ajustes (`Cmd/Ctrl + ,`) > sección *Updates*. Al abrir los ajustes consulta el
último release de GitHub:

- Si estás al día lo dice y no hace nada más.
- Si hay una versión nueva el botón pasa a *Update to X*: baja el `.zxp` del release, lo
  descomprime encima de la extensión instalada y recarga el panel. La línea inferior de la paleta
  menciona la versión nueva junto a `Cmd/Ctrl + ,`, para que lo veas sin abrir los ajustes. La recarga solo afecta al
  panel: el listener en segundo plano sigue con la versión anterior hasta que reinicies Premiere.
- Si no hay red, muestra el motivo en vez de fingir que estás actualizado.

En una instalación de desarrollo (la carpeta CEP es un symlink a `dist/`) el botón se desactiva
a propósito para no pisarte el repo: ahí actualizas con `npm run install-dev`.

## Cómo funciona

```
Helper nativo (Swift en macOS / C++ en Windows)
  registra el atajo solo mientras Premiere está al frente
        │ stdout: TRIGGER
        ▼
Extensión invisible (arranca con Premiere)
        │ requestOpenExtension
        ▼
Panel (paleta estilo FX Console)
        │ evalScript con JSON
        ▼
Host ExtendScript  →  QE DOM + API oficial  →  clips seleccionados
```

Premiere no permite asignar atajos de teclado a paneles de extensión, así que el atajo vive
en un proceso nativo diminuto. Ese proceso registra la combinación **solo cuando Premiere es
la aplicación activa**, de modo que la tecla sigue disponible en el resto del sistema, y se
cierra solo cuando Premiere se cierra.

### Estructura

```
CSXS/manifest.xml      dos extensiones: panel visible + servicio invisible
panel/                 UI de la paleta (TypeScript + CSS)
service/               extensión invisible que gobierna el helper
shared/                tipos, puente CEP, atajos, ajustes, búsqueda difusa
host/                  ExtendScript (ES3) que habla con Premiere
helper/mac/            Hotkey.swift  (RegisterEventHotKey, sin permisos de accesibilidad)
helper/win/            hotkey.cpp    (RegisterHotKey + ventana en primer plano)
scripts/               build, instalación de desarrollo, firma, instaladores, pruebas
```

## Desarrollo

```bash
npm install
npm run install-dev    # compila, activa PlayerDebugMode y enlaza dist/ en la carpeta CEP
npm run watch          # reconstruye panel y servicio al guardar
npm run typecheck
npm test               # búsqueda, presets, host y panel completo, sin abrir Premiere
```

Tras `install-dev` reinicia Premiere. El panel queda depurable en
<http://localhost:8188> y el servicio en <http://localhost:8189>.

Los logs de la extensión invisible y del helper se escriben en:

- macOS: `~/Library/Application Support/FX Premiere/fx-premiere.log`
- Windows: `%APPDATA%\FX Premiere\fx-premiere.log`

Los ajustes (atajo, favoritos, uso, carpetas de presets) viven junto al log en
`settings.json`, y los presets que captures de un clip en `captured/*.fxpreset.json`.

### Pruebas

`npm test` no necesita Premiere abierto:

- `scripts/test-search.mjs` valida el ranking difuso (incluye casos como `gsblr` →
  `Gaussian Blur`) y el parser de comandos de motion.
- `scripts/test-host.mjs` corre el host ExtendScript contra un Premiere simulado
  (`scripts/lib/mock-premiere.mjs`: secuencia, pistas, clips, componentes y QE DOM) y verifica
  que los efectos lleguen a cada clip seleccionado, los timecodes de las transiciones, los
  comandos de motion y la reproducción de presets con keyframes.
- `scripts/test-panel.mjs` arranca el panel real dentro de jsdom conectado a ese mismo host
  simulado, así que el flujo completo de teclado (invocar, escribir, ↑/↓, Enter, diálogo de
  transición, ajustes, grabar atajo) se prueba de punta a punta.
- `scripts/test-updater.mjs` levanta un servidor de releases local con un `.zxp` real y verifica
  la comparación de versiones, la descarga con redirecciones, el reemplazo en sitio y que se
  niegue a pisar una instalación de desarrollo o un paquete incompleto.
- `scripts/test-service.mjs` corre la extensión invisible contra un helper de hotkey falso que
  habla el mismo protocolo: comprueba el arranque, que una pulsación abra el panel, el cambio
  de atajo en caliente sin reiniciar el proceso, el reinicio tras una caída y que no quede
  ningún proceso vivo al cerrar Premiere. El helper falso puede tardar en confirmar o no
  confirmar nunca, porque el servicio solo debe reportar el atajo como activo cuando el helper
  lo confirmó de verdad.

Dos herramientas que no son pruebas y por eso no están en `npm test`:

- `npm run inspect:presets` pasa tus `.prfpset` reales por el parser del host y te dice qué
  entendió de cada uno. Útil cuando un preset tuyo no se aplica como esperabas.
- `node scripts/bench-panel.mjs` mide lo que cuesta el primer pintado, invocar la paleta y cada
  tecla. En jsdom (más lento que Premiere) el primer pintado va sobre 9 ms, invocarla sobre
  8 ms y una consulta amplia 16 ms dibujando como máximo 50 filas, sin importar el tamaño del
  índice.
- `node scripts/snapshot-ui.mjs` escribe un HTML con el panel real en sus tres estados (en
  reposo, escribiendo y el inspector de efectos) y la hoja de estilos de verdad, para revisar el
  diseño en un navegador sin instalar nada en Premiere.

## Límites conocidos

- El QE DOM que Premiere usa para aplicar efectos y transiciones no está documentado por
  Adobe. Es el mismo camino que usan las extensiones comerciales del sector, pero una
  actualización mayor de Premiere puede requerir ajustes.
- Premiere no expone agrupación de deshacer a los scripts: aplicar a diez clips genera diez
  pasos en el historial. `Cmd/Ctrl + Z` en la paleta deshace un paso usando el QE DOM; si tu
  versión de Premiere no lo expone, la paleta lo dice y deshaces desde la línea de tiempo.
- Los presets se aplican reconstruyendo cada efecto y sus parámetros: ni ExtendScript ni la nueva
  API UXP saben cargar un `.prfpset`, y los presets propios de Premiere ni siquiera aparecen en la
  lista que expone el script. Lo que sí evitamos es que se note: cada parámetro se escribe pidiendo
  que Premiere *no* redibuje, y se redibuja una sola vez al final, así que el efecto aparece ya
  configurado en lugar de entrar con sus valores por defecto y acomodarse a la vista. Sigue siendo
  un paso de historial por parámetro; la agrupación en un solo deshacer solo existe en UXP.
  Valores y keyframes se replican; la curva de interpolación se
  aproxima a lineal, hold o bezier, y algunos parámetros muy particulares (por ejemplo
  curvas de Lumetri) pueden quedar en su valor por defecto. Si un parámetro del preset no
  existe con ese nombre en tu versión del efecto, se salta y se te informa, en vez de escribirlo
  en el parámetro que estuviera en esa posición.
- Los presets capturados de un clip guardan el valor de cada parámetro tal como estaba en ese
  momento. Si el clip tenía dos veces el mismo efecto, el preset también.
- El atajo global necesita el helper nativo. Si falta o el sistema lo bloquea, la paleta
  sigue abriéndose desde `Ventana > Extensiones`.
- La barra de título es de Premiere. CEP no permite ventanas sin marco: el host dibuja el contorno
  de toda extensión visible, y UXP tampoco lo cambia. Lo único que está en nuestra mano es que la
  ventana mida lo que mide el contenido, que es lo que hace la paleta.
- La paleta tampoco puede elegir *dónde* aparece. CEP expone el título y el tamaño de la ventana, y
  nada más: no hay forma de posicionarla, así que abrirla junto al mouse tendría que hacerla mover
  el helper nativo desde fuera, y en macOS eso pide permiso de Accesibilidad al sistema.
- Adobe declaró CEP superado por UXP a partir de Premiere 25.6 y planea retirarlo. FX Premiere es
  CEP, así que funciona hoy en todas las versiones soportadas, pero el puerto a UXP es la tarea
  pendiente grande. A cambio traería transacciones reales: un solo paso de deshacer por preset.
