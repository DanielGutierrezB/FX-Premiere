#!/usr/bin/env bash
# Activa el modo depuración de CEP en este Mac. El .zxp de FX Premiere va firmado con un
# certificado propio, no con uno de Adobe, y Premiere se niega a cargar esas extensiones
# mientras el modo depuración esté apagado: el panel no llega a salir en Ventana > Extensiones.
# Los instaladores .pkg y .exe hacen esto por su cuenta; solo el .zxp necesita este archivo.
set -euo pipefail

echo "FX Premiere - activar el modo depuración de CEP"
echo

# CSXS 9 a 13 cubre de Premiere 2019 a las versiones actuales. Se escriben todas porque el número
# de CSXS depende de la versión de Premiere instalada y no cuesta nada acertar de sobra.
for version in 9 10 11 12 13; do
  defaults write "com.adobe.CSXS.$version" PlayerDebugMode 1 2>/dev/null || true
done

echo "Hecho: PlayerDebugMode queda en 1 para CSXS 9, 10, 11, 12 y 13."
echo
echo "Ahora cierra Premiere Pro del todo y vuelve a abrirlo. El cambio no se aplica"
echo "a una sesión que ya estaba abierta."
echo
echo "Después: Ventana > Extensiones > FX Premiere, o el atajo Ctrl + Space."
echo

# Sin esto la ventana del Terminal se cierra sola al terminar y nadie lee lo de reiniciar Premiere.
read -r -p "Pulsa Enter para cerrar esta ventana. " _ || true
