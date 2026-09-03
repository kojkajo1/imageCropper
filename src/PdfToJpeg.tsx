import React, { useState, useEffect } from "react";
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore
import JSZip from "jszip";

// استخدام worker من public folder

interface PageImage {
  dataUrl: string;
  pageNumber: number;
  width: number;
  height: number;
}

export default function PdfToJpeg() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageImage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // تعيين worker path
  useEffect(() => {
    // استخدام worker من public folder
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || file.type !== "application/pdf") {
      alert("يرجى اختيار ملف PDF");
      return;
    }
    setPdfFile(file);
    setPages([]);
    setProgress(0);
    await convertPdfToImages(file);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || file.type !== "application/pdf") {
      alert("يرجى إسقاط ملف PDF");
      return;
    }
    setPdfFile(file);
    setPages([]);
    setProgress(0);
    await convertPdfToImages(file);
  };

  const convertPdfToImages = async (file: File) => {
    setIsProcessing(true);
    setProgress(0);
    try {
      const arrayBuffer = await file.arrayBuffer();
      
      // التأكد من أن worker path معين
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      }
      
      const loadingTask = pdfjsLib.getDocument({ 
        data: arrayBuffer,
        useSystemFonts: true
      });
      
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;
      setTotalPages(numPages);
      const pageImages: PageImage[] = [];

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        try {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 2.0 }); // scale 2.0 للحصول على دقة عالية

          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          if (!context) {
            console.error(`فشل في الحصول على context للصفحة ${pageNum}`);
            continue;
          }

          canvas.width = viewport.width;
          canvas.height = viewport.height;

          const renderContext = {
            canvasContext: context,
            viewport: viewport,
            canvas: canvas,
          };

          await page.render(renderContext).promise;

          const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
          pageImages.push({
            dataUrl,
            pageNumber: pageNum,
            width: canvas.width,
            height: canvas.height,
          });

          setProgress((pageNum / numPages) * 100);
          setPages([...pageImages]);
        } catch (pageError) {
          console.error(`خطأ في تحويل الصفحة ${pageNum}:`, pageError);
          // نستمر مع الصفحات الأخرى
        }
      }

      if (pageImages.length === 0) {
        throw new Error("فشل في تحويل أي صفحة من PDF");
      }

      setIsProcessing(false);
    } catch (error: any) {
      console.error("خطأ في تحويل PDF:", error);
      const errorMessage = error?.message || "حدث خطأ غير معروف";
      alert(`حدث خطأ في تحويل PDF: ${errorMessage}. يرجى المحاولة مرة أخرى.`);
      setIsProcessing(false);
      setProgress(0);
    }
  };

  const downloadImage = (page: PageImage) => {
    const link = document.createElement("a");
    link.href = page.dataUrl;
    link.download = `page-${page.pageNumber}.jpg`;
    link.click();
  };

  const downloadAll = async () => {
    if (pages.length === 0) return;

    // استخدام JSZip لإنشاء ملف مضغوط
    try {
      const zip = new JSZip();

      for (const page of pages) {
        // تحويل dataUrl إلى blob
        const response = await fetch(page.dataUrl);
        const blob = await response.blob();
        zip.file(`page-${page.pageNumber}.jpg`, blob);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${pdfFile?.name.replace(".pdf", "") || "pdf-pages"}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("خطأ في إنشاء الملف المضغوط:", error);
      // في حالة فشل JSZip، ننزل الصور واحدة تلو الأخرى
      alert("جارٍ تنزيل الصور واحدة تلو الأخرى...");
      for (const page of pages) {
        setTimeout(() => downloadImage(page), 100);
      }
    }
  };

  return (
    <div className="page">
      <div className="stage">
        <div
          className="dropzone"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => document.getElementById("pdfInput")?.click()}
        >
          {isProcessing ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "18px", marginBottom: "10px" }}>⏳ جاري التحويل...</div>
              <div style={{ 
                width: "300px", 
                height: "20px", 
                background: "#203049", 
                borderRadius: "10px",
                overflow: "hidden",
                margin: "0 auto"
              }}>
                <div style={{
                  width: `${progress}%`,
                  height: "100%",
                  background: "#42b7ff",
                  transition: "width 0.3s"
                }}></div>
              </div>
              <div style={{ marginTop: "10px", fontSize: "14px" }}>
                {Math.round(progress)}% - صفحة {pages.length} من {totalPages}
              </div>
            </div>
          ) : (
            <span>📄 اسحب ملف PDF هنا أو انقر للرفع</span>
          )}
        </div>
      </div>

      <aside className="panel">
        <h2>تحويل PDF إلى JPEG 📄</h2>
        <p>إنشاء المنسق محمد عليكاج تكتل المشاعر 1447هـ 2026م</p>
        <p>تحويل ملف PDF إلى صور JPEG بدقتها الأصلية</p>

        <input
          id="pdfInput"
          type="file"
          accept="application/pdf"
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />

        <button
          className="btn ghost"
          onClick={() => document.getElementById("pdfInput")?.click()}
          disabled={isProcessing}
        >
          {pdfFile ? "🔄 اختر ملف PDF آخر" : "📤 اختر ملف PDF"}
        </button>

        {pdfFile && (
          <div className="group" style={{ marginTop: "16px" }}>
            <label>الملف المحدد:</label>
            <div style={{ 
              padding: "10px", 
              background: "#0b1220", 
              border: "1px solid #203049", 
              borderRadius: "8px",
              fontSize: "13px",
              color: "#cfe9ff"
            }}>
              {pdfFile.name}
            </div>
          </div>
        )}

        {pages.length > 0 && (
          <>
            <div className="group" style={{ marginTop: "16px" }}>
              <label>عدد الصفحات: {pages.length}</label>
            </div>

            <div className="btn-row">
              <button className="btn" onClick={downloadAll}>
                💾 تنزيل الكل (ZIP)
              </button>
            </div>

            <div className="preview" style={{ marginTop: "16px" }}>
              <div className="pv-head">
                <span>معاينة الصفحات</span>
              </div>
              <div style={{
                maxHeight: "400px",
                overflowY: "auto",
                background: "#0b1220",
                border: "1px solid #203049",
                borderRadius: "12px",
                padding: "10px"
              }}>
                {pages.map((page) => (
                  <div
                    key={page.pageNumber}
                    style={{
                      marginBottom: "15px",
                      padding: "10px",
                      background: "#0f1729",
                      border: "1px solid #203049",
                      borderRadius: "8px"
                    }}
                  >
                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "8px"
                    }}>
                      <span style={{ fontSize: "13px", color: "#9fb3ce" }}>
                        صفحة {page.pageNumber} ({page.width}×{page.height}px)
                      </span>
                      <button
                        className="btn ghost"
                        onClick={() => downloadImage(page)}
                        style={{ padding: "5px 10px", fontSize: "12px" }}
                      >
                        💾 تنزيل
                      </button>
                    </div>
                    <img
                      src={page.dataUrl}
                      alt={`Page ${page.pageNumber}`}
                      style={{
                        maxWidth: "100%",
                        height: "auto",
                        borderRadius: "6px",
                        border: "1px solid #203049"
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

