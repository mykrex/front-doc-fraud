"use client";

// =============================================================================
// Verify page — POST /v1/verify.
// Single-column layout: form fields first, then file upload.
// Image previews are collapsible (accordion toggle per file).
// On success stores result in sessionStorage and navigates to /verify/result.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { verifyDocument, ApiError } from "@/lib/api";
import ErrorMessage from "@/components/ui/ErrorMessage";

const ACCEPTED = ".png,.jpg,.jpeg,.pdf";

export default function VerifyPage() {
  const router = useRouter();

  const [files, setFiles] = useState<File[]>([]);
  const [id, setId] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Object URLs — revoked on file list change and on unmount
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  // Which image previews are expanded (keyed by file list index)
  const [openPreviews, setOpenPreviews] = useState<Set<number>>(new Set());

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

  const canSubmit = files.length > 0 && id.trim() !== "" && !loading;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;

    const trimmedId = id.trim();
    setLoading(true);
    setError(null);
    try {
      const data = await verifyDocument({
        documentImages: files,
        id: trimmedId,
        documentType: documentType.trim() || undefined,
        fullName: fullName.trim() || undefined,
        dateOfBirth: dateOfBirth || undefined,
        gender: gender || undefined,
      });
      sessionStorage.setItem(
        "docfraud:verify_result",
        JSON.stringify({ result: data, id: trimmedId }),
      );
      router.push("/verify/result");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed.");
      setLoading(false);
    }
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setOpenPreviews(new Set());
  }

  function togglePreview(index: number) {
    setOpenPreviews((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }

  function addFiles(picked: File[]) {
    if (!picked.length) return;
    setFiles((prev) => [...prev, ...picked]);
    setOpenPreviews(new Set());
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-brand-gray dark:text-foreground">
          Verify document
        </h1>
        <p className="mt-1 text-sm text-brand-gray/60 dark:text-foreground/60">
          metadata → tampering → preprocessor → ocr → policy.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {/* ID + document type */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-brand-black dark:text-foreground">
              ID <span className="text-red-500">*</span>
            </span>
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="request or document id"
              className="h-9 rounded-md border border-brand-silver bg-white px-3 text-sm outline-none focus:border-brand-blue dark:border-blue/10 dark:bg-white/5 dark:focus:border-brand-blue"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-brand-black dark:text-foreground">
              Document type{" "}
              <span className="font-normal text-brand-gray/70 dark:text-foreground/70">
                (optional)
              </span>
            </span>
            <input
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              placeholder="e.g. passport"
              className="h-9 rounded-md border border-brand-silver bg-white px-3 text-sm outline-none focus:border-brand-blue dark:border-blue/10 dark:bg-white/5 dark:focus:border-brand-blue"
            />
          </label>
        </div>

        {/* Declared identity */}
        <div className="space-y-2 rounded-lg border border-brand-silver p-4 dark:border-blue/10">
          <div>
            <p className="text-xs font-medium text-brand-black dark:text-foreground">
              Declared identity{" "}
              <span className="font-normal text-brand-gray/70 dark:text-foreground/70">
                (optional)
              </span>
            </p>
            <p className="mt-0.5 text-xs text-brand-gray/40 dark:text-foreground/40">
              These fields are optional. When provided, the pipeline
              cross-checks the declared identity against the data extracted from
              the document.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-brand-black dark:text-foreground">
                Full name
              </span>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="as on the document"
                className="h-9 rounded-md border border-brand-silver bg-white px-3 text-sm outline-none focus:border-brand-blue dark:border-blue/10 dark:bg-white/5 dark:focus:border-brand-blue"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-brand-black dark:text-foreground">
                Date of birth
              </span>
              <input
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className="h-9 rounded-md border border-brand-silver bg-white px-3 text-sm outline-none focus:border-brand-blue dark:border-blue/10 dark:bg-white/5 dark:focus:border-brand-blue"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-brand-black dark:text-foreground">
                Gender
              </span>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="h-9 rounded-md border border-brand-silver bg-white px-3 text-sm outline-none focus:border-brand-blue dark:border-blue/10 dark:bg-white/5 dark:focus:border-brand-blue"
              >
                <option value="">select</option>
                <option value="F">Female</option>
                <option value="M">Male</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
          </div>
        </div>

        {/* File upload */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-brand-black dark:text-foreground">
            Document images <span className="text-red-500">*</span>
          </label>
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) =>
              e.key === "Enter" && fileInputRef.current?.click()
            }
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-brand-silver px-6 py-8 text-center transition-colors hover:border-brand-blue/50 hover:bg-brand-surface dark:border-blue/10 dark:hover:border-brand-blue/40"
          >
            <p className="text-sm text-brand-black dark:text-foreground">
              Click to select one or more pages
            </p>
            <p className="text-xs text-brand-gray/40 dark:text-foreground/40">
              PNG, JPG, JPEG or PDF
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            className="sr-only"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />

          {files.length > 0 && (
            <ul className="space-y-2 pt-1">
              {files.map((f, i) => {
                const isImage = f.type.startsWith("image/");
                const isOpen = openPreviews.has(i);

                return (
                  <li
                    key={`${f.name}-${i}`}
                    className="rounded-lg border border-brand-silver dark:border-blue/10"
                  >
                    {/* File row */}
                    <div className="flex items-center gap-2 px-3 py-2 text-sm">
                      {/* Toggle arrow — only for images */}
                      {isImage ? (
                        <button
                          type="button"
                          onClick={() => togglePreview(i)}
                          aria-label={
                            isOpen ? "Collapse preview" : "Expand preview"
                          }
                          className="shrink-0 text-brand-gray/40 transition-colors hover:text-brand-blue dark:text-foreground/40 dark:hover:text-brand-blue"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                            aria-hidden="true"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                      ) : (
                        /* PDF icon placeholder to keep alignment */
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="shrink-0 text-brand-gray/40 dark:text-foreground/40"
                          aria-hidden="true"
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      )}

                      <span className="min-w-0 flex-1 truncate text-brand-gray/80 dark:text-foreground/80">
                        {f.name}
                      </span>

                      <span className="shrink-0 text-xs text-brand-gray/40 dark:text-foreground/40">
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        aria-label={`Remove ${f.name}`}
                        className="shrink-0 text-brand-gray/40 transition-colors hover:text-red-500"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Collapsible image preview */}
                    {isImage && isOpen && previewUrls[i] && (
                      <div className="flex justify-center border-t border-brand-silver/50 px-3 pb-3 pt-2 dark:border-blue/[.06]">
                        <img
                          src={previewUrls[i]}
                          alt={f.name}
                          className="max-h-64 max-w-full rounded object-contain"
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && <ErrorMessage title="Verification failed" message={error} />}

        <div className="flex flex-col gap-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex h-10 w-fit items-center rounded-full bg-brand-blue px-6 text-sm font-medium text-white transition-colors hover:bg-brand-blue-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Verifying…" : "Verify"}
          </button>
          {loading && (
            <p className="text-xs text-brand-gray/40 dark:text-foreground/40">
              Running pipeline… this can take a while on the first call.
            </p>
          )}
        </div>
      </form>
    </main>
  );
}
