# front-doc-fraud

Next.js frontend for the `api-doc-fraud` document fraud detection system. Allows verifying documents through the fraud detection pipeline and managing the OCR templates the pipeline uses to extract fields.

---

## Table of Contents

- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Routes and Pages](#routes-and-pages)
- [API Layer](#api-layer)
- [Shared Types](#shared-types)
- [Components](#components)
- [Design System](#design-system)
- [Development Notes](#development-notes)

---

## Requirements

- Node.js 18+
- `api-doc-fraud` backend running (default at `http://localhost:8000`)

---

## Quick Start

```bash
npm install
npm run dev        # dev server at http://localhost:3000
npm run build      # production build
npm run start      # production server
npm run lint       # ESLint
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | Backend base URL. No trailing slash. |

Create a `.env.local` file at the root:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

---

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout — Geist font + Navbar
│   ├── page.tsx                # / — Landing with links to verify and templates
│   ├── verify/
│   │   ├── page.tsx            # /verify — Verification form
│   │   └── result/
│   │       └── page.tsx        # /verify/result — Detailed report
│   └── templates/
│       ├── page.tsx            # /templates — List with filters
│       ├── new/
│       │   └── page.tsx        # /templates/new — 4-step wizard (manual mode)
│       └── [id]/
│           └── page.tsx        # /templates/:id — Template detail
├── components/
│   ├── ManualFieldMapper.tsx   # Interactive OCR mapping (manual mode)
│   ├── DotsFieldMapper.tsx     # Interactive OCR mapping (dots mode)
│   ├── SuggestionList.tsx      # Server-side suggestions panel
│   ├── AddFieldForm.tsx        # Inline form to add a field manually
│   ├── TemplateCard.tsx        # Template summary card
│   ├── VerdictBadge.tsx        # ACCEPT / REVIEW / REJECT badge
│   ├── layout/
│   │   └── Navbar.tsx
│   └── ui/
│       ├── Spinner.tsx
│       ├── ErrorMessage.tsx
│       └── EmptyState.tsx
└── lib/
    ├── api.ts                  # All backend calls
    └── types.ts                # TypeScript types (mirrors backend Pydantic schemas)
```

---

## Routes and Pages

### `/` — Landing

Static page with two navigation cards: verify a document and manage templates.

---

### `/verify` — Verification Form

Uploads one or more document files and runs the fraud detection pipeline.

**Form fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| Document images | Files (PNG/JPG/JPEG/PDF) | Yes | Document pages |
| ID | Text | Yes | Request or document ID |
| Document type | Text | No | e.g. `passport` |
| Full name | Text | No | For consistency validation |
| Date of birth | Date | No | `YYYY-MM-DD` |
| Gender | Select (F/M/OTHER) | No | |

**Flow:** On submit, calls `POST /v1/verify`, serializes the result to `sessionStorage["docfraud:verify_result"]`, and navigates to `/verify/result`.

---

### `/verify/result` — Report

Reads the result from `sessionStorage`. Redirects to `/verify` if missing.

Report sections (all collapsible):

1. **Summary** — Verdict, risk score, confidence, flags
2. **Metadata** — Suspicion score + analysis per file
3. **Tampering Analysis** — Risk label + fraud score + heatmap overlay per page
4. **Extracted Document Fields** — OCR-extracted fields in a key-value table + flags
5. **Consistency Verification** — Identity and MRZ inconsistencies (`field` / `document_value` / `packet_value`)
6. **Raw JSON** — Full backend response

---

### `/templates` — Template List

Fetches from `GET /v1/templates`. Filters: `document_type` and `country`. Results displayed in a `TemplateCard` grid.

---

### `/templates/new` — New Template Wizard (manual mode)

Generate → confirm pipeline in 4 steps:

| Step | What happens |
|---|---|
| **0 — Upload** | Select a reference image. Calls `POST /v1/templates/generate` (SSE, 60 s timeout), then `GET /session/{id}/image` for the preprocessed image. |
| **1 — Map fields** | `ManualFieldMapper` with clickable overlays on the OCR image. The user maps elements as: text field (label + value), anchor (fixed document text), or photo region. |
| **2 — Preview** | Static view of mapped regions: blue = label, green = value, dashed violet = photo. Side panel with fields, anchors, and photo region count. |
| **3 — Confirm** | Metadata form (document_type, document_name, country_iso, edition). Calls `POST /v1/templates/confirm`. Navigates to `/templates/{id}` on success. Handles 409 (duplicate) and 410 (session expired) with specific messages. |

**Session countdown:** The wizard displays the remaining generate session time (~1 hour), updated every second.

---

### `/templates/[id]` — Template Detail

Fetches from `GET /v1/templates/{id}`. Displays:

- Metadata: document_type, edition, schema_version, country, country_iso, state, doc_family, mrz_type, created_at
- Fields table: key | label | type | category
- Anchor chips
- Collapsible JSON blocks: fingerprint, field_rules, qr_config

---

## API Layer

File: `src/lib/api.ts`

All backend communication goes through this module. Uses axios for most calls and native `fetch` for SSE endpoints.

### Configuration

```ts
// Base URL read from NEXT_PUBLIC_API_BASE_URL, default http://localhost:8000
const client = axios.create({ baseURL: `${BASE_URL}/v1`, timeout: 30_000 });
```

### `ApiError`

Custom error class wrapping all backend errors:

```ts
class ApiError extends Error {
  status: number;  // HTTP status code, 0 for network/timeout failures
  data: unknown;   // raw response body
}
```

Generates user-friendly messages for 404, 409, 410, 413, 422.

### Exported Functions

#### `getHealth(): Promise<string>`
`GET /v1/health` — Checks the backend is alive. Timeout: 5 s.

---

#### `verifyDocument(req: VerifyRequest): Promise<BaseVerifyResponse>`
`POST /v1/verify` — Multipart form. Timeout: 600 s.

```ts
interface VerifyRequest {
  documentImages: File[];   // one or more pages
  id: string;               // required
  documentType?: string;
  fullName?: string;        // → full_name
  dateOfBirth?: string;     // → date_of_birth (YYYY-MM-DD)
  gender?: string;          // → gender; backend does .strip().upper()
}
```

---

#### `getTamperingOverlayUrl(verifyId, filename): string`
Builds the heatmap URL: `${BASE_URL}/v1/verify/{id}/image/{filename}`. Does not fetch — returns the URL for use in `<img src>`.

---

#### `listTemplates(params?): Promise<TemplateSummary[]>`
`GET /v1/templates` — Optional query params: `document_type`, `country`.

---

#### `getTemplate(id): Promise<TemplateDetail>`
`GET /v1/templates/{id}`

---

#### `generateTemplate(req: GenerateRequest): Promise<GenerateResponse>`
`POST /v1/templates/generate` — Multipart. Behavior depends on mode:

| Mode | Protocol | Timeout |
|---|---|---|
| `manual` | fetch + SSE | 60 s |
| `dots` | fetch + SSE | 180 s (VLM cold-start) |
| `auto` | axios JSON | 30 s |

**SSE protocol:**
- `data: {...}` → parsed and accumulated as `GenerateResponse`
- `data: [DONE]` → returns the last accumulated payload
- `event: error\ndata: {...}` → throws `ApiError`
- `: keepalive` → ignored

---

#### `fetchSessionImage(generateId): Promise<string>`
`GET /v1/templates/session/{id}/image` — Returns an Object URL (blob). The caller must call `URL.revokeObjectURL()` when done. Available only during the generate → confirm window.

---

#### `confirmTemplate(body: ConfirmTemplateRequest): Promise<TemplateDetail>`
`POST /v1/templates/confirm` — JSON. Returns 201 with the saved `TemplateDetail`.

Specific errors:
- `409` — duplicate template (same document_type / country_iso / edition)
- `410` — generate session expired

---

## Shared Types

File: `src/lib/types.ts`. Mirrors the backend Pydantic schemas.

### Enumerations

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

`MetadataFileReport`, `TamperingPage` (includes `overlay_filename?`), `PreprocessorPage`, and `OCRPage` are intentionally loose (`[key: string]: unknown`) — to be expanded when a more granular detail view is built.

### Templates

```ts
interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  category?: string | null;
  label_element_ids?: number[];   // OCRLine IDs used as the label region
  value_element_ids?: number[];   // OCRLine IDs used as the value region
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
// OCR line — manual/auto mode
interface OCRLine {
  id: number;
  text: string;
  bbox: number[][];       // 4-point polygon [[x,y],...] normalized to [0,1]
  confidence: number;
  role?: "image" | null;  // "image" = photo region detected by OpenCV
}

// OCR element — dots mode
interface OCRElement {
  id: number;
  text: string;
  category: string;
  role: "label" | "value" | "unknown";
  bbox: { x1: number; y1: number; x2: number; y2: number };
}

interface GenerateResponse {
  generate_id: string;
  expires_at: string;               // ISO datetime, TTL ~1 hour
  image_dims: [number, number];     // [width, height] in pixels
  preclass: Preclass;
  qr_config: Record<string, unknown>;
  ocr_lines: OCRLine[];
  mrz_fields?: Record<string, unknown> | null;
  suggestions: FieldSuggestion[];
  anchors_candidates: string[];
  ocr_elements?: OCRElement[];      // dots mode only
  label_elements?: OCRElement[];    // dots mode only
  value_elements?: OCRElement[];    // dots mode only
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
  fields: TemplateField[];          // keys must be unique (422 otherwise)
  anchors?: string[];
  image_regions?: { x1: number; y1: number; x2: number; y2: number }[];
  fingerprint?: Record<string, unknown>;
  field_rules?: Record<string, unknown>;
  qr_config?: Record<string, unknown>;
}
```

---

## Components

### `ManualFieldMapper`

Interactive overlay for manual mode. Renders the preprocessed image with all `ocr_lines` as clickable regions.

```ts
interface ManualFieldMapperProps {
  imageUrl: string;
  ocrLines: OCRLine[];
  onFieldsChange: (fields: TemplateField[]) => void;
  onAnchorsChange?: (anchors: string[]) => void;
  onImageRegionsChange?: (regions: { x1: number; y1: number; x2: number; y2: number }[]) => void;
}
```

**Interaction modes** (toggle in the right panel):

| Mode | Color | Behavior |
|---|---|---|
| Map fields | Indigo | Select OCR lines as label → value to create a field |
| Anchors | Amber | Mark fixed document text (e.g. "PASAPORTE") |
| Photo regions | Violet | Confirm/discard photo regions (pre-classified when `role === "image"`) |

**Exclusion rules between classifications:**
- Lines with `role === "image"` → photo regions only; cannot be fields or anchors
- Lines in anchors → cannot be fields or photo regions
- Lines in photo regions → cannot be fields or anchors
- Lines already committed to a field → cannot be reclassified

**Overlay visuals:**

| State | Appearance |
|---|---|
| Confirmed photo region | Dashed violet border + violet background |
| Discarded photo region | Dashed blue border, low opacity |
| Anchor | Amber border + light amber background |
| Selected label | Blue border + ring |
| Selected value | Green border + ring |
| Used in a field | Gray, opaque |
| Available | Subtle border; hover color adapts to active mode |

On mount, automatically pre-classifies lines with `role === "image"` as photo regions and notifies the parent via `onImageRegionsChange`.

---

### `DotsFieldMapper`

Alternative for `dots` mode. Uses `OCRElement[]` (bbox already as `{x1,y1,x2,y2}`). Auto-accepts suggestions with `confidence === "high"` or `source === "llm_pairer"` on mount. Supports selecting `type` from the full `FIELD_TYPES` dropdown.

> **Note:** Implemented but has no page consumer yet. The `/templates/new` wizard uses `manual` mode only.

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

Colors: ACCEPT = green, REVIEW = orange, REJECT = red.

---

### `Spinner`

```ts
interface SpinnerProps {
  size?: "sm" | "md" | "lg";   // default "md"
  label?: string;               // visible text next to the spinner
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
  onRetry?: () => void;      // renders a "Retry" button when provided
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

Receives `{ template: TemplateSummary }`. Link card to `/templates/{id}`. The `document_type` badge color is derived deterministically from the string.

---

### `SuggestionList` / `AddFieldForm`

Both are fully implemented but have no page consumer yet. Built for a future `auto`/`dots` template creation flow.

---

## Design System

Tailwind v4 with no `tailwind.config.*`. Tokens defined in `src/app/globals.css`:

| Token | Value | Primary use |
|---|---|---|
| `brand-blue` | `#3781c2` | Navbar, primary buttons, label overlays |
| `brand-blue-dark` | `#284b63` | Active text |
| `brand-blue-deep` | `#05668d` | Accents |
| `brand-purple` | `#662e9b` | Photo region overlays |
| `brand-teal` | `#3c6e71` | — |
| `brand-gray` | `#353535` | Primary text |
| `brand-silver` | `#7a95ab` | Borders, secondary text |
| `brand-surface` | `#eef4fb` | Card backgrounds |
| `brand-surface-alt` | `#f3f7fc` | Alternate backgrounds |

Fonts: **Geist Sans** (UI) and **Geist Mono** (code, field values) via `next/font/google`.

---

## Development Notes

### Data passing between `/verify` and `/verify/result`

The verification result is serialized to `sessionStorage["docfraud:verify_result"]` before navigating. The result page reads it on mount and redirects to `/verify` if it is missing.

### Generate session

`POST /v1/templates/generate` opens a session with a TTL of ~1 hour. The preprocessed image and the confirm endpoint are only available within that window. The wizard displays a live countdown and handles the 410 error explicitly.

### Object URLs

`fetchSessionImage` returns an Object URL created with `URL.createObjectURL()`. The wizard revokes it with `URL.revokeObjectURL()` when navigating back to step 0 or when the effect unmounts, to prevent memory leaks.

### Bbox coordinates

`OCRLine` bboxes are 4-point polygons `[[x,y],...]` normalized to `[0, 1]` relative to the image dimensions. The `polyToRect` and `enclosingRect` helpers (present in both `ManualFieldMapper` and `new/page.tsx`) convert them to `{x1, y1, x2, y2}` for positioning overlays with CSS `%`.

`OCRElement` bboxes in `dots` mode are already in `{x1, y1, x2, y2}` format.

### `image_regions` in the confirm payload

Sent as `{ x1, y1, x2, y2 }[]`, derived from `polyToRect(ocr_line.bbox)` for each line with `role === "image"`. `ManualFieldMapper` pre-classifies these lines on mount and notifies the parent via `onImageRegionsChange`.
