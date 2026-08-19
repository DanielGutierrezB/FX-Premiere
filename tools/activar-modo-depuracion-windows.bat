@echo off
rem Activa el modo depuracion de CEP en este PC. El .zxp de FX Premiere va firmado con un
rem certificado propio, no con uno de Adobe, y Premiere se niega a cargar esas extensiones
rem mientras el modo depuracion este apagado: el panel no llega a salir en Ventana > Extensiones.
rem El instalador .exe hace esto por su cuenta; solo el .zxp necesita este archivo.
rem
rem Escribe unicamente en HKCU, asi que no hace falta ejecutarlo como administrador.
rem Los textos van sin acentos a proposito: la consola de Windows usa una pagina de codigos que
rem los convierte en simbolos raros y el mensaje deja de leerse.
setlocal
set FXP_ERROR=0

echo FX Premiere - activar el modo depuracion de CEP
echo.

rem CSXS 9 a 13 cubre de Premiere 2019 a las versiones actuales. Se escriben todas porque el numero
rem de CSXS depende de la version de Premiere instalada y no cuesta nada acertar de sobra.
for %%v in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1 || set FXP_ERROR=1

if "%FXP_ERROR%"=="1" goto failed

echo Hecho: PlayerDebugMode queda en 1 para CSXS 9, 10, 11, 12 y 13.
echo.
echo Ahora cierra Premiere Pro del todo y vuelve a abrirlo. El cambio no se aplica
echo a una sesion que ya estaba abierta.
echo.
echo Despues: Ventana ^> Extensiones ^> FX Premiere, o el atajo Ctrl + Space.
echo.
pause
exit /b 0

:failed
echo No se pudo escribir en el registro.
echo Prueba con clic derecho ^> Ejecutar como administrador, o instala el .exe en vez del .zxp.
echo.
pause
exit /b 1
