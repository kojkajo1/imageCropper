import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";

if (!GlobalWorkerOptions.workerSrc) {
  GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

export async function loadPdfDocument(file: File): Promise<PDFDocumentProxy> {
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  const task = getDocument({ data });
  return task.promise;
}

export async function renderPdfPageImage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  targetMaxDimension = 2200
): Promise<string> {
  const safePageNumber = Math.max(1, Math.min(pageNumber, doc.numPages));
  const page = await doc.getPage(safePageNumber);
  const initialViewport = page.getViewport({ scale: 1 });
  const dominant = Math.max(initialViewport.width, initialViewport.height);
  const preferredScale = dominant > 0 ? Math.min(targetMaxDimension / dominant, 3) : 1.5;
  const viewport = page.getViewport({ scale: Math.max(preferredScale, 1) });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("فشل في إنشاء عنصر canvas لعرض صفحة PDF");
  }

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.94);
}

export function destroyPdfDocument(doc: PDFDocumentProxy | null) {
  if (doc) {
    try {
      doc.destroy();
    } catch (error) {
      console.warn("تعذر تدمير مستند PDF:", error);
    }
  }
}

export type { PDFDocumentProxy };

