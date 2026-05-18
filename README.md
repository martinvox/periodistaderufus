# Archivo de @PeriodistaRufus

Sitio estático y dataset que reconstruyen el historial público de tuits de la cuenta de Twitter/X **@PeriodistaRufus** a partir de capturas que la **Wayback Machine** (Internet Archive) hizo mientras la cuenta estuvo activa.

Aunque la cuenta haya sido eliminada o los tuits dados de baja, las capturas siguen existiendo en `web.archive.org` — un archivo público y gratuito que cualquiera puede consultar sin login. La premisa de este proyecto es directa:

> Si está en archive.org, es data real, es pública, y se puede bajar, procesar y republicar.

Acá no hay scraping clandestino ni reconstrucción a partir de capturas de pantalla. Hay un pipeline determinista que consulta una API documentada, descarga el contenido archivado tal cual lo guardaron, lo estructura y lo presenta de forma navegable.

---

## Por qué los tuits son reales

Cada tuit del dataset es verificable de forma independiente. La cadena de evidencia:

1. **Internet Archive es un tercero independiente.** Una organización sin fines de lucro con sede en San Francisco que opera desde 1996. Su crawler captura URLs públicas periódicamente y las guarda con timestamp inalterable. No es propiedad ni está controlada por Twitter, X, ni por quien armó este repo.

2. **El contenido no es HTML scrapeado.** Lo archivado para cada tuit es la **respuesta JSON cruda de la API v2 de Twitter** — la misma respuesta estructurada que el frontend de Twitter usaba para renderizar la página. Cuando el crawler visitó cada URL, el servidor de Twitter le respondió con un objeto JSON donde el propio Twitter declaraba: este `tweet_id` pertenece al `author_id` `1788584093388611585`, `username` `PeriodistaRufus`, `name` `Rufus`. La autoría la firmó la infraestructura de Twitter.

3. **Cada captura tiene URL pública y permanente.** Cualquiera, sin cuenta y sin credenciales, puede abrir cualquier `wayback_url` del dataset y ver la captura original servida por archive.org desde su propia infraestructura. Por ejemplo:

   ```
   https://web.archive.org/web/20250301141915id_/https://twitter.com/PeriodistaRufus/status/1895841265847320666
   ```

   Si abrís ese link ahora, archive.org te sirve el mismo bloque de bytes que tenemos en el dataset. Ese es el contrato de prueba.

4. **Las capturas no se retro-fabrican.** Wayback fecha cada snapshot al momento exacto en que el crawler lo obtuvo y mantiene digests SHA-1 de integridad. No existe una vía pública para "subirle" a archive.org un snapshot con fecha pasada.

**La salvedad honesta:** lo único que ninguna evidencia puede descartar al 100% es que la cuenta haya sido comprometida en un momento puntual y un tuit específico haya salido de un tercero. Pero ese límite aplica a cualquier tuit de cualquier cuenta — y cuando los tuits forman un patrón consistente a lo largo de 14 meses, la hipótesis del hackeo sistemático se vuelve absurda.

---

## Cómo se extrajo la data

Todo el proceso de descarga se hizo desde **la consola de Firefox**, ejecutando JavaScript en una pestaña abierta en `https://web.archive.org/`. La elección no fue arbitraria: corriendo desde ese dominio, las requests al propio archive.org son *same-origin* y no se topan con bloqueos de CORS que harían imposible hacer lo mismo desde un sitio externo o desde un archivo `file://`.

El procedimiento, conceptualmente:

1. **Listar el índice de capturas con la CDX API.** La Wayback Machine expone una API documentada (`/cdx/search/cdx`) que permite consultar todas las capturas que existen para un patrón de URL. Una sola request a `https://web.archive.org/cdx/search/cdx?url=twitter.com/PeriodistaRufus/*&output=json&collapse=urlkey&fl=timestamp,original` devuelve la lista completa de URLs únicas archivadas, con su timestamp.

2. **Filtrar y deduplicar.** El índice trae todo lo que matchea el patrón (perfil, `/media`, `/likes`, tuits). De cada fila se extrae el `/status/<id>` y se descarta lo que no sea un tuit. Cuando el mismo tuit tiene varias capturas, se conserva la más reciente.

