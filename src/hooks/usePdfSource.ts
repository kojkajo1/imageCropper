import { useCallback, useEffect, useRef, useState } from "react";
import {
  destroyPdfDocument,
  loadPdfDocument,
  renderPdfPageImage,
  type PDFDocumentProxy,
} from "../pdfUtils";

export interface PdfSourceState {
  pageCount: number;
  currentPage: number;
  previewDataUrl: string | null;
  isDocumentLoading: boolean;
  isPageRendering: boolean;
  error: string | null;
  hasDocument: boolean;
  loadFromFile: (file: File) => Promise<void>;
  setCurrentPage: (page: number) => void;
  reset: () => void;
}

export function usePdfSource(): PdfSourceState {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [isDocumentLoading, setIsDocumentLoading] = useState(false);
  const [isPageRendering, setIsPageRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renderToken = useRef(0);

  const reset = useCallback(() => {
    setPreviewDataUrl(null);
    setPageCount(0);
    setCurrentPage(1);
    setIsPageRendering(false);
    setError(null);
    setDoc((prev) => {
      if (prev) {
        destroyPdfDocument(prev);
      }
      return null;
    });
  }, []);

  const loadFromFile = useCallback(
    async (file: File) => {
      setIsDocumentLoading(true);
      try {
        reset();
        const loadedDoc = await loadPdfDocument(file);
        setDoc(loadedDoc);
        setPageCount(loadedDoc.numPages);
        setCurrentPage(1);
        setError(null);
      } catch (err) {
        console.error("PDF load error:", err);
        setError("تعذر قراءة ملف PDF. يرجى التأكد من سلامة الملف.");
        reset();
      } finally {
        setIsDocumentLoading(false);
      }
    },
    [reset]
  );

  useEffect(() => {
    if (!doc) {
      return;
    }
    let isCancelled = false;
    const token = ++renderToken.current;
    setIsPageRendering(true);
    renderPdfPageImage(doc, currentPage)
      .then((dataUrl) => {
        if (isCancelled) return;
        if (renderToken.current === token) {
          setPreviewDataUrl(dataUrl);
        }
      })
      .catch((err) => {
        console.error("PDF render error:", err);
        if (!isCancelled) {
          setError("حدث خطأ أثناء توليد معاينة الصفحة.");
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsPageRendering(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [doc, currentPage]);

  useEffect(() => {
    return () => {
      destroyPdfDocument(doc);
    };
  }, [doc]);

  return {
    pageCount,
    currentPage,
    previewDataUrl,
    isDocumentLoading,
    isPageRendering,
    error,
    hasDocument: !!doc,
    loadFromFile,
    setCurrentPage,
    reset,
  };
}

