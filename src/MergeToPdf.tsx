import React, { useCallback, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { loadPdfDocument, renderPdfPageImage, destroyPdfDocument } from "./pdfUtils";
import { isPdfFile } from "./fileUtils";

type PageItem = {
  id: string;
  kind: "image" | "pdf-page";
  thumbnail: string;
  label: string;
  file: File;
  pageIndex?: number; // 0-based, only for kind === "pdf-page"
};

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `item-${idCounter}`;
}

async function normalizeImageToJpeg(file: File): Promise<Uint8Array> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("فشل تحويل الصورة"))), "image/jpeg", 0.95);
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export default function MergeToPdf() {
  const [items, setItems] = useState<PageItem[]>([]);
  const [outputName, setOutputName] = useState("merged");
  const [isAdding, setIsAdding] = useState(false);
  const [addProgress, setAddProgress] = useState("");
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const dragIndexRef = useRef<number | null>(null);

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    setIsAdding(true);
    setBuildError(null);

    try {
      for (const file of files) {
        if (isPdfFile(file)) {
          setAddProgress(`جارٍ قراءة ${file.name}...`);
          const doc = await loadPdfDocument(file);
          const newItems: PageItem[] = [];
          for (let p = 1; p <= doc.numPages; p++) {
            setAddProgress(`جارٍ تحميل ${file.name} — صفحة ${p} من ${doc.numPages}`);
            const thumbnail = await renderPdfPageImage(doc, p, 500);
            newItems.push({
              id: nextId(),
              kind: "pdf-page",
              thumbnail,
              label: `${file.name} — صفحة ${p}`,
              file,
              pageIndex: p - 1,
            });
          }
          destroyPdfDocument(doc);
          setItems((prev) => [...prev, ...newItems]);
        } else if (/^image\//.test(file.type)) {
          setAddProgress(`جارٍ إضافة ${file.name}...`);
          const thumbnail: string = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result as string);
            fr.onerror = reject;
            fr.readAsDataURL(file);
          });
          setItems((prev) => [
            ...prev,
            { id: nextId(), kind: "image", thumbnail, label: file.name, file },
          ]);
        }
      }
    } catch (error) {
      console.error("خطأ في إضافة الملفات:", error);
      setBuildError("تعذّر قراءة أحد الملفات. تأكد أنها صور أو ملفات PDF سليمة.");
    } finally {
      setIsAdding(false);
      setAddProgress("");
    }
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) void addFiles(e.target.files);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const moveItem = (from: number, to: number) => {
    setItems((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const onCardDragStart = (index: number) => (e: React.DragEvent) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = "move";
  };

  const onCardDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from === null || from === index) return;
    moveItem(from, index);
    dragIndexRef.current = index;
  };

  const onCardDragEnd = () => {
    dragIndexRef.current = null;
  };

  const buildPdf = async () => {
    if (!items.length) return;
    setIsBuilding(true);
    setBuildError(null);
    try {
      const outDoc = await PDFDocument.create();
      const sourceDocCache = new Map<File, PDFDocument>();

      for (const item of items) {
        if (item.kind === "pdf-page") {
          let srcDoc = sourceDocCache.get(item.file);
          if (!srcDoc) {
            const bytes = new Uint8Array(await item.file.arrayBuffer());
            srcDoc = await PDFDocument.load(bytes);
            sourceDocCache.set(item.file, srcDoc);
          }
          const [copiedPage] = await outDoc.copyPages(srcDoc, [item.pageIndex!]);
          outDoc.addPage(copiedPage);
        } else {
          const jpegBytes = await normalizeImageToJpeg(item.file);
          const jpg = await outDoc.embedJpg(jpegBytes);
          const page = outDoc.addPage([jpg.width, jpg.height]);
          page.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
        }
      }

      const pdfBytes = await outDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${outputName || "merged"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("خطأ في إنشاء PDF:", error);
      setBuildError("تعذّر إنشاء ملف PDF. تأكد أن كل الملفات صور أو PDF سليمة.");
    } finally {
      setIsBuilding(false);
    }
  };

  return (
    <div className="page">
      <div className="stage merge-stage">
        <div
          className={`dropzone ${isDragOver ? "dragover" : ""}`}
          onClick={() => document.getElementById("mergeFileInput")?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDragEnter={handleDragOver}
        >
          {isAdding ? (
            <span>⏳ {addProgress || "جارٍ الإضافة..."}</span>
          ) : (
            <span>📥 انقر أو اسحب صورًا أو ملفات PDF هنا لإضافتها (يمكن اختيار أكثر من ملف)</span>
          )}
        </div>

        {items.length > 0 && (
          <div className="merge-grid">
            {items.map((item, index) => (
              <div
                key={item.id}
                className="merge-card"
                draggable
                onDragStart={onCardDragStart(index)}
                onDragOver={onCardDragOver(index)}
                onDragEnd={onCardDragEnd}
                title="اسحب لإعادة الترتيب"
              >
                <div className="merge-card-index">{index + 1}</div>
                <img src={item.thumbnail} alt={item.label} />
                <div className="merge-card-label">{item.label}</div>
                <div className="merge-card-actions">
                  <button
                    className="mrz-copy-btn"
                    onClick={() => moveItem(index, index - 1)}
                    disabled={index === 0}
                    title="تحريك لأعلى"
                  >
                    ⬆️
                  </button>
                  <button
                    className="mrz-copy-btn"
                    onClick={() => moveItem(index, index + 1)}
                    disabled={index === items.length - 1}
                    title="تحريك لأسفل"
                  >
                    ⬇️
                  </button>
                  <button
                    className="mrz-copy-btn"
                    onClick={() => removeItem(item.id)}
                    title="حذف"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <aside className="panel">
        <h2>دمج ملفات وصور إلى PDF 📎</h2>
        <p>إنشاء المنسق محمد عليكاج تكتل المشاعر 1447هـ 2026م</p>
        <p>يقبل دمج صور (JPG/PNG) وملفات PDF (بكل صفحاتها) في ملف واحد — رتّبهم بالسحب أو بأزرار الأسهم.</p>

        <input
          id="mergeFileInput"
          type="file"
          accept="image/*,application/pdf"
          multiple
          onChange={onFileChange}
          style={{ display: "none" }}
        />
        <button
          className="btn ghost"
          onClick={() => document.getElementById("mergeFileInput")?.click()}
          disabled={isAdding}
        >
          ➕ إضافة صور / PDF
        </button>

        {items.length > 0 && (
          <div className="group" style={{ marginTop: "16px" }}>
            <label>عدد الصفحات: {items.length}</label>
          </div>
        )}

        <div className="group">
          <label>اسم الملف الناتج:</label>
          <input
            className="text"
            type="text"
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
          />
        </div>

        {buildError && <div className="mrz-error">{buildError}</div>}

        <div className="btn-row">
          <button
            className="btn success"
            onClick={buildPdf}
            disabled={!items.length || isBuilding || isAdding}
          >
            {isBuilding ? "⏳ جارٍ الإنشاء..." : "📄 دمج وتنزيل PDF"}
          </button>
          <button
            className="btn ghost"
            onClick={() => setItems([])}
            disabled={!items.length || isBuilding}
          >
            🗑️ إفراغ القائمة
          </button>
        </div>
      </aside>
    </div>
  );
}