3. **Bajar el contenido archivado.** Por cada tuit único se hace una request a `https://web.archive.org/web/<timestamp>id_/https://twitter.com/PeriodistaRufus/status/<id>`. El sufijo `id_` después del timestamp es la directiva de Wayback que pide "devolveme el contenido original byte por byte, sin envolverlo en la barra de archive.org". Eso es lo que hace que recibamos el JSON crudo de la API v2 de Twitter en lugar del HTML del frontend.

4. **Combinar y bajar un único archivo.** Las respuestas se juntan en un Blob y se dispara una descarga vía `<a download>`. Resultado: un solo `periodistarufus_wayback_combined.json` con todo.

5. **Procesar a estructura final.** Una etapa de limpieza extrae los campos relevantes (texto, fecha, autor, métricas, entidades, etiquetas temáticas, tuits referenciados, links de procedencia) y produce `periodistarufus_tweets.json`, el dataset final que vive en este repo.

### Por qué archive.org tiene JSON y no HTML

Curiosidad del proceso: si abrís `https://twitter.com/PeriodistaRufus/status/<id>` hoy en un navegador común, te aparece HTML renderizado. Pero las capturas son JSON. La razón es que el crawler del Internet Archive no se identifica como un navegador común — usa un User-Agent de bot, y Twitter le respondía diferente según quién pregunte: a un humano le servía HTML, a un bot le servía la respuesta estructurada de su API v2. Para este proyecto esa decisión vieja de Twitter es ideal: en lugar de parsear HTML lleno de markup, tenemos directamente el objeto que el propio Twitter consideraba "este es el tuit", con todos los metadatos prolijos.

---

## Qué hay en este repo

```
.
├── index.html                  ← sitio web estático (todo embebido)
├── periodistarufus_tweets.json ← dataset estructurado
└── README.md                   ← este archivo
```

### `index.html`

Sitio autónomo, sin dependencias externas. Un único archivo HTML que contiene el dataset completo embebido y el JavaScript que lo renderiza. Abrilo directamente en un navegador, o subilo a cualquier hosting estático (Vercel, Netlify, GitHub Pages) y funciona.

Interfaz tipo timeline en español con:

- Búsqueda full-text que indexa simultáneamente el texto del tuit, autor, menciones, hashtags, etiquetas temáticas, títulos y descripciones de los links externos, y el cuerpo de los tuits citados o respondidos. Insensible a mayúsculas y a tildes (`peron` encuentra `Perón`).
- Filtro por tipo: originales, respuestas, citas, retweets.
- Filtro por etiqueta temática.
- Orden por fecha, likes, retweets o vistas.
- Por tuit: texto, fecha, autor, métricas, links con preview, etiquetas, y enlaces tanto al snapshot en archive.org como al tuit original en twitter.com.

Scroll infinito en lotes de 60 para mantenerlo fluido.

### `periodistarufus_tweets.json`

El dataset estructurado. Lista (`array`) de objetos donde cada objeto representa un tuit. Detalle exhaustivo de los campos abajo.

---

## Estructura del JSON

Cada elemento del array tiene los siguientes campos.

### Identificación y autoría

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | ID del tuit (el `/status/<id>` de la URL). Único, numérico aunque venga como string para no perder precisión. |
| `created_at` | string ISO-8601 | Fecha/hora UTC en que el tuit fue publicado en Twitter, no en que fue capturado. |
| `lang` | string | Código de idioma detectado por Twitter (`es`, `en`, `qme` para meme/imagen, `zxx` para contenido sin lenguaje, etc.). |
| `author_id` | string | ID interno del usuario en Twitter. |
| `author_username` | string | Handle sin `@`. |
| `author_name` | string | Nombre para mostrar. |
| `author_profile_image_url` | string \| null | URL de la foto de perfil al momento del snapshot. |
| `conversation_id` | string | ID del hilo. Si es igual a `id`, el tuit inicia su propio hilo. |
| `possibly_sensitive` | boolean | Marca de Twitter para contenido potencialmente sensible. |

### Contenido textual

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `text` | string | Texto del tuit. Si es un "long-form" (note_tweet), se usa la versión extendida; si no, el texto estándar. Conserva saltos de línea originales. |

### Métricas públicas

`public_metrics` es un objeto con:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `retweet_count` | int | Retweets. |
| `reply_count` | int | Respuestas. |
| `like_count` | int | Likes. |
| `quote_count` | int | Citas. |
| `bookmark_count` | int | Bookmarks. |
| `impression_count` | int | Impresiones (vistas). |

