// Type definitions for the api-doc-fraud backend (/v1 API).
// Mirrors the Pydantic schemas described in FRONTEND_INTEGRATION.md §4.

// ---------------------------------------------------------------------------
// Verify (fraud detection)
// ---------------------------------------------------------------------------

export type Verdict = "ACCEPT" | "REVIEW" | "REJECT";

// Detailed per-module reports. Only needed for a drill-down report view; the
// flat fields on BaseVerifyResponse cover most UI needs. Kept loose on purpose
// — expand these if/when a detailed report view is built.
export interface MetadataFileReport {
  [key: string]: unknown;
}

export interface TamperingPage {
  overlay_filename?: string | null;
  [key: string]: unknown;
}

export interface PreprocessorPage {
  [key: string]: unknown;
}

export interface OCRPage {
  [key: string]: unknown;
}

export interface VerifyModules {
  metadata: { files: MetadataFileReport[]; aggregate_suspicion: number };
  tampering: { pages: TamperingPage[]; worst_risk_label: string; worst_fraud_score: number };
  preprocessor: { pages: PreprocessorPage[] };
  ocr: { engine: string; pages: OCRPage[] };
}

export interface VerifyExecution {
  request_id: string;
  timestamp: string;
  elapsed_ms: number;
  pipeline_version: string;
  elapsed_ms_per_stage: Record<string, number>; // metadata | tampering | preprocessor | ocr
}

export interface BaseVerifyResponse {
  risk_score?: number | null;
  flags: string[];
  confidence: number;
  verdict: Verdict;
  modules: VerifyModules;
  execution: VerifyExecution;
}

export interface VerifyRequest {
  documentImages: File[]; // one or more pages
  id: string; // required
  documentType?: string; // optional, e.g. "passport"
  fullName?: string; // optional — sent as full_name
  dateOfBirth?: string; // optional — sent as date_of_birth (YYYY-MM-DD)
  gender?: string; // optional — sent as gender; backend does .strip().upper()
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export type FieldType =
  | "text"
  | "date"
  | "alphanumeric"
  | "code"
  | "single_letter"
  | "entry_count"
  | "decimal"
  | "currency";

export const FIELD_TYPES: FieldType[] = [
  "text",
  "date",
  "alphanumeric",
  "code",
  "single_letter",
  "entry_count",
  "decimal",
  "currency",
];

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType; // default "text"; validated server-side
  category?: string | null;
  label_element_ids?: number[]; // element IDs used as label (manual/dots mode)
  value_element_ids?: number[]; // element IDs used as value (manual/dots mode)
}

export interface TemplateSummary {
  id: string; // slug, e.g. "passport_MEX_2020"
  document_type: string;
  country?: string | null;
  edition: number;
  document_name: string;
  created_at?: string | null; // ISO datetime
}

export interface TemplateDetail {
  id: string;
  schema_version: number; // currently 2
  document_type: string;
  document_name: string;
  country?: string | null;
  country_iso?: string | null; // ISO 3166-1 alpha-3
  state?: string | null;
  edition: number;
  doc_family?: string | null;
  mrz_type?: string | null; // e.g. "TD3"
  img_path?: string | null; // path to the stored sample image
  fields: TemplateField[];
  anchors: string[];
  fingerprint: Record<string, unknown>; // e.g. { layout_desc: "…" }
  field_rules: Record<string, unknown>;
  qr_config: Record<string, unknown>; // e.g. { present: false, signed: false }
  created_at?: string | null;
}

export interface TemplateListParams {
  document_type?: string;
  country?: string;
}

// ---------------------------------------------------------------------------
// Template generation (step 1: generate → step 2: confirm)
// ---------------------------------------------------------------------------

export type GenerateMode = "auto" | "manual" | "dots";

// expected_fields entries when calling generate in "manual" mode.

// OCR element returned by the dots mode — one detected text block with a
// normalized bounding box (0.0–1.0 relative to image_dims).
export interface OCRElement {
  id: number;
  text: string;
  category: string;
  role: "label" | "value" | "unknown";
  bbox: { x1: number; y1: number; x2: number; y2: number };
}

export interface ExpectedField {
  key: string;
  label: string;
  type: FieldType | string;
}

// Bounding box: 4 corner points [x, y], normalized to [0, 1].
// Order: top-left, top-right, bottom-right, bottom-left (a polygon).
export type BBox = number[][];

export interface OCRLine {
  id: number; // index, referenced by suggestions
  text: string;
  bbox: BBox;
  confidence: number; // 0–1
}

export type SuggestionConfidence = "high" | "medium" | "low";
export type SuggestionSource = "mrz" | "regex" | "spatial_match" | "vlm" | "llm_pairer";

export interface FieldSuggestion {
  key: string;
  label: string;
  type: string;
  value_preview?: string | null;
  label_element_id?: number | null; // → OCRElement.id of the label
  value_element_ids: number[]; // → OCRElement.id(s) of the value
  confidence: SuggestionConfidence;
  source: SuggestionSource;
}

export interface Preclass {
  doc_family?: string | null;
  country_iso?: string | null;
  mrz_type?: string | null;
  confidence?: number | null;
}

export interface GenerateResponse {
  generate_id: string; // hold this for the confirm step
  expires_at: string; // ISO datetime; ~1h TTL
  image_dims: [number, number]; // [width, height] in pixels
  preclass: Preclass;
  qr_config: Record<string, unknown>;
  ocr_lines: OCRLine[]; // every detected line + its box (auto/manual modes)
  mrz_fields?: Record<string, unknown> | null; // decoded MRZ, if present
  suggestions: FieldSuggestion[];
  anchors_candidates: string[];
  ocr_elements?: OCRElement[];    // dots mode: all detected text blocks with normalized bboxes
  label_elements?: OCRElement[];  // dots mode: subset with role="label"
  value_elements?: OCRElement[];  // dots mode: subset with role="value"
}

export interface GenerateRequest {
  image: File; // required
  mode: GenerateMode; // required
  expectedFields?: ExpectedField[]; // unused in manual mode; kept for compatibility
}

export interface ConfirmTemplateRequest {
  generate_id?: string | null; // from GenerateResponse — persists the cached image
  document_type: string; // VALIDATED: /^[a-z0-9_]{1,60}$/ (snake_case)
  document_name: string;
  country?: string | null;
  country_iso?: string | null; // VALIDATED: /^[A-Z]{3}$/ (ISO alpha-3)
  state?: string | null;
  edition: number; // VALIDATED: 1900 ≤ edition ≤ 2100
  doc_family?: string | null;
  mrz_type?: string | null;
  fields: TemplateField[]; // field keys must be UNIQUE (422 otherwise)
  anchors?: string[];
  fingerprint?: Record<string, unknown>;
  field_rules?: Record<string, unknown>;
  qr_config?: Record<string, unknown>;
}
