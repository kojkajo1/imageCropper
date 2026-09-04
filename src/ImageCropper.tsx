import React, { useState, useCallback, useEffect, useRef } from "react";
import Cropper, { Area } from "react-easy-crop";
import { usePdfSource } from "./hooks/usePdfSource";
import PdfPageControls from "./PdfPageControls";
import { getBaseFileName, isPdfFile, readFileAsDataUrl } from "./fileUtils";

function getRadianAngle(deg: number) {
  return (deg * Math.PI) / 180;
}

function rotateSize(width: number, height: number, rotation: number) {
  const rotRad = getRadianAngle(rotation);
  return {
    width: Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height: Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  };
}

async function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function getCroppedCanvas(
  imageSrc: string,
  crop: Area,
  rotation = 0,
  outW: number,
  outH: number
): Promise<HTMLCanvasElement> {
  const image = await createImage(imageSrc);
  const rotRad = getRadianAngle(rotation);
  const { width: rotW, height: rotH } = rotateSize(image.width, image.height, rotation);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  canvas.width = rotW;
  canvas.height = rotH;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // ملء الخلفية باللون الأبيض
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, rotW, rotH);

  ctx.translate(rotW / 2, rotH / 2);
  ctx.rotate(rotRad);
  ctx.translate(-image.width / 2, -image.height / 2);
  ctx.drawImage(image, 0, 0);

  const output = document.createElement("canvas");
  output.width = outW;
  output.height = outH;
  const octx = output.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";

  // ملء الخلفية باللون الأبيض
  octx.fillStyle = "white";
  octx.fillRect(0, 0, outW, outH);

  octx.drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, outW, outH);

  return output;
}

async function compressToTarget(canvas: HTMLCanvasElement, targetBytes: number): Promise<Blob> {
  const encode = (quality: number) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) {
            resolve(b);
          } else {
            reject(new Error("فشل في تحويل canvas إلى blob"));
          }
        },
        "image/jpeg",
        quality
      );
    });

  // الهدف: أعلى جودة ممكنة بحجم أقل صراحةً من targetBytes (Strictly <) — لا يساوي ولا يتجاوز.
  // حد أدنى للجودة (60%) للحفاظ على وضوح الصورة، حتى لو تطلّب الأمر تجاوز الحجم المطلوب
  // بحالات نادرة جداً (صورة كبيرة/معقدة جداً بالنسبة للحجم المطلوب).
  const MIN_QUALITY = 0.6;
  let low = MIN_QUALITY;
  let high = 0.99;
  let bestBlob: Blob | null = null;

  const highCandidate = await encode(high);
  if (highCandidate.size < targetBytes) {
    bestBlob = highCandidate;
  }

  for (let i = 0; i < 40 && high - low > 0.002; i++) {
    const mid = (low + high) / 2;
    const candidate = await encode(mid);
    if (candidate.size < targetBytes) {
      bestBlob = candidate;
      low = mid;
    } else {
      high = mid;
    }
  }

  if (bestBlob) return bestBlob;

  // حتى عند الحد الأدنى للجودة (60%) الحجم لا يزال أكبر من المطلوب — حالة نادرة جداً.
  // نعيد هذه الجودة كملاذ أخير للحفاظ على الوضوح بدل الاستمرار بخفض الجودة أكثر.
  return await encode(MIN_QUALITY);
}

