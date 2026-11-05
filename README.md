# The West Mobile 🤠

Interfaz móvil **no oficial** para [The West](https://www.the-west.net/) desarrollada por Lautta y Nox.

**Versión estable: 1.3.0** · Probada progresivamente en Firefox Android. El proyecto sigue siendo experimental.

## 📲 Instalación rápida (Android)

1. Instalá **Firefox para Android**.
2. Instalá [Violentmonkey](https://addons.mozilla.org/es-AR/android/addon/violentmonkey/).
3. Desde Firefox abrí **[Instalar The West Mobile](https://raw.githubusercontent.com/Lautta17/the-west-mobile/main/the-west-mobile.user.js)**.
4. Aceptá la instalación en Violentmonkey y entrá a The West.
5. Mapa, Misiones, Inventario, Personaje y Ciudad se detectan automáticamente cuando están disponibles. Si alguno no funciona, entrá a ⚙️ y usá **Vincular** para corregirlo.

Si no aparece el cuadro de instalación, desde Violentmonkey elegí **Instalar desde URL** y pegá la URL del paso 3.

**Importante:** desactivá versiones instaladas manualmente antes de instalar esta para que no se ejecuten dos copias. Las preferencias anteriores quedan guardadas en el navegador.

## Funciones

- Menú derecho plegable, anclado a la pantalla visible con zoom y desplazamiento.
- Accesos automáticos a mapa, misiones, inventario, personaje y ciudad, con vínculos manuales como prioridad y respaldo.
- X táctiles más grandes en las ventanas reconocidas.
- Escalado y distribución adaptable de ventanas flotantes sin superposición.
- Mejoras de tamaño y toque para seguimiento de misiones y brújulas.
- Prevención opcional de apertura automática del teclado del minimapa.
- Accesos Mapa y Personaje con apertura/cierre mediante el mismo botón cuando se detecta su ventana.
- Mayor aprovechamiento del espacio para la ventana del mapa cuando está abierta sola.

## Actualizaciones y pruebas

**Producción:** este repositorio (`the-west-mobile`) contiene únicamente las versiones que decidimos compartir. Las nuevas versiones se publicarán incrementando `@version` en [the-west-mobile.user.js](the-west-mobile.user.js). El userscript tiene metadatos de actualización para Violentmonkey.

**Pruebas:** el desarrollo experimental se hace en un repositorio separado y privado: `Lautta17/the-west-mobile-test`. Su copia instalable para usuarios que optan por TEST se publica por separado bajo `experimental/` y **no** se ejecuta en instalaciones de la versión estable.

## Compatibilidad

Firefox Android + Violentmonkey es el entorno principal. Chrome Android no admite estas extensiones directamente. El script no está diseñado para navegadores de escritorio sin entrada táctil.

## Limitaciones

Los accesos automáticos se basan en selectores identificados en una sesión real y algunos contienen `nth-of-type`, de modo que pueden variar según actualizaciones del juego. Los vínculos manuales que ya tenía cada usuario se conservan. Si un selector no se encuentra de forma inequívoca, el script solicita vincularlo en lugar de hacer clic a ciegas.

**La versión 1.3 no incluye la distribución vertical de inventario/equipamiento ni las demás funciones de la futura v2.0.**


Este es un userscript de **presentación e interacción manual**: no es una app oficial, no modifica servidores ni automatiza acciones del juego. Su funcionamiento puede cambiar con actualizaciones de The West; conviene consultar las reglas de cada servidor. Algunos comportamientos requieren más pruebas en dispositivos reales.

## Próximos desarrollos

Interfaz vertical para inventario/equipamiento, panel de trabajos y misiones más táctil, y mejoras de gestos. La cola de trabajos original se mantiene sin cambios.

Desarrollo colaborativo de **Lautta + Nox**, 2026. Sin afiliación con InnoGames.
