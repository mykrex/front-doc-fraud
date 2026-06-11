// HTTP client for the api-doc-fraud backend (/v1 API).
// See FRONTEND_INTEGRATION.md §3 for the full reference.
//
// Caveats baked into this client:
//  - No auth: no Authorization header is sent.
//  - CORS must be enabled on the backend for a browser SPA to reach it (§7).
//  - /v1/verify is slow: it uses a long timeout (see VERIFY_TIMEOUT_MS).

import axios, { AxiosError, AxiosInstance } from "axios";

import type {
  BaseVerifyResponse,
  ConfirmTemplateRequest,
  GenerateRequest,
  GenerateResponse,
  TemplateDetail,
  TemplateListParams,
  TemplateSummary,
  VerifyRequest,
} from "./types";

// Base URL is configurable via env; defaults to the local backend.
export const DEFAULT_BASE_URL = "http://localhost:8000";

export const BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_BASE_URL
).replace(/\/+$/, ""); // strip trailing slash(es)

// Timeouts (ms). /v1/verify runs a heavy pipeline; everything else is quick.
const DEFAULT_TIMEOUT_MS = 30_000;
const VERIFY_TIMEOUT_MS = 600_000; // 600 s, matches client_ui.py
const HEALTH_TIMEOUT_MS = 5_000;

const client: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/v1`,
  timeout: DEFAULT_TIMEOUT_MS,
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/** Normalized API error surfaced to the UI. */
export class ApiError extends Error {
  /** HTTP status, or 0 for network/timeout failures. */
  readonly status: number;
  /** Raw response body, if any. */
  readonly data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function toApiError(err: unknown): ApiError {
  if (axios.isAxiosError(err)) {
    const axErr = err as AxiosError;
    const status = axErr.response?.status ?? 0;
    const data = axErr.response?.data;

    let message = axErr.message;
    if (status === 0) {
      message =
        "Could not reach the backend. Is it running and is CORS enabled?";
    } else if (typeof data === "object" && data !== null && "detail" in data) {
      const detail = (data as { detail: unknown }).detail;
      message = typeof detail === "string" ? detail : JSON.stringify(detail);
    } else {
      message = friendlyStatusMessage(status) ?? message;
    }
    return new ApiError(message, status, data);
  }
  return new ApiError(
    err instanceof Error ? err.message : "Error desconocido",
    0,
  );
}

function friendlyStatusMessage(status: number): string | null {
  switch (status) {
    case 404:
      return "Resource not found (404).";
    case 409:
      return "This template already exists (409).";
    case 410:
      return "The generate_id has expired or is unknown (410). Please upload the document again.";
    case 413:
      return "The file exceeds the maximum allowed size (413).";
    case 422:
      return "Validation error (422). Please check the submitted fields.";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** GET /v1/health → "Enabled". */
export async function getHealth(): Promise<string> {
  try {
    const res = await client.get<string>("/health", {
      timeout: HEALTH_TIMEOUT_MS,
    });
    return res.data;
  } catch (err) {
    throw toApiError(err);
  }
}

// ---------------------------------------------------------------------------
// Verify (fraud detection)
// ---------------------------------------------------------------------------

/** POST /v1/verify — runs the fraud detection pipeline on one or more pages. */
export async function verifyDocument(
  req: VerifyRequest,
): Promise<BaseVerifyResponse> {
  const form = new FormData();
  for (const file of req.documentImages) {
    form.append("document_images", file);
  }
  form.append("id", req.id);
  if (req.documentType) {
    form.append("document_type", req.documentType);
  }

  try {
    const res = await client.post<BaseVerifyResponse>("/verify", form, {
      timeout: VERIFY_TIMEOUT_MS,
    });
    return res.data;
  } catch (err) {
    throw toApiError(err);
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** GET /v1/templates — list templates, optionally filtered. */
export async function listTemplates(
  params: TemplateListParams = {},
): Promise<TemplateSummary[]> {
  try {
    const res = await client.get<TemplateSummary[]>("/templates", { params });
    return res.data;
  } catch (err) {
    throw toApiError(err);
  }
}

/** GET /v1/templates/{id} — template detail (404 if not found). */
export async function getTemplate(
  templateId: string,
): Promise<TemplateDetail> {
  try {
    const res = await client.get<TemplateDetail>(
      `/templates/${encodeURIComponent(templateId)}`,
    );
    return res.data;
  } catch (err) {
    throw toApiError(err);
  }
}

/**
 * POST /v1/templates/generate — step 1: OCR a document & suggest fields.
 * No persistence; returns a short-lived generate_id to reuse in confirm.
 */
export async function generateTemplate(
  req: GenerateRequest,
): Promise<GenerateResponse> {
  const form = new FormData();
  form.append("image", req.image);
  form.append("mode", req.mode);
  if (req.mode === "manual") {
    // expected_fields is required in manual mode, sent as a JSON string.
    form.append("expected_fields", JSON.stringify(req.expectedFields ?? []));
  }

  try {
    const res = await client.post<GenerateResponse>(
      "/templates/generate",
      form,
    );
    return res.data;
  } catch (err) {
    throw toApiError(err);
  }
}

/**
 * POST /v1/templates/confirm — step 2: persist the reviewed template.
 * Returns the saved TemplateDetail (201). Pass generate_id to also store the
 * cached sample image alongside the template.
 */
export async function confirmTemplate(
  body: ConfirmTemplateRequest,
): Promise<TemplateDetail> {
  try {
    const res = await client.post<TemplateDetail>(
      "/templates/confirm",
      body,
    );
    return res.data;
  } catch (err) {
    throw toApiError(err);
  }
}

export { client as apiClient };
