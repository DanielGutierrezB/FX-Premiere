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
- **Desanidar (*Un-nest*)**: busca «desanidar» o «un-nest» y los nests seleccionados se abren en la
  línea de tiempo. Al invocarlo pregunta una sola cosa —video, audio o ambos— con las flechas o
  `1`..`3`, y `Enter` lo hace; recuerda lo último que elegiste. Antes de pulsar `Enter` te dice qué
  hay dentro: cuántos clips, y si hay títulos, transiciones, multicámara o cambios de velocidad. Es
  un aviso, no un obstáculo. Los clips salen **apilados sobre lo que ya hay**, en pistas consecutivas
  y sin dejar pistas vacías en medio; si no caben, añade las pistas que falten en vez de rendirse, y
  **solo del tipo que estás sacando**: al terminar devuelve las pistas que añadió y no está usando,
  incluidas las que Premiere agrega por su cuenta al colocar un clip con sonido, así que sacar solo
  video no te deja pistas de audio vacías (y si esta versión de Premiere no deja quitarlas, lo dice en
  vez de dejártelas encontrar). Respeta el
  recorte del nest: sale exactamente lo que estaba en la línea de tiempo, ni un frame más. El nest
  original queda **desactivado** (no borrado) para que su audio no suene por debajo de lo que acaba
  de salir; en los ajustes puedes cambiarlo a dejarlo como está o borrarlo. Los efectos y sus
  keyframes salen con cada clip, y el clip que estaba desactivado dentro sale desactivado. Lo hace
  **solo con la API de Premiere**: no pulsa teclas, no pide permisos del sistema y no depende de qué
  panel tiene el foco (ver [Cómo funciona desanidar](#cómo-funciona-desanidar)). Lo que una
  reconstrucción no puede llevar lo dice por su nombre y deja el nest como estaba: las transiciones
  de dentro y los clips multicámara, porque no hay API que diga qué ángulo se estaba viendo.
  Opcionalmente entra en los nests que había dentro del nest, con un límite de profundidad.
- **Suavizar keyframes (*Ease*)**: busca «ease», «suavizar» o «curvas» y las animaciones de los clips
  seleccionados dejan de ser rectas. Al invocarlo pide una sola cosa, la cantidad, con dos números al
  estilo de After Effects —por defecto **33 Out / 100 In**—: las flechas los cambian de uno en uno
  (con `Shift`, de diez en diez), `Tab` o `←→` pasan de un campo al otro y `Enter` lo aplica. Al lado
  hay dos botones: *Save as default* deja la pareja que tengas en pantalla como la que se abrirá la
  próxima vez, y *Restore previous* vuelve a la que había antes de ese guardado. Trabaja sobre una
  **lista cerrada de propiedades continuas** —Posición, Escala, Escala horizontal, Rotación, Opacidad
  y Punto de ancla, las de dos ejes incluidas—; cualquier otra propiedad con keyframes se deja
  intacta, se cuenta y el mensaje dice cuáles fueron. Volver a ejecutarlo **no encima la curva sobre
  la curva**: reconoce los keyframes que puso el pase anterior, los reduce a los extremos que pusiste
  tú y vuelve a dibujar desde ahí, así que cambiar la cantidad y repetir hace lo que esperas. Lo que
  no reconozca como relleno suyo —una animación que hiciste tú a mano con un keyframe por frame— se
  queda como está y te lo dice, en vez de reescribirla.
- **Mover el punto de ancla (*Move Anchor*)**: busca «anchor», «ancla» o «pivote» y sale una
  cuadrícula de 3x3 con las nueve posiciones; `1`..`9` o las flechas eligen, `Enter` lo hace, y todas
  se pueden pulsar con el mouse. **La imagen no se mueve**: la posición se corrige por la misma
  distancia que el ancla, teniendo en cuenta la escala y la rotación que el clip ya tenga, y si la
  posición está animada se corrigen **todos** sus keyframes, uno por uno, para que la animación
  quede idéntica; si alguno no se puede corregir, se deshacen los que sí y el ancla no se toca,
  porque un ancla mal puesta se arregla en un clic y una animación a medias no. Dos interruptores
  debajo: si el ancla que se mueve es la de *Motion* o la del
  efecto *Transform*, y si las esquinas se miden sobre el **frame** completo o sobre el **alpha**, es
  decir sobre lo que de verdad está dibujado —lo segundo es lo que hace que la esquina de un logo PNG
  caiga en el logo y no en el aire de su alrededor—. Recuerda lo último que elegiste.
- **Pegar el portapapeles (*Paste Clipboard*)**: busca «paste», «pegar» o «portapapeles» y lo que
  tengas copiado —una captura, un logo de Figma, una capa de Photoshop— entra en la secuencia como
  **PNG sin pérdida y con su transparencia**. El diálogo te enseña antes de nada de dónde salió la
  imagen, cuánto mide, si trae alpha y **en qué archivo va a quedar**; las flechas cambian la
  duración (con `Shift`, de cinco en cinco segundos) y `Enter` lo hace. El PNG se guarda en una
  carpeta junto al proyecto que **se crea sola la primera vez** y nunca más, acepta los mismos
  comodines que Compass en la ruta y en el nombre, y **jamás pisa un pegado anterior**: si el nombre
  ya existe le añade `-2`, `-3`. En la línea de tiempo cae en el cabezal, en la pista de más arriba
  que tenga ese hueco libre, y si no hay ninguna **añade una**: nada de lo que ya estaba se
  sobrescribe, y si Premiere acaba rechazando el pegado el PNG **se borra** en vez de quedarse suelto
  en tu carpeta de medios. El archivo queda además importado en su propio bin. La duración por defecto es la que
  Premiere use para imágenes fijas si se puede leer de sus preferencias; si no, la de los ajustes.
- **Compass: rutas de exportación automáticas**: busca «compass» o «rutas de exportación» y sale el
  panel con los dos caminos que Premiere recuerda —el de **Exportar medios** y el de **Exportar
  fotograma**—. Cada uno acepta una ruta absoluta o una **relativa al proyecto** (a la carpeta de la
  Production cuando el proyecto pertenece a una), y admite los comodines
  `#PROD #PRJ #SEQ #BIN #YYYY #YY #MM #DD #hh #mm`, que se insertan **donde tengas el cursor** con
  un clic. Lo que un comodín devuelve es siempre **una sola carpeta**: una secuencia llamada
  `01/02 - rough` produce `01-02 - rough` y no dos niveles, y una barra o unos puntos suspensivos en
  un nombre no pueden sacar la exportación de la carpeta que elegiste. Si un comodín que usas no tiene
  valor —pides `#SEQ` sin secuencia abierta— la ruta se rechaza con un mensaje en vez de quedarse
  coja. Debajo hay una vista previa en vivo de la ruta que producen, así que ves lo que vas a
  obtener antes de guardar. Las carpetas que falten se crean. Puedes fijar una ruta distinta **solo
  para el proyecto abierto** sin tocar la general, y la extensión invisible recalcula y reescribe la
  ruta sola cada vez que cambias de secuencia o de proyecto, con la paleta cerrada. Si tu versión de
  Premiere no acepta que un script le escriba esas preferencias, la paleta **lo dice** en vez de
  fingir que funcionó y te deja el camino que sí funciona siempre: *Export via Compass*, que encola
  la secuencia en Media Encoder ya apuntando a la ruta resuelta (ver
  [Qué diálogos de exportación puede mover Compass](#qué-diálogos-de-exportación-puede-mover-compass)).
- **Comandos de edición**: Scale to Frame Size, Reset Motion & Opacity, Toggle Clip Enable.
- **Lista de recientes**: al abrir la paleta, sin escribir nada, ves lo último que aplicaste con el
  primer elemento ya seleccionado. Enter lo repite. Nada más se dibuja hasta que escribes, que es lo
  que hace que abra rápido.
- **Barra de favoritos numerada**: encima de la lista hay una barra de ranuras con número. Con el
  buscador vacío, `1`..`9` aplica lo que tenga esa ranura, así que `Ctrl + Space` y `1` es todo lo
  que hace falta. Puedes tener varias filas, cada una con su combinación (`Ctrl + Shift + 1` llega a
  la primera ranura de la segunda fila), y mientras sostienes esas teclas la fila correspondiente se
  ilumina para que veas dónde va a caer el número. Con algo escrito los dígitos se escriben normal:
  *Blur 1* y *Lumetri 2* se buscan como cualquier otra cosa.
- **Crear un preset a partir de un clip**: `Cmd/Ctrl + I`, o buscando *Create Preset from Clip*,
  lista lo que el clip seleccionado tiene puesto (con cuántos parámetros y cuántos tienen
  keyframes), le pones nombre y queda como preset propio, buscable al instante y reaplicable con
  los mismos valores y keyframes. Puedes incluir o excluir Motion y Opacidad.
- Los comandos propios de la paleta se encuentran por varios nombres, en inglés y en español:
  *guardar preset*, *deshacer*, *ajustes* llegan al mismo sitio que sus nombres en inglés.
- **Asignar una ranura**: con el elemento seleccionado, `Cmd/Ctrl + D` y después el número que
  quieras (con los modificadores de la fila si es otra fila). Pulsar la ranura que ya lo tiene lo
  quita, y `Esc` sale sin asignar nada. El clic derecho de cualquier fila hace lo mismo, y si el
  elemento ya está en la barra ofrece quitarlo de una vez. En los ajustes eliges cuántas ranuras
  tiene cada fila, añades o quitas filas y grabas la combinación de cada una.
- **Interfaz desnuda a propósito**: el campo y la lista, nada más. La fila seleccionada se marca
  con una barra celeste, sin rellenos, y la línea de abajo solo aparece cuando tiene algo que
  decir: los atajos y a cuántos clips va Enter mientras no escribes, o cómo salió lo último que
  aplicaste. Mientras escribes, desaparece. Cada atajo de esa línea es además un botón: hace lo
  mismo que su tecla.
- **La ventana abre del tamaño en el que se queda**: la altura se calcula con los números de
  `panel/css/` (campo, pie, fila, título de grupo) en vez de medir el DOM, así que se pide antes del
  primer pintado y no hay ese salto de abrir grande y encogerse. Escribir tampoco la mueve: la lista
  hace scroll dentro de la misma caja, porque una ventana que cambia de tamaño con cada tecla es
  imposible de apuntar. El ancho sale de las ranuras de la barra (o lo eliges en los ajustes), y
  cuántos recientes y cuántas filas de favoritos quieres ver deciden la altura. **Y si prefieres otro tamaño, arrastra la ventana**: eso
  manda sobre todo lo anterior y se recuerda; en los ajustes aparece un botón para devolverle la
  altura a la lista.
- **La paleta se queda cargada**: al cerrarla, Premiere la esconde en lugar de descargarla, así que
  la segunda invocación y todas las siguientes reactivan una página que ya está viva, sin volver a
  arrancar Chromium, Node y una ventana. Eso dura lo que dura la sesión de Premiere, así que **la
  primera invocación después de cada arranque sigue siendo en frío**: no hay manera de evitarlo. En
  los ajustes, *Keep the palette loaded* lo desactiva si prefieres recuperar la memoria de un panel
  cargado a cambio de que cada apertura vuelva a empezar de cero.
- **Y la apertura en frío también está cuidada**, porque es la que pagas cada vez que abres
  Premiere: el índice de efectos queda guardado y los presets se sellan, así que Premiere responde
  «no ha cambiado nada» sin abrir un solo archivo en vez de volver a parsear el XML de tu perfil
  (que con presets acumulados pesa megas). Al despertar pregunta lo mínimo al host, lee tus presets
  guardados por detrás del primer pintado y el CSS viaja dentro del propio HTML. Si guardas un
  preset nuevo en Premiere, el sello cambia y aparece en la siguiente apertura, sin reindexar.
- **Deshacer** desde la paleta con `Cmd/Ctrl + Z`.
- **Ranking por uso**: lo que más usas sube solo, y lo que está en la barra sube antes que nada.
- **Atajo configurable** desde los ajustes del panel (por defecto `Ctrl + Space`).
- **Actualización desde el propio panel**: los ajustes traen la sección *Updates* con la versión
  instalada y un botón que consulta los releases de GitHub, baja el `.zxp` y lo instala encima
  de la extensión. Cuando hay versión nueva la línea de abajo lo dice al abrir la paleta.

## Instalación

### Opción rápida

| Sistema | Instalador | Pasos |
| --- | --- | --- |
| macOS | `FX-Premiere-<versión>.pkg` (doble clic) | uno |
| Windows | `FX-Premiere-<versión>-setup.exe` (doble clic) | uno |
| Ambos | `FX-Premiere-<versión>.zxp` con cualquier instalador de ZXP | dos, mira abajo |

**Si puedes, usa el `.pkg` o el `.exe`.** Son los que dejan todo listo de una vez.

Los artefactos se generan en `release/` y también los publica CI en cada tag.

Después de instalar: **reinicia Premiere Pro**. La extensión invisible arranca con Premiere
y toma posesión del atajo global. También puedes abrir el panel desde
`Ventana > Extensiones > FX Premiere`.

Los dos instaladores lo hacen **por usuario**, sin pedir contraseña: en macOS dentro de
`~/Library/Application Support/Adobe/CEP/extensions/com.fxpremiere.suite` y en Windows dentro de
`%APPDATA%\Adobe\CEP\extensions\com.fxpremiere.suite`. Premiere lee esas carpetas igual que las
del sistema, y como son tuyas el panel puede actualizarse solo más adelante.

Como los binarios no están firmados con un certificado comercial, la primera vez macOS pide
clic derecho > Abrir en el `.pkg`, y Windows muestra el aviso de SmartScreen ("Más
información > Ejecutar de todas formas"). El `.zxp` no tiene ese aviso.

### El `.zxp` necesita un paso más

El `.zxp` va firmado con un certificado propio, no con uno de Adobe. Premiere no carga
extensiones firmadas así hasta que el **modo depuración de CEP** está activado, y mientras esté
apagado el panel no aparece en `Ventana > Extensiones` aunque el `.zxp` se haya instalado sin
un solo error. Es el fallo con el que se topa cualquiera que nunca haya desarrollado una
extensión de CEP.

Por eso cada release lleva `FX-Premiere-<versión>-activar-modo-depuracion.zip`. Descomprímelo y:

- macOS: doble clic en `activar-modo-depuracion-mac.command` (si macOS se queja, clic
  derecho > Abrir).
- Windows: doble clic en `activar-modo-depuracion-windows.bat`, sin administrador.

Después reinicia Premiere. Se hace una sola vez por ordenador; las actualizaciones siguientes
ya no lo necesitan. El `.pkg` y el `.exe` activan el modo depuración ellos mismos, así que por
esa vía no hay que tocar nada.

### Generar los instaladores tú mismo

```bash
npm install
npm run build          # bundle en dist/ + compila el helper nativo del sistema actual
npm run package:zxp    # release/FX-Premiere-<versión>.zxp + el zip con los activadores de tools/
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
| `1`..`9` | aplicar la ranura de la barra de favoritos (con el buscador vacío) |
| `Ctrl + Shift + 1`… | la misma ranura de otra fila, según la combinación que le pongas |
| `Cmd/Ctrl + D` y un número | poner lo seleccionado en esa ranura, o quitarlo si ya está ahí |
| `Cmd/Ctrl + I` | crear un preset con lo que tenga el clip seleccionado |
| `Cmd/Ctrl + Z` | deshacer el último cambio |
| `Cmd/Ctrl + R` | reindexar efectos |
| `Cmd/Ctrl + ,` | ajustes |
| `Esc` | cerrar (o volver atrás desde un diálogo) |

En el diálogo de transición `↑` `↓` cambian la duración de frame en frame (`Shift` de cinco
en cinco) y `Enter` aplica. En el de desanidar, `↑` `↓` y `1`..`3` eligen entre video, audio o
ambos, `Enter` desanida y `Esc` vuelve.

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

Ajustes (`Cmd/Ctrl + ,`) > sección *Updates*. **Nada consulta GitHub por su cuenta**: ni abrir la
paleta, ni abrir los ajustes. Se pregunta cuando pulsas *Check for updates*, y la fila dice de cuándo
es la última respuesta que tiene («latest as of yesterday»), para que sepas si vale creerla.

- Si estás al día lo dice y no hace nada más.
- Si hay una versión nueva el botón pasa a *Update to X*: baja el `.zxp` del release, lo
  descomprime encima de la extensión instalada y recarga el panel. La recarga solo afecta al panel:
  el listener en segundo plano sigue con la versión anterior hasta que reinicies Premiere.

A la izquierda de la línea inferior de la paleta está **la versión que tienes**, apagada, para que la
pregunta «¿estoy en la última?» se conteste sin abrir nada. Cuando una comprobación encuentra una más
nueva, esa misma versión se enciende en el color de acento, pasa a decir `1.6.0 → 1.7.0` y se puede
pulsar para ir directo a los ajustes. Ese aviso se guarda en los ajustes, así que sigue ahí en las
sesiones siguientes sin volver a preguntar: una comprobación basta hasta que actualices.
- Si no hay red, muestra el motivo en vez de fingir que estás actualizado.

En una instalación de desarrollo (la carpeta CEP es un symlink a `dist/`) el botón se desactiva
a propósito para no pisarte el repo: ahí actualizas con `npm run install-dev`.

### Si te dice que la carpeta no se puede escribir

Actualizar desde el panel consiste en descomprimir el `.zxp` nuevo encima de la carpeta desde la
que la extensión se está ejecutando, así que solo funciona si esa carpeta es tuya. Las versiones
hasta la 1.6.2 se instalaban para todo el sistema (`/Library/...` en macOS, `Common Files` en
Windows), y esas carpetas son de `root` o de administrador: ahí el botón no puede hacer nada. La fila
de *Updates* lo dice **antes**, en cuanto encuentra una versión nueva —el botón queda desactivado y
en su lugar te manda al instalador—, así que nadie se pasa una descarga entera para acabar en un
error de permisos sin explicación.

La salida es descargar el instalador de la última versión y ejecutarlo. Deja la extensión en tu
carpeta de usuario y a partir de ahí el botón del panel ya funciona.

Quita la copia vieja o Premiere listará el panel dos veces:

- Windows: desinstala FX Premiere desde Configuración > Aplicaciones **antes** de ejecutar el
  `.exe` nuevo. El instalador nuevo ya no pide permisos de administrador, así que no puede borrar
  por su cuenta lo que dejó uno que sí los pedía.
- macOS: `sudo rm -rf "/Library/Application Support/Adobe/CEP/extensions/com.fxpremiere.suite"`.

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

Y en el otro sentido, el ayudante nativo en un disparo:
Panel  →  pegar del portapapeles  →  NSPasteboard / clipboard de Win32  →  archivo en disco
```

Premiere no permite asignar atajos de teclado a paneles de extensión, así que el atajo vive
en un proceso nativo diminuto. Ese proceso registra la combinación **solo cuando Premiere es
la aplicación activa**, de modo que la tecla sigue disponible en el resto del sistema, y se
cierra solo cuando Premiere se cierra.

### Cómo funciona desanidar

Premiere **no tiene ninguna API para desanidar**. Tampoco para duplicar un `trackItem`, ni para copiar
y pegar, ni para ejecutar un comando de menú: `app.executeCommand` no existe y
`qe.executeConsoleCommand` con nombres de comando devuelve `false`. Colocar la secuencia del nest en la
línea de tiempo no la expande: la vuelve a anidar, sin importar el botón de *insertar y sobrescribir
secuencias como nests o clips individuales*, que Adobe ha confirmado que no está expuesto a los
scripts.

Quedaban dos caminos. Uno era pulsar `Cmd/Ctrl + C` y `Cmd/Ctrl + V` desde el ayudante nativo, que es
lo que hace Grave Robber; funciona, pero pide el permiso de Accesibilidad en macOS, depende de qué
panel tiene el foco y falla «a veces». El otro es el que FX Premiere usa: **reconstruirlo con la API
que sí hay**. No pulsa ninguna tecla, no pide nada al sistema operativo y no le importa dónde esté el
foco.

Reconstruir significa esto, y **nada se escribe hasta que el plan entero está hecho**:

1. Se lee la secuencia del nest por el DOM normal: cada clip que se ve en la parte que el nest está
   reproduciendo de verdad (un nest recortado empieza más adentro), con su pista, su tiempo, el trozo
   de origen que muestra, su velocidad, si estaba desactivado y **los efectos y keyframes que lleva**.
2. Lo que una reconstrucción no puede llevar se rechaza **por su nombre y antes de tocar nada**: un
   clip multicámara (no hay API que diga qué ángulo se veía), una transición (no hay API que cree una),
   un clip que Premiere no describe, o un nest retimado.
3. Se reservan las pistas que hacen falta, del tipo que pediste, sobre lo que ya hay, y se comprueba
   que estén libres justo en el hueco donde va cada clip.
4. Cada clip se coloca apuntando su elemento de proyecto al trozo de origen que mostraba y
   sobrescribiendo en la pista reservada, así que nada aterriza entero para recortarse después. La
   línea de tiempo se cuenta antes y después de cada colocación: un clip que llegó donde no se le
   mandó se ve, no se supone.
5. La mitad que nadie pidió —el sonido de un video cuando sacas solo imagen— aterriza en una pista
   aparte y se retira; si hubo que crear esa pista, se quita al terminar. Sacar solo audio no deja
   pistas de video vacías, y al contrario tampoco.
6. Encima del clip colocado se vuelven a escribir los efectos leídos en el paso 1, anclados a su punto
   de entrada para que los keyframes caigan donde estaban.
7. Se retira el nest según lo que digan los ajustes, y los clips nuevos quedan seleccionados.

Si algo falla a mitad de un nest, **se quita todo lo que ese nest había puesto** y el nest se queda
como estaba, con el motivo dicho por su nombre. Los nests que quedaban en la cola siguen: uno que no
se pudo reconstruir no cancela los demás. El único caso que detiene la corrida es que una colocación
haya sobrescrito algo tuyo, y entonces te dice qué era y que `Cmd/Ctrl + Z` lo devuelve.

**Deshacer un desanidado cuesta varias pulsaciones de `Cmd/Ctrl + Z`.** Premiere no expone agrupación
de deshacer a los scripts, así que cada clip colocado es un paso del historial. Es la misma razón por
la que aplicar un preset a diez clips deja diez pasos.

### De dónde sale la imagen que se pega

Leer el portapapeles **lo hace el ayudante nativo**, no un `osascript` ni un PowerShell: el mismo
binario que ya lleva el atajo tiene un modo de un disparo que escribe la imagen a un archivo y
reporta de qué formato la sacó. Un script externo habría sido otro proceso, otro camino por
plataforma y ninguna forma de saber si el alpha sobrevivió.

El orden en que se pregunta importa, porque no todos los formatos del portapapeles llevan
transparencia:

- **macOS**: primero `public.png`, que es lo que dejan Figma, Photoshop y Chrome, y cuyos bytes se
  copian **tal cual** —no se recomprime nada—. Si no está, `public.tiff`, y como último recurso la
  representación `NSImage`; en esos dos casos se vuelve a codificar a PNG sin pérdida.
- **Windows**: primero el formato registrado `PNG`, otra vez copiado literal. Si no está,
  `CF_DIBV5`, que es el único DIB que puede traer canal alpha, y solo entonces `CF_BITMAP`, que no
  lo trae nunca. Los dos se codifican a PNG con GDI+.

Cuando la fuente que había no llevaba transparencia —un `CF_BITMAP`, una captura plana— el pegado
se hace igual y **el diálogo lo dice antes de que pulses Enter**, en lugar de dejarte descubrir el
fondo negro en la línea de tiempo.

### Qué diálogos de exportación puede mover Compass

Aquí conviene ser exacto, porque es la parte que nadie ha documentado. Premiere **no tiene ninguna
API para fijar la ruta de exportación**. Lo único que un script puede tocar son las preferencias, con
`app.properties.setProperty`, y Adobe solo lo insinúa al advertir que «para cualquier ruta que se use
en las preferencias de Premiere Pro, el separador final es obligatorio».

Las dos claves existen y están en el archivo de preferencias de esta máquina, con estos nombres y
con rutas de carpeta por valor:

```
MZ.Prefs.Export.Media.Path        la carpeta de Exportar medios
Monitor.ExportFrame.CurrentPath   la carpeta de Exportar fotograma
```

Escribirlas es lo que hace Compass. Pero **no lo damos por hecho**: el host escribe, **vuelve a
leer** y solo entonces dice que la ruta quedó puesta. Si la lectura no devuelve lo que se escribió
—porque tu versión de Premiere ignore esa clave o la trate como de solo lectura— la paleta te lo
dice tal cual y no reclama un éxito que no tuvo.

Y hay un límite que ninguna comprobación arregla: **que la preferencia quede escrita no demuestra que
el diálogo la lea**. Escribir la preferencia es lo que puede influir en el diálogo de *Exportar
medios*, la pestaña *Exportar*, *Exportación rápida* y la cola de Media Encoder, porque los cuatro
parten de esa misma carpeta recordada, pero eso solo se confirma exportando de verdad en un Premiere
abierto. Lo que sí es seguro de punta a punta es el otro camino: **Export via Compass** resuelve los
comodines, crea las carpetas y encola la secuencia con `app.encoder.encodeSequence` **en esa ruta
exacta**, sin depender de ninguna preferencia. Si has configurado un `.epr` en el panel, lo usa; si
no, deja que Media Encoder aplique el suyo.

### Estructura

```
CSXS/manifest.xml      dos extensiones: panel visible + servicio invisible
panel/                 UI de la paleta (TypeScript; el CSS va en panel/css/, un archivo por vista)
service/               extensión invisible que gobierna el helper
shared/                tipos, puente CEP, atajos, ajustes, búsqueda difusa, portapapeles, comodines
host/                  ExtendScript (ES3) que habla con Premiere
helper/mac/            Hotkey.swift  (RegisterEventHotKey para el atajo; NSPasteboard para pegar)
helper/win/            hotkey.cpp    (RegisterHotKey + ventana en primer plano; portapapeles Win32)
scripts/               build, instalación de desarrollo, firma, instaladores, pruebas
tools/                 activadores del modo depuración de CEP, para quien instale el .zxp
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

Los ajustes (atajo, filas de favoritos, uso, carpetas de presets) viven junto al log en
`settings.json`, y los presets que captures de un clip en `captured/*.fxpreset.json`.

La paleta escribe en ese mismo log una línea `timing` por apertura: cuándo arrancó el script, cuándo
pintó, cuándo contestó el host y cuándo estuvo listo el índice. Es la única forma de ver lo que
cuesta abrir la paleta en un Premiere de verdad, y no en el navegador de las pruebas.

### Pruebas

`npm test` no necesita Premiere abierto:

- `scripts/test-search.mjs` valida el ranking difuso (incluye casos como `gsblr` →
  `Gaussian Blur`) y el parser de comandos de motion.
- `scripts/test-host.mjs` corre el host ExtendScript contra un Premiere simulado
  (`scripts/lib/mock-premiere.mjs`: secuencia, pistas, clips, componentes y QE DOM) y verifica
  que los efectos lleguen a cada clip seleccionado, los timecodes de las transiciones, los
  comandos de motion y la reproducción de presets con keyframes.
- `scripts/test-tools.mjs` corre contra ese mismo Premiere simulado las herramientas de línea de
  tiempo: dónde caben unos clips apilados, cuándo hay que hacerle sitio añadiendo pistas por QE, y
  que marcar la paleta como persistente llegue a Premiere con el id y el valor que espera. Y las dos
  herramientas de keyframes: la forma de la curva de suavizado (que 0/0 sea una recta, que los
  extremos no se muevan, que sea monótona) y el relleno que produce —un keyframe por frame, alineado
  al frame, en vectores como Posición—, la lista de propiedades que acepta y lo que hace con las que
  no, el tope de frames por tramo, el tipo de interpolación de los extremos, un clip retimado y una
  animación densa hecha a mano, incluido lo que pasa al ejecutarlo dos veces; y el ancla, con la
  corrección de posición para las nueve esquinas, con escala y rotación fijas y animadas, sobre
  Motion y sobre el efecto Transform, y con una corrección que solo se puede aplicar a medias.
- `scripts/lib/host-unnest.mjs` es el desanidado entero. La primera prueba es la que faltaba:
  **colocar la secuencia de un nest la anida**, que es la creencia falsa sobre la que estaba construida
  la primera versión. Luego, qué cuenta como nest en una selección cualquiera, que las dos mitades
  vinculadas cuenten como una, el conteo previo de lo que hay dentro, dónde caen los clips y en qué
  orden, el recorte del nest —que cada clip salga mostrando el trozo de origen que mostraba, no el
  principio—, los efectos y keyframes que viajan con cada clip, un clip retimado, video/audio/ambos
  —incluido que sacar solo audio no toque ni una pista de video y al contrario—, los nests dentro de
  nests con su límite, y las tres formas de quedarse como estaba: un multicámara dentro, un Premiere
  que no sabe poner una velocidad y uno que no sabe quitar una pista.
- `scripts/lib/host-unnest-guards.mjs` es lo que Premiere no cuenta y hay que comprobar después: una
  colocación que aterriza una pista más arriba de la que se le dijo, una que sobrescribe algo tuyo,
  una selección que cambió desde que el diálogo la contó, un Premiere que añade las pistas nuevas por
  debajo, otro al que no se le puede decir a qué pista va el sonido, y otro que no borra ni quita
  pistas. En todas, la comprobación es la misma: nada de lo tuyo se movió, y lo que ese nest hubiera
  puesto ya no está.
- `scripts/lib/panel-unnest.mjs` hace lo propio desde el panel real: que el comando se encuentre en
  los dos idiomas, el diálogo con su aviso de qué hay dentro y de qué deshace `Cmd+Z`, una vuelta
  completa comprobando que la elección llega al host y se recuerda, y un nest que el host rechaza
  (un multicámara dentro) que tiene que volver al pie de la paleta explicado.
- `scripts/test-panel.mjs` arranca el panel real dentro de jsdom conectado a ese mismo host
  simulado, así que el flujo completo de teclado (invocar, escribir, ↑/↓, Enter, diálogo de
  transición, ajustes, grabar atajo) se prueba de punta a punta. Los diálogos de 1.6.0 entran ahí:
  el de suavizado con sus dos números y los botones de guardar y restaurar el valor por defecto, y el
  de ancla con su cuadrícula, sus dos interruptores y el PNG que las pruebas se generan a sí mismas
  para comprobar que la caja del alpha sale exacta y que un archivo que no se puede leer cae al frame
  completo diciéndolo. Los de 1.6.x también: el de pegar, con un portapapeles falso que puede estar
  vacío o traer una imagen sin alpha, y el panel de Compass, donde un clic en un comodín tiene que
  insertarlo **donde estaba el cursor** y la vista previa seguirlo.
- `scripts/test-compass.mjs` prueba el motor de comodines contra **el ejemplo de la documentación de
  Compass**: la secuencia *DrakeShip* dentro de *Vikings.prproj* a las 15:30 del 20 de mayo de 2022
  tiene que producir `/Users/Dropbox/EXPORT/20220520/Vikings/DrakeShip_1530` y no otra cosa. Y
  después cada comodín uno por uno, el caso de la Production, qué pasa cuando un valor no existe
  (se avisa, no se escribe una carpeta llamada `#SEQ`), la resolución relativa al proyecto y a la
  Production, rutas de Windows y recursos UNC, la creación de carpetas incluida **una que no se
  puede crear**, la precedencia de la anulación por proyecto sobre la general, y la comprobación de
  ida y vuelta de la preferencia **en sus dos resultados**: un Premiere que la acepta y otro que se
  queda con su valor. Y que el valor de un comodín no pueda convertirse en estructura de carpetas:
  una secuencia llamada `../../Desktop` o `S01/E02` produce **una** carpeta con ese nombre saneado, y
  un comodín sin valor rechaza la ruta entera. Cierra con el respaldo del encoder, con y sin preset,
  incluido que dos exportaciones seguidas al mismo sitio no se pisen.
- `scripts/test-alpha.mjs` prueba el lector de PNG con archivos reales generados en el momento: un
  PNG de paleta con `tRNS`, uno con canal alpha, uno sin transparencia ninguna, uno entrelazado y uno
  truncado, y comprueba que la caja sea la correcta, que un alpha demasiado tenue no cuente como
  dibujo, que una caja del tamaño del fotograma se avise, que una imagen enorme se rechace antes de
  descomprimirla y que **cada negativa diga la verdad** sobre por qué lo es.
- `scripts/test-helper.mjs` prueba el arranque de los ayudantes nativos sin necesitarlos: que el
  `stderr` se vacíe aunque el ayudante escriba más de lo que cabe en la tubería, que un ayudante
  colgado se mate de verdad y no solo se le pida que salga, y que el tiempo que se le da dependa de
  lo que se le pidió, porque una pulsación tarda milisegundos y codificar una imagen del portapapeles
  puede tardar segundos.
- `scripts/test-paste.mjs` prueba el lado del pegado: cómo se lee el reporte del ayudante y qué
  fuente gana en cada plataforma, qué se dice cuando **no hay imagen** en el portapapeles y cuando la
  que hay **no trae transparencia**, que la carpeta se cree **exactamente una vez** y no en cada
  pegado, que un nombre ya ocupado no se pise, que el PNG se borre si Premiere acaba rechazando el
  pegado —incluso cuando Premiere se niega a borrar el elemento importado y hay que sacarlo por su
  bin—, y la colocación en la línea de tiempo: la pista libre cuando la hay, la pista nueva cuando
  no, una **pista bloqueada** que está vacía y aun así no es sitio, y una negativa limpia cuando la
  pista que se había apartado deja de estar libre.
- `scripts/test-updater.mjs` levanta un servidor de releases local con un `.zxp` real y verifica
  la comparación de versiones, la descarga con redirecciones, el reemplazo en sitio y que se
  niegue a pisar una instalación de desarrollo o un paquete incompleto.
- `scripts/test-service.mjs` corre la extensión invisible contra un helper de hotkey falso que
  habla el mismo protocolo: comprueba el arranque, que una pulsación abra el panel, el cambio
  de atajo en caliente sin reiniciar el proceso, el reinicio tras una caída y que no quede
  ningún proceso vivo al cerrar Premiere. El helper falso puede tardar en confirmar o no
  confirmar nunca, porque el servicio solo debe reportar el atajo como activo cuando el helper
  lo confirmó de verdad. También puede quedarse **sordo** e ignorar tanto `QUIT` como `SIGTERM`, que
  es lo que hace uno atascado dentro de una llamada del sistema: ahí se comprueba que se lo mate a la
  fuerza en vez de dejarlo comiéndose la tecla, que el listener al que acaba de reemplazar no ocupe
  el sitio del que está vivo cuando termina de salir, y que un reinicio que ya no hace falta no se
  lleve por delante al que sí está corriendo ni levante uno cuando Premiere ya se está cerrando.
  También que el marcador de «la paleta está abierta» **caduque solo**: si lo
  dejó una sesión anterior de Premiere, el atajo abre la paleta en vez de gastarse en cerrar algo que
  ya no existe. Y que **Compass siga al proyecto con la paleta cerrada**, que es la única razón por
  la que vive ahí: encenderlo escribe la ruta, cambiar de secuencia activa la mueve con él y apagarlo
  la deja quieta.

Dos herramientas que no son pruebas y por eso no están en `npm test`:

- `npm run inspect:presets` pasa tus `.prfpset` reales por el parser del host y te dice qué
  entendió de cada uno. Útil cuando un preset tuyo no se aplica como esperabas.
- `node scripts/bench-panel.mjs` mide las dos aperturas que importan: la primera de tu vida (hay que
  construir el índice) y todas las demás. En jsdom, que es más lento que Premiere, la segunda pinta
  en unos 4 ms y termina de despertar en 15, con dos llamadas al host y cero archivos de preset
  abiertos; una consulta amplia cuesta unos 11 ms dibujando como máximo 20 filas, sin importar el
  tamaño del índice. Si esos números de llamadas o de archivos suben, algo se rompió.
- `node scripts/snapshot-ui.mjs` escribe un HTML con el panel real en sus estados principales (en
  reposo, escribiendo, el menú de clic derecho, el inspector de efectos y los ajustes) y la hoja de
  estilos de verdad, para revisar el diseño en un navegador sin instalar nada en Premiere.
- `node scripts/check-layout.mjs` comprueba en Chrome de verdad que el tamaño que la paleta le pide
  a Premiere es el que la hoja de estilos termina ocupando, con varios tamaños de texto. Hace falta
  cuando toques las alturas de `panel/css/` o las constantes del plan en `panel/src/app.ts`.

## Límites conocidos

- El QE DOM que Premiere usa para aplicar efectos y transiciones no está documentado por
  Adobe. Es el mismo camino que usan las extensiones comerciales del sector, pero una
  actualización mayor de Premiere puede requerir ajustes.
- Que la paleta se quede cargada depende de `setExtensionPersistent`, que Premiere expone y usa su
  propio panel de ejemplo, pero de la que Adobe no documenta qué hace con una extensión `Modeless`
  como esta. Si tu versión la ignora, cerrar la paleta vuelve a descargar la página y cada
  invocación cuesta lo que costaba antes: se pierde la velocidad, no se rompe nada. La excepción es
  **desanidar**, que necesita que la paleta siga viva mientras Premiere copia y pega: en un Premiere
  que no acepte quedarse cargado, desanidar **se niega antes de empezar** y te lo dice, en vez de
  descargarse a sí mismo a mitad de la operación.
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
- **Desanidar no pide nada al sistema operativo y no necesita el ayudante nativo**: reconstruye con la
  API de Premiere (ver [Cómo funciona desanidar](#cómo-funciona-desanidar)). El precio de eso es lo que
  una reconstrucción no puede llevar, y lo dice por su nombre antes de tocar nada: **las transiciones
  de dentro del nest** (ningún script crea una) y **los clips multicámara**.
- **Un clip multicámara no es un nest para esto.** Seleccionarlo y desanidar no hace nada: abrirlo
  sacaría los ángulos apilados, que no es lo que quiere nadie. Y un multicámara **dentro** de un nest
  hace que ese nest se rechace entero, porque ningún script puede *preguntar* cuál es el ángulo activo
  (la petición de Adobe DVAPR-4207094 sigue abierta) y sacar el ángulo equivocado sería peor que no
  sacar nada; el aviso del diálogo los cuenta para que lo sepas antes de pulsar `Enter`. Si tienes un
  multicámara a mano, busca *Probe Multicam Clip* con ese clip seleccionado y escribe un
  `multicam-probe.txt` junto a los ajustes con todo lo que Premiere expone de él.
- Desanidar necesita que la secuencia del nest esté en el proyecto (siempre lo está) y la localiza
  comparando `nodeId`. Un nest cuyo `nodeId` no coincida con ninguna secuencia se salta con un
  mensaje en vez de colocar algo a medias.
- Que un nest esté **recortado** no cuesta nada: cada clip se coloca apuntando su elemento de proyecto
  al trozo de origen que mostraba, así que sale exactamente la parte que se veía. Un nest al que le
  cambiaste la velocidad sí se salta diciéndolo, porque rebobinar eso cambiaría cuánto dura lo que hay
  dentro.
- **Suavizar keyframes dibuja la curva, no la describe**: un script puede decirle a Premiere qué tipo
  de interpolación tiene un keyframe, pero no dónde están sus manijas bezier. La única forma de que
  haya curva es rellenar los frames intermedios con valores tomados de ella —es lo que hace Easyfy— y
  eso tiene consecuencias que conviene saber: quedan muchos keyframes en el gráfico (uno por frame de
  cada tramo), cada uno cuenta como un paso de historial y, si después mueves a mano uno de los
  keyframes originales, el relleno viejo sigue donde estaba: vuelve a ejecutarlo para redibujarlo.
  Los tramos de un solo frame y los que empiezan y acaban en el mismo valor se saltan porque no hay
  nada que curvar, y un keyframe que caiga entre dos frames dentro de un tramo se elimina en vez de
  quedarse peleando con el relleno.
- **Suavizar keyframes no se puede deshacer de un tirón.** Cada keyframe del relleno es una escritura
  y por tanto un paso del historial, y el historial de Premiere tiene 32 pasos por defecto: un tramo
  de un segundo a 30 fps ya se lo come entero. Los scripts no pueden abrir una transacción en este
  host —el QE DOM expone `undo()` y el índice de la pila, y nada que agrupe—, así que `Cmd/Ctrl + Z`
  retrocede **un keyframe cada vez**. El diálogo lo avisa antes de aplicar.
- **Suavizar keyframes se niega en tres casos, a propósito.** Un tramo de más de **300 frames** (diez
  segundos a 30 fps) se salta diciendo cuántos frames tenía: rellenar un minuto entero a un keyframe
  por frame no se nota en pantalla y sí destruye el historial. Una propiedad que **no** esté en la
  lista —Posición, Escala, Escala horizontal, Rotación, Opacidad y Punto de ancla— se salta aunque
  tenga keyframes, porque un desplegable o una casilla que Premiere expone como número (los modos de
  fusión son 0, 1, 2…) interpolado da valores intermedios que son otros modos, no una transición. Y
  un clip con **cambio de velocidad animado** (*time remapping*) se salta porque no hay una sola
  rejilla de frames que valga para todo el clip; un cambio de velocidad constante sí se contempla,
  dividiendo la rejilla por la velocidad. Se pueden añadir propiedades a la lista más adelante, una a
  una y con su prueba.
- **Un relleno solo se reconoce si de verdad es una curva de esta herramienta.** Antes de reducir un
  tramo denso a sus extremos, se comprueba que sus valores caigan sobre una bezier de la forma que
  esta herramienta dibuja. Si no caen —porque los pusiste tú a mano, frame a frame— el tramo se
  respeta y el mensaje te dice que esa propiedad ya tiene un keyframe en cada frame.
- **Los keyframes que pusiste tú conservan su tipo de interpolación.** El relleno se escribe lineal,
  pero los dos extremos de cada tramo se quedan como estaban: si les habías dado forma bezier a mano,
  sigue ahí.
- **El alpha solo se puede leer de un PNG**. CEP no da acceso a los fotogramas que Premiere
  decodifica, así que la única forma de saber qué hay dibujado es abrir el archivo por nuestra cuenta,
  y el panel trae un lector de PNG (cabecera + datos, con las cinco variantes de filtro) que devuelve
  la caja mínima que contiene todo lo no transparente, guardada en caché por ruta y fecha. Lee tanto
  los PNG con canal alpha como los **de paleta con transparencia en `tRNS`**, que es como la guarda
  casi cualquier logo exportado con «Save for Web». Un PNG entrelazado, uno de 16 bits por canal o uno
  que de verdad no lleva transparencia se saltan con un mensaje que dice cuál de las tres cosas es, y
  una imagen de más de **12 megapíxeles** también, porque descomprimirla bloquearía la paleta durante
  medio segundo largo. Un alpha muy tenue **no cuenta como dibujo**: hace falta un mínimo para que un
  píxel entre en la caja, y si aun así la caja acaba siendo el fotograma entero el mensaje lo dice,
  porque eso casi siempre es una veladura y no un objeto que ocupe todo. Para video, secuencias de
  imágenes u otros formatos con alpha se usa el frame completo y **el mensaje lo dice** en vez de
  disimularlo. El tamaño del origen sale de la cabecera del PNG cuando lo leímos y, si no, de las
  columnas del panel de proyecto: si Premiere no lo dice, ese clip se salta.
- **Mover el ancla con escala o rotación animadas y sin keyframes de posición** no se puede
  compensar exactamente: la corrección tendría que valer distinto en cada instante y no vamos a
  inventar keyframes de posición que tú no pusiste. Se aplica una sola corrección, la del estado
  actual, y el mensaje avisa de que la imagen puede derivar. Con la posición animada no hay problema:
  cada keyframe se corrige muestreando ahí la escala y la rotación. Un clip cuyo **punto de ancla**
  ya esté animado se salta con un mensaje: moverlo sería reescribir esa animación.
- El efecto *Transform* se busca por su `matchName` (`AE.ADBE Geometry2`) y sus parámetros por
  nombre visible, con la posición habitual como último recurso; si tu versión de Premiere los llama
  de otra manera y no los reconoce, el clip se salta con un mensaje en vez de escribir en el
  parámetro que estuviera en ese hueco.
- **Las claves de preferencias que usa Compass no están documentadas por Adobe.** Existen y se leen
  en el archivo de preferencias real de esta máquina, y son las mismas desde Premiere 23 hasta la 26,
  pero nadie garantiza que una versión futura las conserve ni que el diálogo de exportación las lea
  siempre. Por eso la escritura va detrás de una comprobación de ida y vuelta y por eso existe
  *Export via Compass* (ver [Qué diálogos de exportación puede mover
  Compass](#qué-diálogos-de-exportación-puede-mover-compass)). Lo que **no** podemos hacer es cambiar
  la ruta de un diálogo que ya está abierto: Premiere lee la preferencia al abrirlo. La extensión
  invisible **solo escribe cuando la ruta resuelta cambia**, no cada vez que mira, así que si editas
  la ruta a mano en el diálogo de exportación no te la va a pisar mientras sigas en la misma
  secuencia. Y *Export via Compass* **nunca pisa una exportación anterior**: si el archivo ya existe
  le añade `-2`, `-3`, igual que el pegado del portapapeles.
- **Pegar el portapapeles necesita el ayudante nativo**, que es lo único que sabe leer el portapapeles
  del sistema; no pide ningún permiso para hacerlo. Si el ayudante falta, la paleta lo dice y no pega
  nada. Del portapapeles se sacan **imágenes y archivos** (un video copiado en el Finder o el
  Explorador se copia a la carpeta `Paste`, se importa y sale con su duración real); el texto y los
  clips copiados de la propia línea de tiempo no son cosa suya.
- **Una imagen que llega sin alpha no lo recupera.** Si lo único que hay en el portapapeles es un
  `CF_BITMAP` de Windows o una captura plana, el PNG que se escribe es correcto y sin pérdida, pero
  su fondo es opaco porque nunca hubo transparencia que guardar. El diálogo lo avisa antes.
- **Una pista bloqueada no cuenta como sitio libre**, aunque esté vacía. Premiere se niega a escribir
  en ella, así que ni el pegado del portapapeles ni el desanidado la reservan: pasan por encima y, si
  no queda ninguna abierta, añaden una nueva. Es lo contrario de lo que hace un arrastre a mano, que
  simplemente no te deja soltar ahí, pero es la única forma de que un candado en V2 no acabe siendo
  un pegado que Premiere rechaza a medio camino.
- El atajo global necesita el helper nativo. Si falta o el sistema lo bloquea, la paleta
  sigue abriéndose desde `Ventana > Extensiones`.
- La barra de título es de Premiere. CEP no permite ventanas sin marco: el host dibuja el contorno
  de toda extensión visible, y UXP tampoco lo cambia. Lo único que está en nuestra mano es que la
  ventana mida lo que mide el contenido, que es lo que hace la paleta.
- La paleta tampoco puede elegir *dónde* aparece. CEP expone el título y el tamaño de la ventana, y
  nada más: no hay forma de posicionarla, así que abrirla junto al mouse tendría que hacerla mover
  el helper nativo desde fuera, y en macOS eso pide un permiso del sistema que no vale la pena. Premiere
  tampoco guarda la posición en disco (el id de la extensión no aparece ni en el perfil, ni en los
  layouts, ni en el plist), así que la ventana sale donde el host decida.
- Adobe declaró CEP superado por UXP a partir de Premiere 25.6 y planea retirarlo. FX Premiere es
  CEP, así que funciona hoy en todas las versiones soportadas, pero el puerto a UXP es la tarea
  pendiente grande. A cambio traería transacciones reales: un solo paso de deshacer por preset.
