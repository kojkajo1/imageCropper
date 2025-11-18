import React, { useState, useCallback, useEffect } from "react";
import Cropper, { Area } from "react-easy-crop";

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
  rotation = 0
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
  output.width = crop.width;
  output.height = crop.height;
  const octx = output.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  
  // ملء الخلفية باللون الأبيض
  octx.fillStyle = "white";
  octx.fillRect(0, 0, crop.width, crop.height);
  
  octx.drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);

  return output;
}

async function compressToTarget(canvas: HTMLCanvasElement, targetBytes: number): Promise<Blob> {
  const encode = (quality: number) =>
    new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/jpeg", quality);
    });

  const fullQuality = await encode(0.99);
  if (fullQuality.size <= targetBytes) return fullQuality;

  let low = 0.05;
  let high = 0.99;
  let bestBlob: Blob | null = null;

  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    const candidate = await encode(mid);
    if (candidate.size > targetBytes) {
      high = mid;
    } else {
      bestBlob = candidate;
      low = mid;
      if (targetBytes - candidate.size < 512) break;
    }
  }

  if (bestBlob) return bestBlob;
  return await encode(low);
}

interface FreeCropProps {
  imageSrc: string;
  fileName: string;
  onFileNameChange: (name: string) => void;
  onComplete: (blob: Blob, dataUrl: string) => void;
}