**Las métricas son las del momento exacto del snapshot, no las acumuladas hasta hoy.** Para tuits archivados pocos minutos después de publicarse, la mayoría figura en 0. El `retweet_count` suele tener valores reales porque los retweets son los primeros que se disparan. Recuperar las métricas finales hoy es restrictivo por la política de acceso a la API de Twitter.

### Entidades en el texto

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `urls` | array | URLs en el texto. Cada item: `short_url` (el `t.co/...`), `expanded_url` (destino real), `display_url` (versión legible), `title` y `description` (del Open Graph del destino, si Twitter lo resolvió), `media_key` (si refiere a multimedia interna de Twitter). |
| `mentions` | array | Usuarios mencionados con `@`. Cada item: `{ username, id }`. |
| `hashtags` | array | Hashtags sin el `#`. |
| `cashtags` | array | Cashtags tipo `$AAPL`, sin el `$`. |
| `annotations` | array | Entidades nombradas detectadas por Twitter (personas, lugares, organizaciones, productos…). Cada item: `{ text, type, p }` donde `p` es la probabilidad asignada. |
| `context_tags` | array | Etiquetas temáticas curadas por Twitter. Cada item: `{ domain, name }`. Ejemplos: `{Politics}`, `{Politician, Javier Milei}`. Son las que poblan el filtro de "Etiqueta" en el sitio. |

### Relaciones con otros tuits

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `referenced` | array | Tuits a los que este hace referencia. Cada item: `{ type, id, text, author_username, author_name }`. `type` puede ser `replied_to`, `quoted` o `retweeted`. `text`, `author_username` y `author_name` están si archive.org capturó al tuit referenciado dentro del mismo snapshot; si no, sólo queda el `id`. |

### Procedencia de la captura

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `wayback_ts` | string | Timestamp del snapshot en formato `YYYYMMDDhhmmss`. |
| `wayback_url` | string | URL pública de la captura, abrible en cualquier navegador. **Este es el campo que permite verificar de forma independiente que el tuit existió.** |
| `twitter_url` | string | URL original en `twitter.com`. Puede no funcionar si la cuenta o el tuit fueron borrados — para eso está `wayback_url`. |

---

## Sobre el dataset actual

- **476 tuits estructurados** (478 únicos en el índice CDX; 2 quedaron incompletos por errores 404 / cuerpo vacío en archive.org).
- Rango temporal: **1 de marzo de 2025 al 15 de mayo de 2026**.
- Idiomas: 440 español, 11 inglés, 9 meme/imagen, 5 sin contenido lingüístico, resto en portugués, catalán, italiano, etc.
- Tipos: 146 originales, 150 citas, 141 respuestas, 39 retweets.
- 246 tuits con links externos.
- 118 etiquetas temáticas únicas, encabezadas por *Politics*, *Javier Milei*, *Mauricio Macri*, *Argentina politics*, *Cristina Kirchner*, *Donald Trump*.

---

## Limitaciones honestas

- **Cobertura no exhaustiva.** El dataset incluye sólo los tuits que el crawler de archive.org alcanzó a capturar. Tuits publicados y borrados muy rápido entre dos visitas del crawler pueden no haber dejado huella. Sin acceso a la API histórica de Twitter no se puede medir qué porcentaje del total real cubrimos — pero **lo que está, está**.
- **Métricas no representan el estado final** (ver arriba).
- **Tuits referenciados pueden estar incompletos.** Si el tuit citado o respondido no estaba incluido en el snapshot, sólo conservamos su ID.
- **Algunos campos pueden faltar.** Twitter no garantizaba siempre los mismos campos en cada respuesta; el código defensivo tolera ausencias.

---

## Cómo verificar este dataset

Sin tener que confiar en este repo:

1. Abrí cualquier `wayback_url` del JSON y comprobá que archive.org sirve el mismo contenido.
2. Cruzá manualmente los tuits contra el listado completo de capturas:

   ```
   https://web.archive.org/web/*/https://twitter.com/PeriodistaRufus/*
   ```

   Los IDs del dataset deben aparecer ahí.

---

## Fuentes

- [Wayback Machine — Internet Archive](https://web.archive.org/)
- [Wayback CDX Server API — documentación](https://archive.org/developers/wayback-cdx-server.html)
- [Internet Archive — sobre la organización](https://archive.org/about/)
- [Twitter API v2 — referencia del objeto Tweet](https://developer.x.com/en/docs/x-api/data-dictionary/object-model/tweet)

---
