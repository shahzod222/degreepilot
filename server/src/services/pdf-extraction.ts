import "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** One page stays separate so the LLM can cite the source of each claim. */
export interface PdfPageText {
  page: number; // 1-based, like the PDF viewer
  text: string;
}

export interface ExtractedPdf {
  pageCount: number;
  pages: PdfPageText[];
  text: string; // page-labeled text for the LLM
}

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 60;

/**
 * Extract searchable text without storing the PDF.
 * We do not OCR scans, interpret courses, or call an LLM here.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractedPdf> {
  if (!buffer.length || buffer.length > MAX_PDF_BYTES) {
    throw new Error("PDF must be between 1 byte and 15 MB.");
  }
  if (!buffer.subarray(0, 1024).toString("latin1").includes("%PDF-")) {
    throw new Error("The uploaded file is not a PDF.");
  }

  // pdfjs-dist needs a Uint8Array and may transfer its underlying buffer.
  const data = new Uint8Array(buffer);
  const loadingTask = getDocument({ data, useSystemFonts: true });

  try {
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PAGES) {
      throw new Error(`PDF exceeds the ${MAX_PAGES}-page limit.`);
    }

    const pages: PdfPageText[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();

      // Collect text fragments by their visual Y coordinate, then X coordinate.
      // DegreeWorks puts course names, grades, and credits in aligned columns.
      const rows: Array<{
        y: number;
        fragments: Array<{ x: number; text: string }>;
      }> = [];

      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const x = item.transform[4];
        const y = item.transform[5];

        let row = rows.find((existing) => Math.abs(existing.y - y) < 2);
        if (!row) {
          row = { y, fragments: [] };
          rows.push(row);
        }
        row.fragments.push({ x, text: item.str });
      }

      const lines = rows
        .sort((a, b) => b.y - a.y)
        .map((row) =>
          row.fragments
            .sort((a, b) => a.x - b.x)
            .map((part) => part.text.trim())
            .filter(Boolean)
            .join(" "),
        )
        .filter(Boolean);

      pages.push({ page: pageNumber, text: lines.join("\n") });
      page.cleanup();
    }

    if (pages.every((page) => page.text.trim().length < 40)) {
      throw new Error(
        "No searchable text found. Scanned PDFs are not supported yet.",
      );
    }

    return {
      pageCount: pages.length,
      pages,
      text: pages
        .map((page) => `[PAGE ${page.page}]\n${page.text}`)
        .join("\n\n"),
    };
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * Best-effort cleanup before an eventual LLM call. Not a guaranteed PII scrub.
 * Do not log the original PDF text or treat this as a security boundary.
 */
export function redactCommonStudentIdentifiers(text: string): string {
  return text
    .replace(/^Student name\s+.*$/gim, "Student name [REDACTED]")
    .replace(/^Student ID\s+.*$/gim, "Student ID [REDACTED]")
    .replace(/^(.+?)\s+-\s+\d{7,12}\s*$/gm, "$1 [ID REDACTED]")
    .replace(/\b\d{7,12}\b/g, "[ID REDACTED]");
}
