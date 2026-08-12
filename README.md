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
- **Aplica a toda la selección** en un solo Enter, en cualquier pista de video o audio.
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
- **Favoritos, recientes y ranking por uso**: lo que más usas sube solo.
- **Atajo configurable** desde los ajustes del panel (por defecto `Ctrl + Space`).

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
npm run package:zxp    # release/FX-Premiere-1.0.0.zxp (descarga ZXPSignCmd la primera vez)
npm run package:pkg    # release/FX-Premiere-1.0.0.pkg (solo macOS)
iscc scripts/installer-win.iss   # release/FX-Premiere-1.0.0-setup.exe (solo Windows)
```

## Atajos dentro de la paleta

| Tecla | Acción |
| --- | --- |
| `Ctrl + Space` | abrir la paleta (configurable) |
| escribir | filtrar |
| `↑` `↓` `PgUp` `PgDn` | navegar |
| `Enter` | aplicar a la selección |
| `Shift + Enter` | invertir el diálogo de transición (mostrarlo u omitirlo) |
| `Cmd/Ctrl + Enter` | aplicar sin cerrar la paleta |
| `Tab` / `Shift + Tab` | cambiar de ámbito (Todo, Efectos, Transiciones, Presets, Comandos, Favoritos) |
| `Cmd/Ctrl + D` | marcar o desmarcar favorito |
| `Cmd/Ctrl + R` | reindexar efectos |
| `Cmd/Ctrl + ,` | ajustes |
| `Esc` | cerrar (o volver atrás desde un diálogo) |

En el diálogo de transición `↑` `↓` cambian la duración de frame en frame (`Shift` de cinco
en cinco) y `Enter` aplica.

## Cambiar el atajo

Ajustes (`Cmd/Ctrl + ,` o el engranaje) > *Open the palette* > presiona la combinación que
quieras. Se aplica al instante, sin reiniciar Premiere.

Dos advertencias sobre `Ctrl + Space`:

- En macOS puede estar tomado por *Seleccionar la fuente de entrada anterior* si tienes
  varios idiomas de teclado. Desactívalo en Ajustes del sistema > Teclado > Atajos, o elige
  otra combinación.
- En Windows puede chocar con el cambio de IME en teclados asiáticos.

Si otra aplicación ya reservó la combinación, los ajustes lo informan en el estado del
listener.

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
npm test               # ranking de búsqueda + parser de presets contra tus .prfpset reales
```

Tras `install-dev` reinicia Premiere. El panel queda depurable en
<http://localhost:8188> y el servicio en <http://localhost:8189>.

Los logs de la extensión invisible y del helper se escriben en:

- macOS: `~/Library/Application Support/FX Premiere/fx-premiere.log`
- Windows: `%APPDATA%\FX Premiere\fx-premiere.log`

Los ajustes (atajo, favoritos, uso, carpetas de presets) viven junto al log en
`settings.json`.

### Pruebas

`npm test` no necesita Premiere abierto:

- `scripts/test-search.mjs` valida el ranking difuso (incluye casos como `gsblr` →
  `Gaussian Blur`) y el parser de comandos de motion.
- `scripts/test-preset-parser.mjs` ejecuta el parser de `.prfpset` real bajo Node con
  `File`/`Folder` simulados y recorre todos los presets que tengas instalados.

## Límites conocidos

- El QE DOM que Premiere usa para aplicar efectos y transiciones no está documentado por
  Adobe. Es el mismo camino que usan las extensiones comerciales del sector, pero una
  actualización mayor de Premiere puede requerir ajustes.
- Premiere no expone agrupación de deshacer a los scripts: aplicar a diez clips genera diez
  pasos en el historial.
- Los presets se aplican reconstruyendo cada efecto y sus parámetros (no existe API para
  cargar un `.prfpset`). Valores y keyframes se replican; la curva de interpolación se
  aproxima a lineal, hold o bezier, y algunos parámetros muy particulares (por ejemplo
  curvas de Lumetri) pueden quedar en su valor por defecto.
- El atajo global necesita el helper nativo. Si falta o el sistema lo bloquea, la paleta
  sigue abriéndose desde `Ventana > Extensiones`.
