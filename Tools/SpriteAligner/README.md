# Sprite Aligner

Alinea automáticamente imágenes 2D de un personaje (por ejemplo, generadas con IA)
para que todas queden **en el mismo sitio, con el mismo tamaño de lienzo y el mismo
punto de apoyo**, listas para importar en Unreal Engine (Paper2D).

## Qué hace

1. **Quita el fondo** si la imagen no tiene transparencia (detecta el color del borde
   y borra solo el fondo conectado con los bordes, sin agujerear al personaje).
2. **Borra manchas sueltas** (restos de fondo, ruido o firmas de la IA).
3. **Recorta** al personaje.
4. **Escala** (opcional) todos los personajes a la misma altura.
5. **Alinea** cada personaje por los pies (u otro anclaje) en un lienzo común.
6. Guarda **PNGs transparentes** del mismo tamaño y, opcionalmente, una
   **spritesheet + JSON** que Paper2D importa directamente.

## Instalación

Requiere Python 3.8+:

```bash
pip install pillow numpy
```

## Uso

```bash
# Básico: alinear por los pies, lienzo calculado automáticamente
python sprite_aligner.py mis_imagenes/ alineadas/

# Recomendado para Unreal: lienzo en potencia de 2 + spritesheet
python sprite_aligner.py mis_imagenes/ alineadas/ --pow2 --sheet personaje_idle

# La IA genera el personaje a tamaños distintos: igualar altura a 256 px
python sprite_aligner.py mis_imagenes/ alineadas/ --height 256 --canvas 256x320 --prefix idle_
```

### Opciones principales

| Opción | Descripción |
|---|---|
| `--anchor feet` | Punto que se alinea: `feet` (pies, por defecto), `bottom`, `mass` (centro de masa), `center`. |
| `--scale median` | Escala todos a la altura mediana. |
| `--height N` | Escala todos los personajes a `N` px de alto. |
| `--pixel-art` | Escalado sin suavizado (para pixel art). |
| `--canvas 512x512` | Tamaño fijo del lienzo. Si no se indica, se calcula el mínimo necesario. |
| `--pow2` | Redondea el lienzo a potencia de 2 (mejor para texturas en Unreal). |
| `--padding N` | Margen en píxeles (por defecto 4). |
| `--remove-bg auto/always/never` | Quitar fondo. `auto` solo si la imagen no tiene transparencia. |
| `--bg-tolerance N` | Sube este valor si queda fondo; bájalo si se borra parte del personaje. |
| `--sheet NOMBRE` | Genera `NOMBRE.png` + `NOMBRE.json` (formato TexturePacker). |
| `--prefix idle_` | Renombra las salidas como `idle_000.png`, `idle_001.png`... |

Ejecuta `python sprite_aligner.py --help` para ver todas.

> **Ojo con `--height` / `--scale`:** igualar la altura es útil cuando la IA dibuja al
> personaje a distinto tamaño, pero en animaciones donde la altura cambia de verdad
> (agacharse, saltar) deforma el resultado. En ese caso usa `--scale none` y genera
> las imágenes a la misma escala.

## Llevarlo a Unreal (Paper2D)

**Opción A: spritesheet (la más rápida)**

1. Activa el plugin **Paper2D** (viene activado por defecto).
2. Arrastra `NOMBRE.json` (con `NOMBRE.png` en la misma carpeta) al Content Browser.
3. Unreal crea la textura, un sprite por frame y un Flipbook, con el pivote en los pies.

**Opción B: PNGs sueltos**

1. Importa los PNG al Content Browser.
2. Selecciónalos → clic derecho → *Sprite Actions* → *Create Sprite*.
3. En cada sprite, pon *Pivot Mode* en **Bottom Center** (o *Custom* con el valor que
   imprime el script).
4. Selecciona los sprites → clic derecho → *Create Flipbook*.

Para pixel art, aplica también *Sprite Actions → Apply Paper2D Texture Settings* a las texturas.
