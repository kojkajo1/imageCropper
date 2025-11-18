import React from "react";

interface PdfPageControlsProps {
  label?: string;
  pageCount: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  previewDataUrl: string | null;
  isDocumentLoading: boolean;
  isPageRendering: boolean;
  error?: string | null;
  onReset?: () => void;
}

export default function PdfPageControls({
  label = "صفحات PDF",
  pageCount,
  currentPage,
  onPageChange,
  previewDataUrl,
  isDocumentLoading,
  isPageRendering,
  error,
  onReset,
}: PdfPageControlsProps) {
  if (pageCount <= 0) {
    return null;
  }

  return (
    <div className="group pdf-controls">
      <div className="pdf-controls__header">
        <label>{label}</label>
        {onReset && (
          <button className="btn ghost" onClick={onReset} style={{ minWidth: "120px" }}>
            إغلاق ملف PDF
          </button>
        )}
      </div>

      <div className="pdf-controls__slider">
        <input
          type="range"
          min={1}
          max={pageCount}
          value={currentPage}
          onChange={(e) => onPageChange(Number(e.target.value))}
          disabled={isDocumentLoading}
        />
        <div className="pdf-controls__info">
          الصفحة {currentPage} من {pageCount}
        </div>
      </div>

      {(isDocumentLoading || isPageRendering) && (
        <div className="pdf-controls__status">⏳ يتم تجهيز الصفحة المختارة...</div>
      )}

      {error && <div className="pdf-controls__error">{error}</div>}

      {previewDataUrl && (
        <div className="pdf-preview">
          <img src={previewDataUrl} alt={`PDF page ${currentPage}`} />
        </div>
      )}
    </div>
  );
}

