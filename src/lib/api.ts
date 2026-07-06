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
  if (req.fullName) {
    form.append("full_name", req.fullName);
  }
  if (req.dateOfBirth) {
    form.append("date_of_birth", req.dateOfBirth);
  }
  if (req.gender) {
    form.append("gender", req.gender);
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

/** Returns the URL for a tampering overlay image served by GET /v1/verify/{id}/image/{filename}. */
export function getTamperingOverlayUrl(verifyId: string, filename: string): string {
  return `${BASE_URL}/v1/verify/${encodeURIComponent(verifyId)}/image/${encodeURIComponent(filename)}`;
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
export async function getTemplate(templateId: string): Promise<TemplateDetail> {
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
 * Read a generate SSE stream to completion and return the parsed GenerateResponse.
 * Caller must provide an already-successful Response object (res.ok === true).
 *
 * Protocol:
 *   ": keepalive"        → heartbeat, ignore
 *   "event: error\ndata: {...}" → server error, throw ApiError
 *   "data: {...}"        → JSON payload
 *   "data: [DONE]"       → stream complete, return last payload
 */
async function readGenerateSSE(res: Response): Promise<GenerateResponse> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let payload: GenerateResponse | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    // SSE events are delimited by blank lines (\n\n). Splitting on "\n" instead
    // breaks multi-line events like "event: error\ndata: {...}" — the event type
    // and data end up in separate iterations with no shared context.
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      let eventType = "message";
      let data: string | null = null;

      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          data = line.slice(6);
        }
        // lines starting with ":" are keepalive comments — ignore
      }

      if (data === null) continue;

      if (eventType === "error") {
        const body = JSON.parse(data) as { detail?: string };
        throw new ApiError(body.detail ?? "Processing error from server", 0);
      }

      if (data === "[DONE]") {
        if (!payload) throw new ApiError("Stream ended without a result", 0);
        return payload;
      }

      payload = JSON.parse(data) as GenerateResponse;
    }
  }

  if (!payload) throw new ApiError("Empty response from server", 0);
  return payload;
}

/**
 * Issue a fetch POST to /v1/templates/generate with an AbortController timeout.
 * Returns the raw Response if successful; throws ApiError on network/timeout/HTTP errors.
 */
async function postGenerateWithTimeout(
  form: FormData,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/v1/templates/generate`, {
      method: "POST",
      body: form,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (fetchErr) {
    if ((fetchErr as Error).name === "AbortError") {
      throw new ApiError(timeoutMessage, 0);
    }
    throw new ApiError((fetchErr as Error).message ?? "Network error", 0);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(
      friendlyStatusMessage(res.status) ?? `HTTP ${res.status}`,
      res.status,
      data,
    );
  }
  return res;
}

/**
 * POST /v1/templates/generate — step 1: OCR a document & suggest fields.
 * No persistence; returns a short-lived generate_id to reuse in confirm.
 *
 * mode=manual and mode=dots both use fetch + SSE stream reader.
 * mode=auto uses axios (plain JSON response).
 */
export async function generateTemplate(
  req: GenerateRequest,
): Promise<GenerateResponse> {
  const form = new FormData();
  form.append("image", req.image);
  form.append("mode", req.mode);

  if (req.mode === "manual") {
    // OCR without VLM; allow up to 60 s for heavy documents.
    const res = await postGenerateWithTimeout(
      form,
      60_000,
      "Request timed out (60 s). Please try again.",
    );
    return readGenerateSSE(res);
  }

  if (req.mode === "dots") {
    // DotsOCR VLM can take up to ~2 min on first load; LLM pairer adds up to 45 s.
    // Guide specifies 180 s — do not lower this.
    const res = await postGenerateWithTimeout(
      form,
      180_000,
      "Request timed out (180 s). The VLM may still be processing — please try again.",
    );
    return readGenerateSSE(res);
  }

  // auto mode — plain JSON response via axios
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
 * GET /v1/templates/session/{generate_id}/image
 * Returns an Object URL for the preprocessed image used by the OCR engine.
 * The caller is responsible for calling URL.revokeObjectURL() when done.
 *
 * Returns 404 after confirm, on session expiry, or for mode=auto sessions.
 */
export async function fetchSessionImage(generateId: string): Promise<string> {
  const url = `${BASE_URL}/v1/templates/session/${encodeURIComponent(generateId)}/image`;
  let res: Response;
  try {
    res = await fetch(url, { credentials: "include" });
  } catch (fetchErr) {
    throw new ApiError((fetchErr as Error).message ?? "Network error", 0);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const detail =
      typeof data === "object" && data !== null && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : null;
    throw new ApiError(
      detail ??
        friendlyStatusMessage(res.status) ??
        `Could not load the preprocessed image (HTTP ${res.status}).`,
      res.status,
      data,
    );
  }

  const blob = await res.blob();
  return URL.createObjectURL(blob);
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
    const res = await client.post<TemplateDetail>("/templates/confirm", body);
    return res.data;
  } catch (err) {
    throw toApiError(err);
  }
}

export { client as apiClient };