export default function FreeCrop({ imageSrc, fileName, onFileNameChange, onComplete }: FreeCropProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [zoomSliderValue, setZoomSliderValue] = useState(0);
  const [baseRotation, setBaseRotation] = useState(-90); // التدوير الأساسي (90 درجة، 180 درجة، إلخ)
  const [sliderRotation, setSliderRotation] = useState(0); // قيمة الشريط (من -180 إلى 180)
  const [targetSliderRotation, setTargetSliderRotation] = useState(0);
  const [rotation, setRotation] = useState(-90);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [targetSize, setTargetSize] = useState(18);
  const [sizeUnit, setSizeUnit] = useState<"KB" | "MB">("KB");
  const [finalSizeBytes, setFinalSizeBytes] = useState<number | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);

  // حساب rotation الكلي من baseRotation + sliderRotation
  useEffect(() => {
    setRotation(baseRotation + sliderRotation);
  }, [baseRotation, sliderRotation]);

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

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY;
    
    // تزويم أدق: 2-3 بكسل لكل حركة سكرول
    setZoom((prev) => {
      // تقليل السرعة بشكل كبير للحصول على تزويم أكثر دقة
      const baseSpeed = 0.0002; // تقليل السرعة بشكل كبير
      
      // تسريع تدريجي: كلما كان التزويم أكبر، كلما كان التغيير أبطأ
      const zoomFactor = Math.max(0.3, Math.min(1.0, 1 / Math.sqrt(prev)));
      
      // حساب الخطوة بناءً على حجم الحركة (delta) - تقليل التأثير
      const normalizedDelta = Math.sign(delta) * Math.min(Math.abs(delta), 120);
      const step = baseSpeed * zoomFactor * normalizedDelta;
      
      // تطبيق التغيير بشكل سلس
      const newZoom = prev - step;
      
      // الحدود: من 0.1 إلى 20
      return Math.min(Math.max(newZoom, 0.1), 20);
    });
  };

  useEffect(() => {
    const mapped = (zoom - 1) * 100;
    const clamped = Math.min(Math.max(mapped, -70), 1900);
    setZoomSliderValue(clamped);
  }, [zoom]);

  const resetView = () => {
    setZoom(1);
    setZoomSliderValue(0);
    setBaseRotation(-90);
    setTargetSliderRotation(0);
    setSliderRotation(0);
    setCrop({ x: 0, y: 0 });
  };

  const handleZoomSlider = (val: number) => {
    const clamped = Math.min(Math.max(val, -70), 1900);
    setZoomSliderValue(clamped);
    const mappedZoom = Math.min(Math.max(1 + clamped / 100, 0.3), 20);
    setZoom(mappedZoom);
  };

  const rotate90Right = () => {
    // عند التدوير 90 درجة، نضبط baseRotation لكن الشريط يبقى عند الصفر
    setBaseRotation(baseRotation + 90);
    setTargetSliderRotation(0);
    setSliderRotation(0);
  };

  const rotate90Left = () => {
    // عند التدوير 90 درجة، نضبط baseRotation لكن الشريط يبقى عند الصفر
    setBaseRotation(baseRotation - 90);
    setTargetSliderRotation(0);
    setSliderRotation(0);
  };

  const rotateToPortrait = async (canvas: HTMLCanvasElement): Promise<HTMLCanvasElement> => {
    // إذا كانت الصورة أفقية (العرض أكبر من الارتفاع)، ندورها 90 درجة لتصبح عمودية
    if (canvas.width > canvas.height) {
      const rotatedCanvas = document.createElement("canvas");
      rotatedCanvas.width = canvas.height;
      rotatedCanvas.height = canvas.width;
      const ctx = rotatedCanvas.getContext("2d");
      
      if (!ctx) return canvas;
      
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      
      // ملء الخلفية باللون الأبيض
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, rotatedCanvas.width, rotatedCanvas.height);
      
      // تدوير 90 درجة عكس عقارب الساعة
      ctx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      
      return rotatedCanvas;
    }
    return canvas;
  };

  const rotate180 = (canvas: HTMLCanvasElement): HTMLCanvasElement => {
    const rotatedCanvas = document.createElement("canvas");
    rotatedCanvas.width = canvas.width;
    rotatedCanvas.height = canvas.height;
    const ctx = rotatedCanvas.getContext("2d");
    
    if (!ctx) return canvas;
    
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    
    // ملء الخلفية باللون الأبيض
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, rotatedCanvas.width, rotatedCanvas.height);
    
    // تدوير 180 درجة حول المركز
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    
    return rotatedCanvas;
  };

  const doCropAndCompress = async () => {
    if (!croppedAreaPixels) return;
    const out = await getCroppedCanvas(imageSrc, croppedAreaPixels, rotation);
    
    // تدوير الصورة إلى عمودي إذا كانت أفقية
    const portraitCanvas = await rotateToPortrait(out);
    
    // تدوير الصورة 180 درجة
    const rotatedCanvas = rotate180(portraitCanvas);
    
    const targetBytes = sizeUnit === "MB" ? targetSize * 1024 * 1024 : targetSize * 1024;
    const blob = await compressToTarget(rotatedCanvas, targetBytes);
    setFinalSizeBytes(blob.size);
    setPreviewBlob(blob);

    const url = await new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.readAsDataURL(blob);
    });
    setPreviewDataUrl(url);
    onComplete(blob, url);
  };

  const download = () => {
    if (!previewDataUrl || !previewBlob) return;
    const url = URL.createObjectURL(previewBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.jpg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <div className="stage" onWheel={onWheel}>
        <div className="crop-container">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={undefined}
            onCropChange={setCrop}
            onCropComplete={onCropComplete}
            onZoomChange={setZoom}
            zoomWithScroll={false}
            showGrid
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
      </div>

      <aside className="panel">
        <h2>جواز سفر جديد 📘</h2>
        <p>قص حر - تدوير افتراضي 90° لليسار</p>

        <div className="group">
          <label>اسم الملف عند التنزيل:</label>
          <input
            className="text"
            type="text"
            value={fileName}
            onChange={(e) => onFileNameChange(e.target.value)}
          />
        </div>

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
            {finalSizeBytes && previewBlob && (
              <small>
                ({finalSizeBytes >= 1024 * 1024 
                  ? `${(finalSizeBytes / (1024 * 1024)).toFixed(2)} MB` 
                  : `${(finalSizeBytes / 1024).toFixed(1)} KB`} • عمودي)
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

