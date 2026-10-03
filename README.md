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
  solos) incluyendo presets con varios efectos, keyframes y colores. La lista es **la misma que ves
  en el panel de Efectos**, ni más ni menos: cada archivo de esos es una biblioteca completa, y al
  actualizar Premiere copia la tuya a la carpeta de la versión nueva y deja la vieja donde estaba
  (más el perfil de antes de entrar a Creative Cloud, al lado del que se usa). Cuando borras un
  preset en Premiere solo desaparece de la biblioteca que Premiere está escribiendo, así que leer
  todas era mostrarte tus presets como estaban antes de que ordenaras nada. Se lee una sola: la de
  esta versión que se guardó más recientemente, porque la biblioteca en uso es la que se guarda. Las
  de versiones anteriores solo se leen cuando esta versión todavía no tiene ninguna, para que un
  Premiere recién actualizado muestre lo que está por heredar. El log dice cuál eligió, y si te falta
  alguna puedes añadir su carpeta a mano en los ajustes. Lo que la paleta **no** hace es renombrarte
  esos presets: Premiere lee esa biblioteca al arrancar y la reescribe entera desde memoria cada vez
  que guarda, así que un nombre cambiado en el archivo por detrás no aparecería en el panel de Efectos
  hasta reiniciar y se perdería en cuanto Premiere volviera a guardar. El clic derecho te lo dice y te
  manda al panel de Efectos, que es donde se renombran de verdad; como la paleta relee la biblioteca en
  cada invocación, el nombre nuevo llega aquí solo. Llega, eso sí, como otro preset: cada preset se
  identifica por su nombre, la carpeta en la que está y si es de video o de audio, que es lo único que
  Premiere no te mueve por detrás —el sitio que ocupa dentro del archivo se renumera entero en cada
  guardado, y la carpeta de la biblioteca cambia al actualizar Premiere—. Gracias a eso, un preset que
  usas a diario conserva su ranura, su sitio en los recientes y su cuenta de uso por mucho que Premiere
  reescriba la biblioteca; a cambio, si lo renombras en Premiere se queda sin número, porque para la
  paleta (y para cualquiera que lo mire) ya es otro preset, y se lo vuelves a asignar con `Cmd/Ctrl + D`.
  Los perfiles anteriores se migran al abrir: donde el mismo preset estaba guardado bajo dos
  identidades viejas se juntan en una sola —las cuentas se suman y los recientes se quedan en una
  línea— en vez de seguir compitiendo consigo mismo por subir en la lista.
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
  de dentro y los clips multicámara que estén **dentro** de un nest. Un multicámara **seleccionado**
  sí se desanida: salen todos sus ángulos, uno por pista, y **solo el ángulo 1 queda activo**; los
  demás salen desactivados, con su sonido de cámara desactivado también. Antes de pulsar `Enter` te
  dice cuántos ángulos son y cuál va a quedar sonando, y al terminar lo repite por su nombre, porque
  **ninguna API dice qué ángulo se estaba viendo** y el único que lo sabe eres tú: si era otro,
  actívalo y desactiva el ángulo 1.
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
- **Pegar de YouTube (*Paste YouTube*)**: busca «youtube» y pega el link; si ya lo tienes copiado
  aparece puesto, aunque venga en medio de un mensaje, y un link copiado en un momento del video
  (`?t=80`) rellena el inicio del tramo. `Enter` y la paleta se cierra: **la descarga sigue en
  segundo plano** y el clip cae donde estaba el cabezal cuando lo pediste, en la pista de más arriba
  con ese hueco libre, importado en un bin *YouTube*. El archivo se guarda en una carpeta *YouTube*
  junto al proyecto, con el título del video y su id. Baja **la mejor calidad que tenga YouTube**:
  por encima de 1080p YouTube solo ofrece VP9 o AV1, que Premiere no abre, así que eso **se
  convierte a HEVC** con el codificador del propio Mac (al doble del bitrate que gastó YouTube, para
  no perder más por el camino); lo que ya es H.264 o HEVC entra sin tocar. Un video HDR baja en su
  versión SDR, que es la que se ve bien en una secuencia Rec. 709. En cuanto reconoce el link,
  **el video se reproduce en la hoja** y se marcan los tramos como en un monitor de origen: `I`
  donde empieza, `O` donde acaba, tantas veces como tramos quieras; cada `O` lo añade a la lista y
  a la barra de la duración, que se puede pinchar o arrastrar para moverse. `Espacio` reproduce y pausa, las flechas saltan un segundo (cinco con
  `Shift`), un clic en un tramo de la lista va a él y su `×` lo quita; los tiempos también se
  escriben a mano (`1:20`, `80` o `1m20s`). **Cada tramo es su propio archivo y su propio clip**,
  cortado en el frame exacto, y caen uno detrás de otro desde el cabezal en el orden del video. Sin
  tramos, baja el video entero. Si un tramo falla, los anteriores se colocan igual y el aviso dice
  cuál falló; cancelar no deja ninguno. Mientras baja, la paleta
  enseña el progreso en el pie cada vez que la abres, con un botón para cancelarla; al terminar te
  dice dónde cayó. Si cuando termina ya estás en otra secuencia, **no la mete en la que tengas
  abierta**: la deja en el bin y te lo dice. La primera vez en un ordenador baja antes yt-dlp, Deno
  y ffmpeg (unos 150 MB, una sola vez); ver [Cómo baja un video de YouTube](#cómo-baja-un-video-de-youtube).
- **Compass: rutas de exportación automáticas**: busca «compass» o «rutas de exportación» y sale el
  panel con los dos caminos que Premiere recuerda: **Export Path** (el de *Exportar medios*) y
  **Export Frame Path** (el del botón de fotograma del monitor). Arriba del todo, un interruptor,
  *Steer Premiere's export paths*, que manda sobre todo lo demás: apagado, la pantalla entera queda en
  gris y no se puede tocar, porque una ruta escrita con cuidado en un Compass apagado no la lee nadie.
  Cada camino acepta una ruta absoluta o una **relativa al proyecto** (a la carpeta de la
  Production cuando el proyecto pertenece a una): eso es lo que hace el botón **R**, y la pantalla
  lo dice con todas las letras en vez de dejarlo a un hover. Admite los comodines
  `#PROD #PRJ #SEQ #BIN #YYYY #YY #MM #DD #hh #mm`, que **se ofrecen solos al entrar en el campo**
  —no hay que saber que existen— y se insertan **donde tengas el cursor** con un clic; escribir
  filtra la lista, Esc la cierra, y Enter y Tab siguen siendo Enter y Tab hasta que señalas uno con
  las flechas. Al insertarlo se escribe **la barra que falte**, porque un comodín es una carpeta
  entera: `EXPORT` + `#PRJ` es `EXPORT/#PRJ`, mientras que `#YYYY#MM#DD` se queda como está, que es
  una sola carpeta a propósito. Lo que un comodín devuelve es siempre **una sola carpeta**: una secuencia llamada
  `01/02 - rough` produce `01-02 - rough` y no dos niveles, y una barra o unos puntos suspensivos en
  un nombre no pueden sacar la exportación de la carpeta que elegiste. Si un comodín que usas no tiene
  valor —pides `#SEQ` sin secuencia abierta— la ruta se rechaza con un mensaje en vez de quedarse
  coja. Debajo hay una vista previa en vivo de la ruta que producen, con **la parte que pone R en
  gris** y la que escribiste tú en claro, así que ves lo que vas a obtener antes de guardar. Y
  cuando una ruta resuelve pero **no es la que querías**, la fila lo dice y ofrece el arreglo: una
  ruta completa a la que le falta la primera barra con R encendido —el caso de
  `Volumes/Extreme_SSD/…`, que acaba colgando del proyecto—, una unidad de Windows o un `~` en las
  mismas, una carpeta que termina en espacio o una barra doblada. Justo bajo el interruptor está
  **This project only**: al encenderlo, los dos campos **se vacían** para que digas a dónde va este
  proyecto —el sentido de tenerlo es que va a otro sitio— y un aviso en la propia pantalla dice de
  quién son las rutas que estás viendo. Al apagarlo vuelven las generales, y **las dos parejas se
  guardan**: encenderlo otra vez trae de vuelta la del proyecto sin volver a escribirla.
  **Cómo llega la ruta a tu exportación**: los dos caminos no funcionan igual por dentro. El de
  fotogramas es directo —el diálogo *Export Frame* lee la preferencia de Premiere y abre en tu
  carpeta, sin más—. El de medios necesita otra cosa: la extensión invisible vigila si abres una
  ventana de exportación, y en el momento en que aparece —la pestaña *Export* o el *Exportar medios*
  clásico— le escribe la carpeta al campo *Location*, delante de ti, dejando el nombre de archivo que
  Premiere ya había puesto. Lo hace **una vez por ventana**: si después eliges otra carpeta a mano para ese
  entregable, se queda la tuya y nadie te la cambia por detrás. La carpeta **se crea en ese momento**
  si no existía, que es cuando de verdad hace falta, y mientras no exista la fila te lo dice: *This
  folder is not on disk yet*. Resolver la ruta sola —abrir un proyecto, cambiar de secuencia— no crea
  nada, porque con una fecha en la plantilla eso dejaba una carpeta vacía por proyecto y por día a
  quien solo estaba abriendo su trabajo (ver
  [Cómo Compass mueve de verdad la ruta de exportación](#cómo-compass-mueve-de-verdad-la-ruta-de-exportación)).
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
  los mismos valores y keyframes. Puedes incluir o excluir Motion y Opacidad. Esos sí son tuyos, así
  que al clic derecho ofrecen **renombrarlos** y borrarlos: el menú se convierte en un campo con el
  nombre que tienen, escribes el nuevo y `Enter`. El archivo se llama como el preset, y su identidad
  sale de ahí, de modo que renombrar lo mueve todo con él — el número de la barra en el que estuviera,
  su sitio en los recientes y la copia que la paleta guarda para aplicarlo sin índice — en vez de
  dejarte una ranura apuntando a un archivo que ya no existe. Si el nombre ya lo tiene otro preset
  tuyo se rechaza y te lo dice, porque escribirlo significaría escribir encima de ese otro.
- Los comandos propios de la paleta se encuentran por varios nombres, en inglés y en español:
  *guardar preset*, *deshacer*, *ajustes* llegan al mismo sitio que sus nombres en inglés.
- **Tools: qué hace cada herramienta**: `Cmd/Ctrl + /`, el botón *tools* de la línea de abajo o
  buscar «tools», «ayuda» o directamente qué puede hacer esto abre una pantalla con **todas** las
  herramientas de la paleta —Compass, suavizar, desanidar, el ancla, el pegado, los presets, los
  comandos de edición, el motion escrito— y de cada una: una línea de qué hace, cómo se llega a ella
  y las teclas a las que responde su propio diálogo. Está para leerse y no para operarla: hace
  scroll, `Esc` vuelve y sigue siendo legible en la ventana más estrecha. Dice también lo que una
  herramienta **no** puede hacer —el nest con un multicámara dentro, la ruta que solo se puede mover
  con una ventana de exportación abierta, el deshacer que cuesta una pulsación por keyframe— porque
  eso es lo que conviene saber antes de usarla y no a mitad.
- **Asignar una ranura**: con el elemento seleccionado, `Cmd/Ctrl + D` y después el número que
  quieras (con los modificadores de la fila si es otra fila). Pulsar la ranura que ya lo tiene lo
  quita, y `Esc` sale sin asignar nada. El clic derecho de cualquier fila hace lo mismo, y si el
  elemento ya está en la barra ofrece quitarlo de una vez. **Y el clic derecho sobre la ranura misma
  abre ese mismo menú** para lo que tenga puesto: quitarlo del número, aplicarlo, y renombrarlo o
  borrarlo si es un preset tuyo. Es el sitio donde estás mirando cuando quieres sacar algo de la
  barra, así que es donde se pregunta. En una ranura vacía no abre un menú sin nada dentro: la línea
  de abajo dice qué le falta a ese número. Lo que ya no sale por ninguna parte de la paleta es el
  menú del navegador que Premiere trae debajo (Atrás, Recargar, Ver código fuente), que aparecía
  justo encima de la barra y nunca era respuesta a nada; en los campos de texto sí se queda, porque
  ahí cortar, copiar y pegar sí sirven. En los ajustes eliges cuántas ranuras tiene cada fila, añades
  o quitas filas y grabas la combinación de cada una.
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
  preset nuevo en Premiere, el sello cambia y aparece **en la siguiente invocación**, sin reindexar:
  la pregunta se hace en cada invocación, no solo al arrancar la página, porque con la paleta viva en
  memoria esa página puede ser la misma toda la tarde. Lo único que la paleta no puede adivinar es un
  preset que Premiere todavía no ha escrito en disco; en cuanto lo escribe, está ahí.
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
| `Cmd/Ctrl + /` | la pantalla *Tools*: qué hace cada herramienta y cómo se usa |
| `Esc` | cerrar (o volver atrás desde un diálogo) |

En el diálogo de transición `↑` `↓` cambian la duración de frame en frame (`Shift` de cinco
en cinco) y `Enter` aplica. En el de desanidar, `↑` `↓` y `1`..`3` eligen entre video, audio o
ambos, `Enter` desanida y `Esc` vuelve.

## Cambiar el atajo

Ajustes (`Cmd/Ctrl + ,`, o escribiendo «settings») > *Open the palette* > presiona la combinación que
quieras. Se aplica al instante, sin reiniciar Premiere.

### Cuando el atajo no hace nada

Hay dos maneras distintas de que un atajo falle, y se parecen poco.

**Otra aplicación reservó la combinación.** El listener no consigue registrarla y lo dice: los
ajustes muestran el error en el estado, y el registro guarda una línea `ERROR`.

**macOS se la queda antes.** Un atajo del sistema se sirve antes de que ninguna aplicación vea la
tecla, así que el listener la registra sin problema, contesta `READY`, y la pulsación no llega
nunca. Todo parece sano y no pasa nada. El caso habitual es el atajo por omisión: `Ctrl + Space` es
también *Seleccionar la fuente de entrada anterior* en cuanto tienes dos idiomas de teclado
instalados, que es la situación de casi cualquier editor hispanohablante.

Desde 1.8.4 la paleta lo detecta sola. Al arrancar el listener compara la combinación configurada
con los atajos del sistema y, si alguno se la queda, los ajustes muestran un aviso encima de la fila
del atajo con el nombre exacto de lo que la ocupa y un botón **Free the key** que lo desactiva sin
salir del panel. El aviso también dice en qué panel de Ajustes del Sistema volver a activarlo.

Un detalle que costó encontrar: un Mac donde nadie ha abierto nunca ese panel **no tiene ninguna
entrada** para el atajo, y eso no significa que esté libre, sino que rige el valor de Apple, que
viene encendido. Leer la ausencia como «libre» es exactamente el fallo que dejaba pasar el caso.

En Windows la detección no aplica; ahí lo que puede chocar es el cambio de IME en teclados
asiáticos, y eso sí aparece como `ERROR` del listener.

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
   clip multicámara que aparece *dentro* del nest (se volvería a colocar como multicámara, y una
   colocación nueva sale con el ángulo que Premiere decida, no con el que estaba cortado), una
   transición (no hay API que cree una), un clip que Premiere no describe, o un nest retimado.
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

Un rango de origen **cae en los frames del propio archivo**, no en los de la secuencia, así que un
material cuya rejilla no es la de la línea de tiempo —cualquier cosa a 29.97 en una secuencia a 30,
cualquier archivo con timecode de inicio— vuelve una fracción de frame más corto de lo que se pidió,
y el clip se coloca esa fracción más corto. En la línea de tiempo una fracción de frame no es una
fracción: redondea a un frame entero, y eso dejaba **un frame vacío al final de cada clip
reconstruido**, uno por corte. Así que después de colocar cada clip se le escribe el final que tenía
dentro del nest, que es el único número que ya está en la rejilla de la secuencia (sale de los clips
de dentro, que están en ella). Se escribe el final y no se pide un rango de origen más largo: eso
colocaría el clip un frame *más allá* de donde va, encima de lo que tengas después del nest.

Si pides **video y audio** y el nest solo tiene una de las dos cosas —o Premiere no quiere listar las
pistas del otro tipo, que es lo que pasa con secuencias hechas solo de clips sin sonido— sale lo que
haya y el resultado dice qué tipo no pudo leer. Antes se rechazaba el nest entero, así que el mismo
nest fallaba con «video y audio» y salía perfecto con «solo video», que es la opción que tapaba el
problema. Un tipo que no se puede leer solo es un rechazo cuando es el único que pediste.

Un multicámara es una secuencia cuyas pistas de video son sus ángulos, así que reconstruirlo los saca
todos de golpe y todos sonando, con el de arriba tapando al resto. **Cuál estaba en el aire no se
puede leer.** `isMulticamClip()` es el único miembro multicámara del DOM documentado; el `TrackItem`
de UXP no tiene ninguno; y lo que ofrece el QE DOM es o una escritura (`setMulticam`) o un sí o un no
(`canDoMulticam`, `multicamEnabled`) — la respuesta de Adobe, por escrito, es que no hay APIs de
multicámara y no va a haberlas. Así que el ángulo que se queda activo es el **1** (la pista de video
de abajo de la secuencia, que es el orden con el que el monitor multicámara numera las teclas `1`..`9`),
los demás salen desactivados, y el sonido de cámara de un ángulo desactivado se desactiva con él:
todas las cámaras sonando a la vez no es lo que sonaba el multicámara. La paleta lo dice dos veces —en
el diálogo, con el nombre del ángulo que va a quedar, y al terminar— para que nadie se quede creyendo
que se conservó su corte. Un multicámara **dentro** de un nest sigue rechazado: ahí no hay ángulos que
sacar, se volvería a colocar como multicámara y saldría con el ángulo que Premiere decida.

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

### Cómo baja un video de YouTube

Lo hacen tres programas que **no van dentro del instalador**: FX Premiere los baja la primera vez que
se usa la función y los guarda en su propia carpeta (`~/Library/Application Support/FX Premiere/tools`,
`%APPDATA%\FX Premiere\tools` en Windows). Juntos pesan unos 150 MB, que triplicarían el instalador
para una función que no todo el mundo usa; y yt-dlp deja de funcionar cada pocas semanas cuando
YouTube cambia algo, así que una copia congelada en una versión caducaría mucho antes que la versión
siguiente. Se bajan desde el propio proceso, no desde un navegador, así que macOS no les pone la
marca de cuarentena y no hace falta tocar Gatekeeper ni ser administrador.

- **yt-dlp** habla con YouTube. Se actualiza solo como mucho una vez al día y, si falla con algo que
  no sea un video borrado, privado o con restricción de edad, se actualiza al momento y lo vuelve a
  intentar.
- **Deno** resuelve el reto en JavaScript que YouTube pone antes de dar nada por encima de las
  calidades más bajas. yt-dlp lo exige desde noviembre de 2025.
- **ffmpeg** une imagen y sonido, convierte lo que Premiere no abre y baja los tramos. En Mac es la
  compilación de martin-riedl.de, que trae VideoToolbox; en Windows, la de BtbN, y el codificador se
  elige probando cuál funciona de verdad (NVENC, Quick Sync, AMF y, si no hay ninguno, x265).

Qué se baja se decide con la lista de formatos que YouTube entrega para ese video: **la máxima
resolución, a su frame rate**; entre los que la tienen, el que Premiere abre tal cual antes que uno
que haya que convertir; SDR antes que HDR; y de ahí, el de más bitrate. El sonido es la mezcla
completa en el idioma original —no la versión comprimida para móviles ni un doblaje—, en AAC si lo
hay, porque entra sin tocar. Todo se une en MP4: MKV guarda el tiempo en milisegundos, 60 fps no
caben en eso, y un 4K60 convertido desde MKV salía diciendo que iba a 15991/533 fps.

Un **tramo** no pasa por yt-dlp: ffmpeg lo lee directamente de los servidores de YouTube, así que
solo viaja ese trozo, y siempre se recodifica para cortar en el frame exacto (copiar el stream
empezaría en el keyframe anterior, y Premiere enseña esos frames en negro o congelados). Dos
detalles que costaron una prueba en vivo cada uno: el ffmpeg estático no encuentra los certificados
raíz del Mac, así que se le pasan los de Node; y YouTube sirve los primeros megas de cada petición a
toda velocidad y luego baja a unos 200 KB/s, así que se le pide en trozos de 10 MB, como hace yt-dlp
(6 s de 4K60 pasaron de un 2 % por minuto a menos de 6 segundos).

La **vista previa** es el reproductor de YouTube, que no necesita bajar nada y arranca en cuanto el
link es válido. No puede ir directamente en la paleta: la paleta es una página `file://`, que no
manda referer, y YouTube le contesta con el error 153 y nada más. Así que la paleta sirve la página
del reproductor desde `127.0.0.1` (un origen que YouTube sí acepta) y lo maneja con mensajes entre
marcos —reproducir, pausar, ir a un tiempo— mientras él le dice diez veces por segundo dónde va,
que es lo que leen `I` y `O`. Las teclas del propio reproductor están apagadas y, si haces clic en el
video, el foco vuelve a la hoja: el clic llega igual, pero `I` y `O` siguen siendo marcas. Un video
cuyo dueño no deja reproducirlo fuera de YouTube no tiene vista previa, pero se baja igual con los
tiempos escritos a mano.

Con varios tramos, cada uno se baja y se corta por separado y la barra de progreso los recorre todos
según lo que dura cada uno. Si uno falla —YouTube niega un trozo—, los anteriores ya están hechos y
se colocan, y el resultado dice cuál falló y por qué. Cancelar, en cambio, es no querer nada: lo que
esa descarga ya había hecho se borra.

El **video de la hoja** es el reproductor de YouTube, que no necesita bajar nada antes y arranca en
cuanto el link es válido. No puede ir directamente en la paleta: es una página `file://`, que no
manda origen, y YouTube responde a eso con el error 153 y nada más. Así que la paleta sirve una
página mínima en `127.0.0.1` con el reproductor dentro y lo maneja con mensajes —reproducir, pausar,
ir a un tiempo— mientras él informa diez veces por segundo de dónde va, que es lo que lee `I` u `O`.
Encima del reproductor hay una capa propia que recibe el clic (reproduce o pausa) para que **el foco
del teclado no entre nunca en la página de YouTube**: la primera versión dejaba que entrase, y desde
ahí `I` y `O` se iban a YouTube, que las ignora. Si aun así la página del reproductor recibe una
tecla, se la pasa a la hoja y le devuelve el foco. Un video cuyo autor no permite verlo fuera de
YouTube se puede bajar igual: la hoja lo dice y los tiempos se escriben a mano.

La descarga corre en el **servicio invisible**, no en la paleta, que se cierra en cuanto el servicio
la acepta. Las descargas van de una en una, en cola; el servicio escribe cómo van en
`youtube-status.json` y la paleta lo lee cada vez que está abierta. El sitio donde va el clip se
apunta **en el momento de pedirlo** —la secuencia y el cabezal— y se respeta al terminar, aunque
hayas movido el cabezal mientras tanto. El archivo se va haciendo en una carpeta oculta dentro de la
carpeta *YouTube*, para que el final sea un renombrado y no una copia de gigas, y si Premiere se
cierra a mitad, la siguiente descarga en esa carpeta se lleva lo que quedó.

### Cómo Compass mueve de verdad la ruta de exportación

Aquí conviene ser exacto, porque es la parte que nadie ha documentado y porque la primera versión de
esto **estaba equivocada**. Lo que sigue está medido sobre un Premiere 26 abierto, no deducido.

La primera versión escribía dos preferencias, y con las dos **no pasa lo mismo**:

```
Monitor.ExportFrame.CurrentPath   la carpeta de Exportar fotograma — sí funciona
MZ.Prefs.Export.Media.Path        la carpeta de Exportar medios    — no hace nada
```

La de fotogramas **sí dirige su diálogo**, y está comprobado apuntándola a una carpeta que nadie
había usado: el diálogo *Export Frame* abre justo ahí. Así que para los fotogramas no hace falta
vigilar nada y la paleta sí puede prometer esa ruta.

La de medios, en cambio, **acepta el valor y no mueve nada**: la escritura entra, se devuelve igual
al volver a leerla, sobrevive a reiniciar Premiere… y la pestaña *Export* sigue ofreciendo la carpeta
que ella quiera. La razón es que **Premiere 26 guarda ese destino dentro del proyecto**: un `.prproj`
contiene un `OutPath` por secuencia y por grupo de exportación, y esa ruta le gana a cualquier
preferencia. Cuando lo que tiene guardado no le sirve, cae a la carpeta *Documents* del usuario, que
es exactamente el síntoma que destapó todo esto: un proyecto nuevo hecho a partir de una copia
arrastraba rutas ajenas —incluidas unas `E:\` de un editor de Windows— y ninguna escritura de
preferencias podía con ellas. No hay API de ExtendScript que escriba dentro de los ajustes de
exportación del proyecto, así que por esa vía no se llega: **nada se reporta como hecho** apoyándose
en esa clave.

Lo que sí mueve la ruta de medios es un objeto que Adobe no documenta en ninguna parte, `ExportSettings`.
Mientras hay una ventana de exportación abierta, sostiene un *transcoder* vivo cuyo `outputFilePath`
es literalmente lo que muestra el campo *Location*:

```
ExportSettings.exportModeManager.isExportModeRunning     la pestaña Export está abierta
ExportSettings.exportModeManager.transcoder
    .outputFilePath                                      lo que muestra Location
    .setOutputFilePath(ruta, true)                       se lo cambia en vivo
ExportSettings.exportMenuManager.isExportMenuRunning     el Exportar medios clásico
```

Tres detalles que costaron encontrarse: el segundo argumento de `setOutputFilePath` es
**obligatorio** —con uno solo responde *Not Enough Parameters*, que parece una API ausente—, el
`transcoder` es `null` mientras no haya ventana abierta (de ahí que haya que vigilar en vez de
escribir al abrir el proyecto), y `isOutputFilePathLocked` marca los casos que hay que dejar en paz.
Un viaje de ida y vuelta a estas llamadas mide alrededor de **un milisegundo**, y por eso el servicio
puede preguntar cada 700 ms sin que se note.

Se escribe **una sola vez por ventana**, no en cada vuelta del reloj: quien teclea su propia carpeta
en *Location* está eligiendo, y devolvérsela tres cuartos de segundo después sería discutir con él.
Si la carpeta cambia mientras la ventana sigue abierta —otro proyecto, otra secuencia— se vuelve a
escribir, porque eso sí es una decisión nueva.

Queda un camino que no depende de nada de lo anterior: **Export via Compass** resuelve los
comodines, crea la carpeta si falta —justo ahí, porque Media Encoder no la crea: una cola cuya
carpeta de salida no existe falla con *The output destination could not be found*— y encola la
secuencia con `app.encoder.encodeSequence` **en esa ruta exacta**, sin depender de ninguna
preferencia. Y solo si el encolado sale adelante: una exportación rechazada por falta de `.epr` o de
secuencia no deja carpetas detrás. Si has puesto un `.epr` en el campo *Export settings*
del panel —el ajuste preestablecido que guarda la ventana de exportación de Premiere— lo usa; si no,
deja que Media Encoder aplique el suyo.

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
  nests con su límite, un multicámara del que salen los tres ángulos con uno solo activo y el sonido
  de cámara de los otros desactivado, y las tres formas de quedarse como estaba: un multicámara
  dentro, un Premiere que no sabe poner una velocidad y uno que no sabe quitar una pista.
- `scripts/lib/host-unnest-guards.mjs` es lo que Premiere no cuenta y hay que comprobar después: una
  colocación que aterriza una pista más arriba de la que se le dijo, una que sobrescribe algo tuyo,
  una selección que cambió desde que el diálogo la contó, un Premiere que añade las pistas nuevas por
  debajo, otro al que no se le puede decir a qué pista va el sonido, y otro que no borra ni quita
  pistas. En todas, la comprobación es la misma: nada de lo tuyo se movió, y lo que ese nest hubiera
  puesto ya no está.
- `scripts/lib/panel-unnest.mjs` hace lo propio desde el panel real: que el comando se encuentre en
  los dos idiomas, el diálogo con su aviso de qué hay dentro y de qué deshace `Cmd+Z`, una vuelta
  completa comprobando que la elección llega al host y se recuerda, el aviso de los ángulos de un
  multicámara —que dice cuál queda sonando y desaparece si solo sacas el audio— y un nest que el host
  rechaza (un multicámara dentro) que tiene que volver al pie de la paleta explicado.
- `scripts/test-panel.mjs` arranca el panel real dentro de jsdom conectado a ese mismo host
  simulado, así que el flujo completo de teclado (invocar, escribir, ↑/↓, Enter, diálogo de
  transición, ajustes, grabar atajo) se prueba de punta a punta. Los diálogos de 1.6.0 entran ahí:
  el de suavizado con sus dos números y los botones de guardar y restaurar el valor por defecto, y el
  de ancla con su cuadrícula, sus dos interruptores y el PNG que las pruebas se generan a sí mismas
  para comprobar que la caja del alpha sale exacta y que un archivo que no se puede leer cae al frame
  completo diciéndolo. Los de 1.6.x también: el de pegar, con un portapapeles falso que puede estar
  vacío o traer una imagen sin alpha, y el panel de Compass, donde un clic en un comodín tiene que
  insertarlo **donde estaba el cursor** y la vista previa seguirlo. Y la pantalla de *Tools*, que no
  se comprueba a mano: la prueba carga la lista de comandos de la paleta y exige que cada uno tenga
  su entrada en la pantalla, así que una herramienta nueva sin explicar rompe `npm test` en vez de
  quedarse sin documentar.
- `scripts/test-compass.mjs` prueba el motor de comodines contra **el ejemplo de la documentación de
  Compass**: la secuencia *DrakeShip* dentro de *Vikings.prproj* a las 15:30 del 20 de mayo de 2022
  tiene que producir `/Users/Dropbox/EXPORT/20220520/Vikings/DrakeShip_1530` y no otra cosa. Y
  después cada comodín uno por uno, el caso de la Production, qué pasa cuando un valor no existe
  (se avisa, no se escribe una carpeta llamada `#SEQ`), la resolución relativa al proyecto y a la
  Production, rutas de Windows y recursos UNC, la creación de carpetas incluida **una que no se
  puede crear**, la precedencia de la anulación por proyecto sobre la general, y la comprobación de
  ida y vuelta de la preferencia **en sus dos resultados**: un Premiere que la acepta y otro que se
  queda con su valor. Y el camino que de verdad importa, con la ventana de exportación simulada como
  se comporta la de Premiere 26: que una ventana abierta se apunte a la carpeta resuelta **dejando el
  nombre de archivo** que Premiere puso, que la carpeta nazca ahí y no antes, que se escriba **una vez
  por ventana** y por tanto que la carpeta que elijas tú después sobreviva, que al cambiar la ruta con
  la ventana abierta se vuelva a apuntar, que el *Exportar medios* clásico se mueva igual, que una
  ruta bloqueada se deje en paz, que una versión que rechace la escritura se reporte en vez de
  reclamar éxito y que un Premiere **sin ese objeto** no se lleve la paleta por delante. Y que el
  valor de un comodín no pueda convertirse en estructura de carpetas:
  una secuencia llamada `../../Desktop` o `S01/E02` produce **una** carpeta con ese nombre saneado, y
  un comodín sin valor rechaza la ruta entera. Cierra con el respaldo del encoder, con y sin preset,
  incluido que dos exportaciones seguidas al mismo sitio no se pisen y **quién crea la carpeta y
  cuándo**: la exportación que sale adelante la hace una sola vez, la que se rechaza no hace ninguna.
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
- `scripts/test-youtube.mjs` es Paste YouTube sin YouTube. La elección de formato se prueba contra
  **la lista real** que dieron dos videos (un 4K60 y un 4K HDR, guardadas en
  `scripts/fixtures/youtube-formats.json`), y la descarga entera contra un yt-dlp, un Deno y un ffmpeg
  falsos que se sirven desde un servidor local como GitHub sirve los de verdad: la primera vez que
  baja las herramientas (ffmpeg dentro de una carpeta del zip, como en Windows), la conversión, el
  tramo con sus certificados y sus trozos de 10 MB, un Mac sin codificador por hardware, un video
  borrado, un yt-dlp viejo que se cura actualizándolo, cancelar, y lo que deja un Premiere cerrado a
  mitad. `test-service.mjs` y `test-panel.mjs` lo prueban además desde el servicio real —el clip cae
  donde estaba el cabezal al pedirlo, o en su bin si cambiaste de secuencia— y desde la hoja de la
  paleta.
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
  la deja quieta. Incluida la vigilancia de la ventana de exportación, que es más rápida que la del
  proyecto: abrir una apunta el destino a la carpeta resuelta y la crea, y la carpeta que el editor
  elija después de eso se queda donde la puso.

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
- Premiere tiene todos tus presets en un único archivo que reescribe entero cada vez que guarda, y
  al reescribirlo reparte identificadores nuevos: el número con el que quedó guardado un favorito
  deja de señalar a lo mismo en cuanto creas o borras un preset. Por eso de un preset se guarda
  **su nombre, la carpeta en la que está y si es de vídeo o de audio**, que es lo que tú reconoces
  en la fila; el identificador es solo dónde estaba la última vez. Si ya no cuadra, el preset se
  busca por ahí, se aplica el que era y queda anotado dónde está ahora, así que la búsqueda se hace
  una vez. Si en esa posición hay otro preset distinto, no se aplica: aplicar el equivocado sin
  decir nada es lo único peor que no aplicar nada. Y si lo borraste o lo renombraste en Premiere, se
  te dice por su nombre en vez de darte la ruta de un archivo.
- Los presets capturados de un clip guardan el valor de cada parámetro tal como estaba en ese
  momento. Si el clip tenía dos veces el mismo efecto, el preset también.
- **Desanidar no pide nada al sistema operativo y no necesita el ayudante nativo**: reconstruye con la
  API de Premiere (ver [Cómo funciona desanidar](#cómo-funciona-desanidar)). El precio de eso es lo que
  una reconstrucción no puede llevar, y lo dice por su nombre antes de tocar nada: **las transiciones
  de dentro del nest** (ningún script crea una) y **los multicámara que estén dentro de un nest**.
- **De un multicámara salen todos los ángulos, y el que queda activo es el 1.** Ningún script puede
  *preguntar* cuál era el ángulo en el aire (la petición de Adobe DVAPR-4207094 sigue abierta), así que
  la paleta no lo adivina: saca los ángulos apilados, uno por pista, deja sonando el 1 y desactiva los
  demás con su sonido de cámara, y te dice —antes de pulsar `Enter` y otra vez al terminar— cuál dejó y
  que ese dato no lo da Premiere. Un multicámara **dentro** de un nest sí hace que ese nest se rechace
  entero, porque volvería a colocarse como multicámara y saldría con el ángulo que Premiere decida; el
  aviso del diálogo los cuenta para que lo sepas antes de pulsar `Enter`. Si tienes un multicámara a
  mano y quieres comprobar si en tu versión hay algo que no vimos, busca *Probe Multicam Clip* con ese
  clip seleccionado: escribe un `multicam-probe.txt` junto a los ajustes con todo lo que Premiere
  expone de él, componentes y parámetros del DOM normal y del QE incluidos.
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
- **Compass depende de un objeto de Premiere que Adobe no documenta**, `ExportSettings`, y de que su
  `setOutputFilePath` siga aceptando lo mismo (ver [Cómo Compass mueve de verdad la ruta de
  exportación](#cómo-compass-mueve-de-verdad-la-ruta-de-exportación)). Está medido en Premiere 26, no
  garantizado para la siguiente: si una versión lo cambia de nombre o de forma, la paleta lo dice en
  la línea de estado en vez de fingir que apuntó. Y hay dos cosas que **no** puede hacer. Una:
  cambiar la carpeta si no tienes una ventana de exportación abierta, porque la ruta que se puede
  escribir solo existe mientras la ventana está en pantalla —así que Compass espera a que la abras—.
  Dos: mover la ruta de la **Exportación rápida**, que no pasa por ninguna de las dos ventanas.
  *Export via Compass* **nunca pisa una exportación anterior**: si el archivo ya existe le añade
  `-2`, `-3`, igual que el pegado del portapapeles.
- **Pegar el portapapeles necesita el ayudante nativo**, que es lo único que sabe leer el portapapeles
  del sistema; no pide ningún permiso para hacerlo. Si el ayudante falta, la paleta lo dice y no pega
  nada. Del portapapeles se sacan **imágenes y archivos** (un video copiado en el Finder o el
  Explorador se copia a la carpeta `Paste`, se importa y sale con su duración real); el texto y los
  clips copiados de la propia línea de tiempo no son cosa suya.
- **Paste YouTube baja lo que YouTube te enseñaría sin iniciar sesión**: un video privado, solo para
  miembros o con restricción de edad se rechaza con el motivo que da YouTube. Un directo solo se
  puede pegar cuando ha terminado. Las condiciones de YouTube no permiten descargar fuera de sus
  propios botones, y los derechos del material son de quien lo usa.
- **Un 4K convertido pesa**: el HEVC sale a unos 50 Mbps en 4K60, unos 370 MB por minuto. La
  conversión en un Mac con Apple Silicon va más rápida que el tiempo real (45 s de 4K60 en 27 s); en
  un Windows sin codificador por hardware la hace x265 y tarda bastante más.
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
