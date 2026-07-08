# front-doc-fraud

Frontend Next.js para el sistema de detección de fraude documental (`api-doc-fraud`). Permite verificar documentos a través del pipeline de fraud detection y gestionar las plantillas OCR que el pipeline usa para extraer campos.

---

## Índice

- [Requisitos](#requisitos)
- [Inicio rápido](#inicio-rápido)
- [Variables de entorno](#variables-de-entorno)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Rutas y páginas](#rutas-y-páginas)
- [Capa API](#capa-api)
- [Tipos compartidos](#tipos-compartidos)
- [Componentes](#componentes)
- [Design system](#design-system)
- [Notas de desarrollo](#notas-de-desarrollo)

---

## Requisitos

- Node.js 18+
- Backend `api-doc-fraud` corriendo (por defecto en `http://localhost:8000`)

---

## Inicio rápido

```bash
npm install
npm run dev        # dev server en http://localhost:3000
npm run build      # build de producción
npm run start      # servidor de producción
npm run lint       # ESLint
```

---

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | Base URL del backend. Sin trailing slash. |

Crear un archivo `.env.local` en la raíz:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

---

## Estructura del proyecto

```
src/
├── app/
│   ├── layout.tsx              # Layout raíz — Geist font + Navbar
│   ├── page.tsx                # / — Landing con links a verify y templates
│   ├── verify/
│   │   ├── page.tsx            # /verify — Formulario de verificación
│   │   └── result/
│   │       └── page.tsx        # /verify/result — Reporte detallado
│   └── templates/
│       ├── page.tsx            # /templates — Listado con filtros
│       ├── new/
│       │   └── page.tsx        # /templates/new — Wizard 4 pasos (modo manual)
│       └── [id]/
│           └── page.tsx        # /templates/:id — Detalle de plantilla
├── components/
│   ├── ManualFieldMapper.tsx   # Mapeo OCR interactivo (modo manual)
│   ├── DotsFieldMapper.tsx     # Mapeo OCR interactivo (modo dots)
│   ├── SuggestionList.tsx      # Panel de sugerencias del servidor
│   ├── AddFieldForm.tsx        # Formulario inline para agregar campo manual
│   ├── TemplateCard.tsx        # Card de resumen de plantilla
│   ├── VerdictBadge.tsx        # Badge ACCEPT / REVIEW / REJECT
│   ├── layout/
│   │   └── Navbar.tsx
│   └── ui/
│       ├── Spinner.tsx
│       ├── ErrorMessage.tsx
│       └── EmptyState.tsx
└── lib/
    ├── api.ts                  # Todas las llamadas al backend
    └── types.ts                # Tipos TypeScript (espejo de los schemas del backend)
```

---

## Rutas y páginas

### `/` — Landing

Página estática con dos cards de navegación: verificar un documento y gestionar plantillas.

---

### `/verify` — Formulario de verificación

Sube uno o más archivos de documento y corre el pipeline de fraud detection.

**Campos del formulario:**

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| Document images | Archivos (PNG/JPG/JPEG/PDF) | Sí | Páginas del documento |
| ID | Texto | Sí | ID de solicitud o documento |
| Document type | Texto | No | e.g. `passport` |
| Full name | Texto | No | Para validación de consistencia |
| Date of birth | Fecha | No | `YYYY-MM-DD` |
| Gender | Select (F/M/OTHER) | No | |

**Flujo:** Al enviar, llama a `POST /v1/verify`, serializa el resultado en `sessionStorage["docfraud:verify_result"]` y navega a `/verify/result`.

---

### `/verify/result` — Reporte

Lee el resultado de `sessionStorage`. Si no existe, redirige a `/verify`.

Secciones del reporte (todas colapsables):

1. **Summary** — Veredicto, risk score, confidence, flags
2. **Metadata** — Suspicion score + análisis por archivo
3. **Tampering Analysis** — Risk label + fraud score + heatmap overlay por página
4. **Extracted Document Fields** — Campos OCR extraídos en tabla key-value + flags
5. **Consistency Verification** — Inconsistencias de identidad y MRZ (`field` / `document_value` / `packet_value`)
6. **Raw JSON** — Respuesta completa del backend

---

### `/templates` — Listado de plantillas

Carga con `GET /v1/templates`. Filtros: `document_type` y `country`. Resultados en grid de `TemplateCard`.

---

### `/templates/new` — Wizard de nueva plantilla (modo manual)

Pipeline generate → confirm en 4 pasos:

| Paso | Qué hace |
|---|---|
| **0 — Upload** | Seleccionar imagen de referencia. Llama a `POST /v1/templates/generate` (SSE, 60 s timeout). Luego `GET /session/{id}/image` para la imagen preprocesada. |
| **1 — Map fields** | `ManualFieldMapper` con overlays clickeables sobre la imagen OCR. El usuario mapea elementos como campo de texto (label + value), anchor (texto fijo) o región de foto. |
| **2 — Preview** | Vista estática de las regiones mapeadas: azul = label, verde = value, violeta punteado = foto. Panel lateral con campos, anchors y conteo de regiones. |
| **3 — Confirm** | Formulario de metadatos (document_type, document_name, country_iso, edition). Llama a `POST /v1/templates/confirm`. Navega a `/templates/{id}` si el guardado es exitoso. Maneja 409 (duplicado) y 410 (sesión expirada) con mensajes específicos. |

**Cuenta regresiva de sesión:** el wizard muestra el tiempo restante de la sesión de generate (~1 hora) actualizado cada segundo.

---

### `/templates/[id]` — Detalle de plantilla

Carga con `GET /v1/templates/{id}`. Muestra:

- Metadata: document_type, edition, schema_version, country, country_iso, state, doc_family, mrz_type, created_at
- Tabla de campos: key | label | type | category
- Chips de anchors
- Bloques JSON colapsables: fingerprint, field_rules, qr_config

---

## Capa API

Archivo: `src/lib/api.ts`

Toda la comunicación con el backend pasa por este módulo. Usa axios para la mayoría de llamadas y `fetch` nativo para los endpoints SSE.

### Configuración

```ts
// Base URL leída de NEXT_PUBLIC_API_BASE_URL, default http://localhost:8000
const client = axios.create({ baseURL: `${BASE_URL}/v1`, timeout: 30_000 });
```

### `ApiError`

Clase de error personalizada que envuelve todos los errores del backend:

```ts
class ApiError extends Error {
  status: number;  // código HTTP, 0 para errores de red/timeout
  data: unknown;   // body de la respuesta
}
```

Genera mensajes amigables para 404, 409, 410, 413, 422.

### Funciones exportadas

#### `getHealth(): Promise<string>`
`GET /v1/health` — Verifica que el backend esté activo. Timeout: 5 s.

---

#### `verifyDocument(req: VerifyRequest): Promise<BaseVerifyResponse>`
`POST /v1/verify` — Multipart form. Timeout: 600 s.

```ts
interface VerifyRequest {
  documentImages: File[];   // una o más páginas
  id: string;               // requerido
  documentType?: string;
  fullName?: string;        // → full_name
  dateOfBirth?: string;     // → date_of_birth (YYYY-MM-DD)
  gender?: string;          // → gender; el backend hace .strip().upper()
}
```

---

#### `getTamperingOverlayUrl(verifyId, filename): string`
Construye la URL del heatmap: `${BASE_URL}/v1/verify/{id}/image/{filename}`. No hace fetch — retorna la URL para usar en `<img src>`.

---

#### `listTemplates(params?): Promise<TemplateSummary[]>`
`GET /v1/templates` — Query params opcionales: `document_type`, `country`.

---

#### `getTemplate(id): Promise<TemplateDetail>`
`GET /v1/templates/{id}`

---

#### `generateTemplate(req: GenerateRequest): Promise<GenerateResponse>`
`POST /v1/templates/generate` — Multipart. Comportamiento según modo:

| Modo | Protocolo | Timeout |
|---|---|---|
| `manual` | fetch + SSE | 60 s |
| `dots` | fetch + SSE | 180 s (cold-start del VLM) |
| `auto` | axios JSON | 30 s |

**Protocolo SSE:**
- `data: {...}` → parse acumulado como `GenerateResponse`
- `data: [DONE]` → retorna el último payload acumulado
- `event: error\ndata: {...}` → lanza `ApiError`
- `: keepalive` → ignorado

---

#### `fetchSessionImage(generateId): Promise<string>`
`GET /v1/templates/session/{id}/image` — Retorna un Object URL (blob). El caller debe llamar `URL.revokeObjectURL()` cuando termine. Disponible solo durante la ventana generate → confirm.

---

#### `confirmTemplate(body: ConfirmTemplateRequest): Promise<TemplateDetail>`
`POST /v1/templates/confirm` — JSON. Retorna 201 con el `TemplateDetail` guardado.

Errores específicos:
- `409` — plantilla duplicada (mismo document_type / country_iso / edition)
- `410` — sesión generate expirada

---

## Tipos compartidos

Archivo: `src/lib/types.ts`. Espeja los schemas Pydantic del backend.

### Enumeraciones

```ts
type Verdict      = "ACCEPT" | "REVIEW" | "REJECT"
type FieldType    = "text" | "date" | "alphanumeric" | "code" | "single_letter" | "entry_count" | "decimal" | "currency"
type GenerateMode = "auto" | "manual" | "dots"
type SuggestionConfidence = "high" | "medium" | "low"
type SuggestionSource     = "mrz" | "regex" | "spatial_match" | "vlm" | "llm_pairer"
```

### Verify

```ts
interface BaseVerifyResponse {
  risk_score?: number | null;
  flags: string[];
  confidence: number;
  verdict: Verdict;
  modules: VerifyModules;
  execution: VerifyExecution;
}

interface VerifyModules {
  metadata:     { files: MetadataFileReport[]; aggregate_suspicion: number };
  tampering:    { pages: TamperingPage[]; worst_risk_label: string; worst_fraud_score: number };
  preprocessor: { pages: PreprocessorPage[] };
  ocr:          { engine: string; pages: OCRPage[] };
}

interface VerifyExecution {
  request_id: string;
  timestamp: string;
  elapsed_ms: number;
  pipeline_version: string;
  elapsed_ms_per_stage: Record<string, number>;
}
```

`MetadataFileReport`, `TamperingPage` (incluye `overlay_filename?`), `PreprocessorPage`, `OCRPage` son intencionalmente sueltos — se expanden cuando se construya una vista de detalle más granular.

### Templates

```ts
interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  category?: string | null;
  label_element_ids?: number[];   // IDs de OCRLine del label
  value_element_ids?: number[];   // IDs de OCRLine del value
}

interface TemplateSummary {
  id: string;
  document_type: string;
  country?: string | null;
  edition: number;
  document_name: string;
  created_at?: string | null;
}

interface TemplateDetail {
  id: string;
  schema_version: number;
  document_type: string;
  document_name: string;
  country?: string | null;
  country_iso?: string | null;
  state?: string | null;
  edition: number;
  doc_family?: string | null;
  mrz_type?: string | null;
  img_path?: string | null;
  fields: TemplateField[];
  anchors: string[];
  fingerprint: Record<string, unknown>;
  field_rules: Record<string, unknown>;
  qr_config: Record<string, unknown>;
  created_at?: string | null;
}
```

### Generate / Confirm

```ts
// Línea OCR — modo manual/auto
interface OCRLine {
  id: number;
  text: string;
  bbox: number[][];       // 4 puntos [[x,y],...] normalizados [0,1]
  confidence: number;
  role?: "image" | null;  // "image" = región de foto detectada por OpenCV
}

// Elemento OCR — modo dots
interface OCRElement {
  id: number;
  text: string;
  category: string;
  role: "label" | "value" | "unknown";
  bbox: { x1: number; y1: number; x2: number; y2: number };
}

interface GenerateResponse {
  generate_id: string;
  expires_at: string;               // ISO datetime, TTL ~1 hora
  image_dims: [number, number];     // [width, height] en píxeles
  preclass: Preclass;
  qr_config: Record<string, unknown>;
  ocr_lines: OCRLine[];
  mrz_fields?: Record<string, unknown> | null;
  suggestions: FieldSuggestion[];
  anchors_candidates: string[];
  ocr_elements?: OCRElement[];      // solo modo dots
  label_elements?: OCRElement[];    // solo modo dots
  value_elements?: OCRElement[];    // solo modo dots
}

interface ConfirmTemplateRequest {
  generate_id?: string | null;
  document_type: string;            // regex: /^[a-z0-9_]{1,60}$/
  document_name: string;
  country?: string | null;
  country_iso?: string | null;      // regex: /^[A-Z]{3}$/
  state?: string | null;
  edition: number;                  // 1900–2100
  doc_family?: string | null;
  mrz_type?: string | null;
  fields: TemplateField[];          // keys deben ser únicos (422 si hay duplicados)
  anchors?: string[];
  image_regions?: { x1: number; y1: number; x2: number; y2: number }[];
  fingerprint?: Record<string, unknown>;
  field_rules?: Record<string, unknown>;
  qr_config?: Record<string, unknown>;
}
```

---

## Componentes

### `ManualFieldMapper`

Overlay interactivo para el modo manual. Muestra la imagen preprocesada con todos los `ocr_lines` como regiones clickeables.

```ts
interface ManualFieldMapperProps {
  imageUrl: string;
  ocrLines: OCRLine[];
  onFieldsChange: (fields: TemplateField[]) => void;
  onAnchorsChange?: (anchors: string[]) => void;
  onImageRegionsChange?: (regions: { x1: number; y1: number; x2: number; y2: number }[]) => void;
}
```

**Modos de interacción** (toggle en el panel derecho):

| Modo | Color | Comportamiento |
|---|---|---|
| Map fields | Indigo | Selecciona líneas OCR como label → value para crear un campo |
| Anchors | Amber | Marca textos fijos del documento (e.g. "PASAPORTE") |
| Photo regions | Violet | Confirma/descarta regiones de foto (pre-clasificadas con `role === "image"`) |

**Reglas de exclusión entre clasificaciones:**
- Líneas `role === "image"` → solo pueden ser photo regions, no campos ni anchors
- Líneas en anchors → no pueden ser campo ni photo region
- Líneas en photo regions → no pueden ser campo ni anchor
- Líneas ya usadas en un campo → no pueden reclasificarse

**Visuales de overlay:**

| Estado | Apariencia |
|---|---|
| Photo region confirmada | Borde violeta punteado + fondo violeta |
| Photo region descartada | Borde azul punteado, baja opacidad |
| Anchor | Borde amber + fondo amber claro |
| Label seleccionado | Borde azul + ring |
| Value seleccionado | Borde verde + ring |
| Usado en campo | Gris, opaco |
| Disponible | Borde sutil; hover adapta color al modo activo |

Al montar, pre-clasifica automáticamente las líneas con `role === "image"` en photo regions y notifica al padre vía `onImageRegionsChange`.

---

### `DotsFieldMapper`

Alternativa para el modo `dots`. Usa `OCRElement[]` (bbox `{x1,y1,x2,y2}` directo). Auto-acepta sugerencias con `confidence === "high"` o `source === "llm_pairer"` al montar. Soporta selección de `type` desde el dropdown completo de `FIELD_TYPES`.

> **Nota:** Implementado pero sin página consumidora. El wizard en `/templates/new` usa únicamente el modo `manual`.

---

### `VerdictBadge`

```ts
interface VerdictBadgeProps {
  verdict: Verdict;
  size?: "sm" | "md" | "lg";   // default "md"
  showDot?: boolean;            // default true
  className?: string;
}
```

Colores: ACCEPT = verde, REVIEW = naranja, REJECT = rojo.

---

### `Spinner`

```ts
interface SpinnerProps {
  size?: "sm" | "md" | "lg";   // default "md"
  label?: string;               // texto visible junto al spinner
  className?: string;
}
```

`role="status"`, `aria-live="polite"`.

---

### `ErrorMessage`

```ts
interface ErrorMessageProps {
  title?: string;            // default "Something went wrong"
  message?: React.ReactNode;
  onRetry?: () => void;      // muestra botón "Retry" si se pasa
  className?: string;
}
```

---

### `EmptyState`

```ts
interface EmptyStateProps {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}
```

---

### `TemplateCard`

Recibe `{ template: TemplateSummary }`. Card link a `/templates/{id}`. El color del badge de `document_type` se deriva deterministamente del string.

---

### `SuggestionList` / `AddFieldForm`

Implementados, sin página consumidora actualmente. Diseñados para un flujo `auto`/`dots` futuro.

---

## Design system

Tailwind v4 sin `tailwind.config.*`. Tokens definidos en `src/app/globals.css`:

| Token | Valor | Uso principal |
|---|---|---|
| `brand-blue` | `#3781c2` | Navbar, botones primarios, overlays de label |
| `brand-blue-dark` | `#284b63` | Textos activos |
| `brand-blue-deep` | `#05668d` | Acentos |
| `brand-purple` | `#662e9b` | Overlays de photo regions |
| `brand-teal` | `#3c6e71` | — |
| `brand-gray` | `#353535` | Texto principal |
| `brand-silver` | `#7a95ab` | Bordes, texto secundario |
| `brand-surface` | `#eef4fb` | Fondos de card |
| `brand-surface-alt` | `#f3f7fc` | Fondos alternativos |

Fuentes: **Geist Sans** (interfaz) y **Geist Mono** (código, valores de campos) vía `next/font/google`.

---

## Notas de desarrollo

### Paso de datos entre `/verify` y `/verify/result`

El resultado se serializa en `sessionStorage["docfraud:verify_result"]` antes de navegar. La página de resultado lo lee al montar y redirige a `/verify` si no existe.

### Sesión de generate

`POST /v1/templates/generate` abre una sesión con TTL ~1 hora. La imagen preprocesada y el endpoint de confirm solo están disponibles durante ese window. El wizard muestra un contador regresivo y maneja el error 410 explícitamente.

### Object URLs

`fetchSessionImage` retorna un Object URL. El wizard lo revoca con `URL.revokeObjectURL()` al volver al paso 0 o al desmontar el efecto, para evitar memory leaks.

### Coordenadas de bbox

Los bboxes de `OCRLine` son polígonos de 4 puntos `[[x,y],...]` normalizados a `[0, 1]`. Los helpers `polyToRect` y `enclosingRect` (en `ManualFieldMapper` y `new/page.tsx`) los convierten a `{x1, y1, x2, y2}` para posicionar overlays con CSS `%`.

Los `OCRElement` del modo `dots` ya vienen en formato `{x1, y1, x2, y2}` directamente.

### `image_regions` en el confirm payload

Se envían como `{ x1, y1, x2, y2 }[]`, derivados de `polyToRect(ocr_line.bbox)` para cada línea con `role === "image"`. El `ManualFieldMapper` pre-clasifica estas líneas al montar y notifica al padre vía `onImageRegionsChange`.
