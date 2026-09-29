# Mi Música — reproductor web para tus canciones de Suno

Web estática (HTML + CSS + JS, sin dependencias ni build) con:

- Cuadrícula de portadas con animaciones de entrada, inclinación 3D y fondo que cambia con cada canción
- Reproductor completo con transición circular, mini-reproductor, cola, aleatorio y repetir
- **Letras**: sincronizadas estilo karaoke (formato LRC) o normales con scroll automático
- **Vídeo** (opcional por canción), **portada** o **visualizador** de audio en tiempo real
- Búsqueda, filtros por estilo, atajos de teclado, control desde el móvil/bloqueo de pantalla (Media Session)
- Enlace directo a una canción: `https://tu-web/#id-de-la-cancion`

## Probarlo en local

```bash
cd suno-player
python3 -m http.server 8000   # abre http://localhost:8000
```

(No funciona abriendo `index.html` con doble clic porque el navegador bloquea `fetch` de `songs.json`.)

## Añadir tus canciones

1. En Suno, descarga cada canción (MP3/WAV y, si quieres, el vídeo MP4) y copia la letra.
2. Guarda los archivos en `media/` (y las portadas en `media/covers/`).
3. Añade una entrada en `songs.json`:

```json
{
  "id": "mi-cancion",
  "title": "Mi canción",
  "audio": "media/mi-cancion.mp3",
  "cover": "media/covers/mi-cancion.jpg",
  "video": "media/mi-cancion.mp4",
  "tags": ["pop", "verano"],
  "suno": "https://suno.com/song/...",
  "lyrics": "[Verse 1]\nTexto de la letra..."
}
```

Solo `title` y `audio` (o `video`) son obligatorios. Sin `cover` se genera una portada de colores automática.

### Letra sincronizada

Escribe cada línea con su tiempo `[mm:ss.xx]`; se resaltará al sonar y se puede hacer clic en una línea para saltar a ella:

```
[00:12.50] Primera línea
[00:17.00] Segunda línea
```

Si pegas la letra tal cual sale de Suno (con `[Verse]`, `[Chorus]`…), se muestra con las secciones marcadas y se desplaza sola según avanza la canción.

## Publicarla gratis

**GitHub Pages / Netlify / Cloudflare Pages**: sube la carpeta `suno-player/` (o su contenido) y ya está. En GitHub Pages: *Settings → Pages* y elige la carpeta/branch.

## Notas

- **Aloja tus propios archivos** en lugar de enlazar a los de Suno (`cdn1.suno.ai/...`): pueden cambiar o bloquear el acceso externo, y el visualizador solo puede analizar el audio real si viene del mismo dominio (si no, muestra una animación simulada).
- No mezcles audios del mismo dominio con audios externos sin cabeceras CORS en la misma sesión: el navegador silenciaría los externos.
- Atajos: `Espacio` play/pausa · `←/→` ±5 s · `N`/`P` siguiente/anterior · `S` aleatorio · `R` repetir · `F` pantalla completa · `L` letra · `Esc` cerrar
- Las tres canciones "(demo)" de `songs.json` usan audio sintetizado en el navegador (`"audio": "demo:..."`); bórralas y pon las tuyas.