export default function ImageCropper() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [fileName, setFileName] = useState("image");
  const [frameW, setFrameW] = useState(165);
  const [frameH, setFrameH] = useState(185);
  const [aspect, setAspect] = useState(165 / 185);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [zoomSliderValue, setZoomSliderValue] = useState(0);
  const [baseRotation, setBaseRotation] = useState(0);
  const [sliderRotation, setSliderRotation] = useState(0);
  const [targetSliderRotation, setTargetSliderRotation] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [targetSize, setTargetSize] = useState(18);
  const [sizeUnit, setSizeUnit] = useState<"KB" | "MB">("KB");
  const [finalSizeBytes, setFinalSizeBytes] = useState<number | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [fileNameEdited, setFileNameEdited] = useState(false);
  const [pdfBaseName, setPdfBaseName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [isHandlingFile, setIsHandlingFile] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const resetView = useCallback(() => {
    setZoom(1);
    setZoomSliderValue(0);
    setBaseRotation(0);
    setTargetSliderRotation(0);
    setSliderRotation(0);
    setCrop({ x: 0, y: 0 });
  }, []);

  const {
    pageCount: pdfPageCount,
    currentPage: pdfCurrentPage,
    previewDataUrl: pdfPreviewDataUrl,
    isDocumentLoading: isPdfDocumentLoading,
    isPageRendering: isPdfPageRendering,
    error: pdfError,
    hasDocument: pdfHasDocument,
    loadFromFile: loadPdfFile,
    setCurrentPage: setPdfCurrentPage,
    reset: resetPdfSource,
  } = usePdfSource();

  // مركز الدوران/الزوم = نقطة الصورة الظاهرة حالياً في وسط الإطار (crop.x, crop.y).
  // بما أن react-easy-crop يدوّر ويكبّر الصورة حول مركزها الهندسي دائماً بغض النظر
  // عن مقدار السحب، نعوّض بتدوير/تحجيم متجه السحب نفسه بنفس المقدار حتى تبقى نفس
  // النقطة (اللي كانت موجودة بمكان الفريم) هي محور الدوران والزوم دائماً.
  const prevRotationRef = useRef(0);
  const prevZoomRef = useRef(1);

  // حساب rotation الكلي من baseRotation + sliderRotation
  useEffect(() => {
    const newRotation = baseRotation + sliderRotation;
    const deltaDeg = newRotation - prevRotationRef.current;
    if (deltaDeg !== 0) {
      const rad = (deltaDeg * Math.PI) / 180;
      setCrop((c) => ({
        x: c.x * Math.cos(rad) - c.y * Math.sin(rad),
        y: c.x * Math.sin(rad) + c.y * Math.cos(rad),
      }));
    }
    prevRotationRef.current = newRotation;
    setRotation(newRotation);
  }, [baseRotation, sliderRotation]);

  useEffect(() => {
    const ratio = zoom / prevZoomRef.current;
    if (ratio !== 1 && Number.isFinite(ratio)) {
      setCrop((c) => ({ x: c.x * ratio, y: c.y * ratio }));
    }
    prevZoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    let raf = 0;
    const animate = () => {
      setSliderRotation((r) => {
        const diff = targetSliderRotation - r;
        if (Math.abs(diff) < 0.01) return targetSliderRotation;
        return r + diff * 0.15;
      });
      raf = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(raf);
  }, [targetSliderRotation]);

  const onCropComplete = useCallback((_a: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleFileSelection = useCallback(
    async (file: File) => {
      setIsHandlingFile(true);
      setFileError(null);
      setFileNameEdited(false);
      const baseName = getBaseFileName(file);

      try {
        setFileName(baseName);
        setPreviewDataUrl(null);
        setPreviewBlob(null);
        setFinalSizeBytes(null);
        setCroppedAreaPixels(null);
        resetView();

        if (isPdfFile(file)) {
          setPdfBaseName(baseName);
          await loadPdfFile(file);
        } else {
          setPdfBaseName("");
          resetPdfSource();
          const dataUrl = await readFileAsDataUrl(file);
          setImageSrc(dataUrl);
        }
      } catch (error) {
        console.error("File selection error:", error);
        setFileError("تعذر قراءة الملف. يرجى المحاولة مرة أخرى.");
      } finally {
        setIsHandlingFile(false);
      }
    },
    [resetView, loadPdfFile, resetPdfSource]
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void handleFileSelection(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFileSelection(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isDragOver) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!imageSrc) return;
    e.preventDefault();
    e.stopPropagation();
    // نحدّ من مقدار كل نبضة سكرول (بعض أجهزة التتبّع (trackpad) ترسل قفزات
    // كبيرة جداً دفعة واحدة أثناء السحب السريع) حتى لا تُحدث قفزة تكبير مفاجئة.
    const delta = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100);

    // تكبير/تصغير نسبي (أسّي) بدل الجمعي: نفس الإحساس بالسرعة في كل مستويات
    // التكبير، بنفس الطريقة المستخدمة في محرري الصور الاحترافية — أكثر سلاسة
    // واتساقاً من صيغة الجذر التربيعي السابقة، وبسرعة أهدأ تشبه تكبير ويندوز.
    const ZOOM_SENSITIVITY = 0.00055;
    const factor = Math.exp(-delta * ZOOM_SENSITIVITY);

    setZoom((prev) => Math.min(Math.max(prev * factor, 0.1), 20));
  };

  const applyFrame = () => setAspect(frameW / frameH);
  const applyPreset = (
    width: number,
    height: number,
    targetSizeVal?: number,
    unit?: "KB" | "MB"
  ) => {
    setFrameW(width);
    setFrameH(height);
    setAspect(width / height);
    if (targetSizeVal !== undefined) setTargetSize(targetSizeVal);
    if (unit !== undefined) setSizeUnit(unit);
  };
  const presetPortrait = () => applyPreset(165, 185, 18, "KB");
  const presetLarge640 = () => applyPreset(480, 640, 1, "MB");
  const presetPassportPage = () => applyPreset(1200, 1700, 1, "MB");
  const presetA4 = () => applyPreset(1733, 2389, 1, "MB");

  useEffect(() => {
    const mapped = (zoom - 1) * 100;
    const clamped = Math.min(Math.max(mapped, -70), 1900);
    setZoomSliderValue(clamped);
  }, [zoom]);

  useEffect(() => {
    if (!pdfPreviewDataUrl) return;
    setImageSrc(pdfPreviewDataUrl);
    setCroppedAreaPixels(null);
    setPreviewDataUrl(null);
    setPreviewBlob(null);
    setFinalSizeBytes(null);
    resetView();
  }, [pdfPreviewDataUrl, resetView]);

  useEffect(() => {
    if (!pdfHasDocument || !pdfBaseName || fileNameEdited) return;
    setFileName(`${pdfBaseName}-page-${pdfCurrentPage}`);
  }, [pdfHasDocument, pdfBaseName, pdfCurrentPage, fileNameEdited]);

  // ملاحظة: لا حاجة لإعادة ضبط crop هنا — الـ useEffect الخاص بالدوران (أعلاه)
  // يعوّض متجه السحب تلقائياً حول نفس نقطة الإطار الحالية عند أي تغيير بالزاوية.
  const rotate90Right = () => {
    setBaseRotation(baseRotation + 90);
    setTargetSliderRotation(0);
    setSliderRotation(0);
  };

  const rotate90Left = () => {
    setBaseRotation(baseRotation - 90);
    setTargetSliderRotation(0);
    setSliderRotation(0);
  };

  const handleZoomSlider = (val: number) => {
    const clamped = Math.min(Math.max(val, -70), 1900);
    setZoomSliderValue(clamped);
    const mappedZoom = Math.min(Math.max(1 + clamped / 100, 0.3), 20);
    setZoom(mappedZoom);
  };

  const doCropAndCompress = async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    const out = await getCroppedCanvas(imageSrc, croppedAreaPixels, rotation, frameW, frameH);
    const targetBytes = sizeUnit === "MB" ? targetSize * 1024 * 1024 : targetSize * 1024;
    const blob = await compressToTarget(out, targetBytes);
    setFinalSizeBytes(blob.size);
    setPreviewBlob(blob);

    const url = await new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.readAsDataURL(blob);
    });
    setPreviewDataUrl(url);
  };

  const download = () => {
    if (!previewDataUrl || !previewBlob) return;
    const url = URL.createObjectURL(previewBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}-1.jpg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <div className="stage" onWheelCapture={onWheel}>
        {imageSrc ? (
          <>
            <div className="crop-container">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                aspect={aspect}
                onCropChange={setCrop}
                onCropComplete={onCropComplete}
                onZoomChange={setZoom}
                zoomWithScroll={false}
                showGrid
                restrictPosition={false}
              />
            </div>
            <div className="bottom-rotator">
              <div className="ctrl">
                <label>التدوير</label>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={0.01}
                  value={targetSliderRotation}
                  onChange={(e) => setTargetSliderRotation(Number(e.target.value))}
                />
                <span className="ctrl-val">{sliderRotation.toFixed(2)}°</span>
              </div>
              <div className="ctrl">
                <label>التكبير</label>
                <input
                  type="range"
                  min={-70}
                  max={1900}
                  step={0.1}
                  value={zoomSliderValue}
                  onChange={(e) => handleZoomSlider(Number(e.target.value))}
                />
                <span className="ctrl-val">{zoom.toFixed(2)}×</span>
              </div>
            </div>
          </>
        ) : (
          <div
            className={`dropzone ${isDragOver ? "dragover" : ""}`}
            onClick={() => document.getElementById("fileInput")?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDragEnter={handleDragOver}
          >
            <span>
              {isHandlingFile || isPdfDocumentLoading
                ? "⏳ يتم قراءة الملف..."
                : "📄 انقر أو اسحب صورة / PDF هنا"}
            </span>
          </div>
        )}
      </div>

      <aside className="panel">
        <h2>أداة قص وضغط الصور ⚙️</h2>
        <p>إنشاء المنسق محمد عليكاج تكتل المشاعر 1447هـ 2026م</p>
        <input
          id="fileInput"
          type="file"
          accept="image/*,application/pdf"
          onChange={onFileChange}
          style={{ display: "none" }}
        />
        <button className="btn ghost" onClick={() => document.getElementById("fileInput")?.click()}>
          {imageSrc ? "🔄 اختر ملفاً آخر" : "📤 صورة أو PDF"}
        </button>

        {fileError && (
          <div style={{ color: "#f87171", fontSize: "13px", marginTop: "8px" }}>
            {fileError}
          </div>
        )}

        {pdfHasDocument && (
          <PdfPageControls
            label="اختيار صفحة من ملف PDF"
            pageCount={pdfPageCount}
            currentPage={pdfCurrentPage}
            onPageChange={setPdfCurrentPage}
            previewDataUrl={pdfPreviewDataUrl}
            isDocumentLoading={isPdfDocumentLoading}
            isPageRendering={isPdfPageRendering}
            error={pdfError}
            onReset={() => {
              resetPdfSource();
              setPdfBaseName("");
              setImageSrc(null);
              setCroppedAreaPixels(null);
              setPreviewDataUrl(null);
              setPreviewBlob(null);
              setFinalSizeBytes(null);
              setFileError(null);
              resetView();
            }}
          />
        )}

        <div className="group">
          <label>اسم الملف عند التنزيل:</label>
          <input
            className="text"
            type="text"
            value={fileName}
            onChange={(e) => {
              setFileNameEdited(true);
              setFileName(e.target.value);
            }}
          />
        </div>

        {imageSrc && (
          <div className="group">
            <label>التدوير السريع:</label>
            <div className="btn-row">
              <button
                className="btn ghost"
                onClick={rotate90Left}
                title="تدوير 90° يسار"
              >
                ↺ 90° يسار
              </button>
              <button
                className="btn ghost"
                onClick={rotate90Right}
                title="تدوير 90° يمين"
              >
                ↻ 90° يمين
              </button>
            </div>
          </div>
        )}

        <div className="split">
          <div className="group">
            <label>العرض (px):</label>
            <input
              className="num"
              type="number"
              value={frameW}
              onChange={(e) => setFrameW(Number(e.target.value))}
            />
          </div>
          <div className="group">
            <label>الارتفاع (px):</label>
            <input
              className="num"
              type="number"
              value={frameH}
              onChange={(e) => setFrameH(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="btn-row">
          <button className="btn" onClick={applyFrame}>
            تطبيق الأبعاد
          </button>
          <button className="btn ghost" onClick={presetPortrait}>
            📸 صورة شخصية (165×185)
          </button>
          <button className="btn ghost" onClick={presetLarge640}>
            📸 صورة (480×640)
          </button>
          <button className="btn ghost" onClick={presetPassportPage}>
            📸 صفحة جواز سفر(1200×1700)
          </button>
          <button className="btn ghost" onClick={presetA4}>
            📸ورقة A4(1733×2389)
          </button>
        </div>

        <div className="split">
          <div className="group">
            <label>الحجم المطلوب:</label>
            <input
              className="num"
              type="number"
              value={targetSize}
              onChange={(e) => setTargetSize(Number(e.target.value))}
            />
          </div>
          <div className="group">
            <label>الوحدة:</label>
            <select
              className="text"
              value={sizeUnit}
              onChange={(e) => setSizeUnit(e.target.value as any)}
            >
              <option value="KB">KB</option>
              <option value="MB">MB</option>
            </select>
          </div>
        </div>

        <div className="btn-row">
          <button className="btn" onClick={doCropAndCompress}>
            ✂️ قص + ضغط
          </button>
          <button className="btn success" onClick={download} disabled={!previewDataUrl}>
            💾 تنزيل
          </button>
          <button className="btn ghost" onClick={resetView}>
            إعادة ضبط العرض
          </button>
        </div>

        <div className="preview">
          <div className="pv-head">
            <span>المعاينة النهائية</span>
            {finalSizeBytes && (
              <small>
                ({finalSizeBytes >= 1024 * 1024
                  ? `${(finalSizeBytes / (1024 * 1024)).toFixed(2)} MB`
                  : `${(finalSizeBytes / 1024).toFixed(1)} KB`} • {frameW}×{frameH})
              </small>
            )}
          </div>
          <div className="pv-box">
            {previewDataUrl ? (
              <img src={previewDataUrl} alt="final preview" />
            ) : (
              <div className="pv-empty">— لا توجد معاينة بعد —</div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
