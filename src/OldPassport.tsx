import React, { useState, useCallback, useEffect, useRef } from "react";
import Cropper, { Area } from "react-easy-crop";
import { usePdfSource } from "./hooks/usePdfSource";
import PdfPageControls from "./PdfPageControls";
import { isPdfFile, readFileAsDataUrl } from "./fileUtils";

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
  // حد أدنى للجودة (60%) للحفاظ على وضوح النص والصورة، حتى لو تطلّب الأمر تجاوز الحجم
  // المطلوب بحالات نادرة جداً (صفحة A4 كبيرة/معقدة جداً بالنسبة للحجم المطلوب).
  const MIN_QUALITY = 0.6;
  let low = MIN_QUALITY;
  let high = 0.98;
  let bestBlob: Blob | null = null;

  const highCandidate = await encode(high);
  if (highCandidate.size < targetBytes) {
    bestBlob = highCandidate;
  }

  for (let i = 0; i < 40 && high - low > 0.002; i++) {
    const mid = (low + high) / 2;
    const candidate = await encode(mid);
    if (candidate.size < targetBytes) {
      // هذه الجودة ناجحة (أقل من الهدف) — نحفظها ونجرّب جودة أعلى
      bestBlob = candidate;
      low = mid;
    } else {
      // ما زال الحجم >= الهدف — نحتاج جودة أقل
      high = mid;
    }
  }

  if (bestBlob) return bestBlob;

  // حتى عند الحد الأدنى للجودة (60%) الحجم لا يزال أكبر من المطلوب — حالة نادرة جداً.
  // نعيد هذه الجودة كملاذ أخير للحفاظ على الوضوح بدل الاستمرار بخفض الجودة أكثر.
  return await encode(MIN_QUALITY);
}

async function createA4Page(
  img1DataUrl: string, 
  img2DataUrl: string, 
  img3DataUrl: string | null,
  targetBytes: number,
  orientation: "portrait" | "landscape" = "landscape"
): Promise<Blob> {
  // A4 dimensions at 300 DPI
  const A4_WIDTH_LANDSCAPE = 3508;
  const A4_HEIGHT_LANDSCAPE = 2480;
  const A4_WIDTH_PORTRAIT = 2480;
  const A4_HEIGHT_PORTRAIT = 3508;

  const A4_WIDTH = orientation === "landscape" ? A4_WIDTH_LANDSCAPE : A4_WIDTH_PORTRAIT;
  const A4_HEIGHT = orientation === "landscape" ? A4_HEIGHT_LANDSCAPE : A4_HEIGHT_PORTRAIT;

  const images = await Promise.all([
    createImage(img1DataUrl), 
    createImage(img2DataUrl),
    img3DataUrl ? createImage(img3DataUrl) : null
  ]);
  const [img1, img2, img3] = images;

  // استخدام الصور مباشرة بدون تدوير - الصور كما تم قصها
  const portrait1 = img1;
  const portrait2 = img2;
  const portrait3 = img3;

  const canvas = document.createElement("canvas");
  canvas.width = A4_WIDTH;
  canvas.height = A4_HEIGHT;
  const ctx = canvas.getContext("2d");
  
  if (!ctx) {
    throw new Error("فشل في الحصول على context من canvas");
  }
  
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const numImages = portrait3 ? 3 : 2;

  if (orientation === "landscape") {
    // الترتيب الأفقي: الصور عمودية (مقلوبة 180 درجة) بجانب بعضهما
    // الصورة الأولى على اليمين، الثانية على اليسار، الثالثة (إن وجدت) على أقصى اليسار
    
    // كل صورة تأخذ جزء من عرض الصفحة
    const targetWidthPerImage = A4_WIDTH / numImages;
    
    // حساب ارتفاع كل صورة بناءً على نسبة العرض إلى الارتفاع (الصور عمودية)
    const imgHeight1 = (portrait1.height / portrait1.width) * targetWidthPerImage;
    const imgHeight2 = (portrait2.height / portrait2.width) * targetWidthPerImage;
    const imgHeight3 = portrait3 ? (portrait3.height / portrait3.width) * targetWidthPerImage : 0;
    
    // استخدام الارتفاع الأصغر لضمان أن جميع الصور تتناسبان
    const heights = [imgHeight1, imgHeight2];
    if (portrait3) heights.push(imgHeight3);
    const maxHeight = Math.min(...heights, A4_HEIGHT);
    
    // إعادة حساب العرض بناءً على الارتفاع المحدد
    const finalWidth1 = (portrait1.width / portrait1.height) * maxHeight;
    const finalWidth2 = (portrait2.width / portrait2.height) * maxHeight;
    const finalWidth3 = portrait3 ? (portrait3.width / portrait3.height) * maxHeight : 0;
    
    // إذا كان مجموع العرض أكبر من عرض الصفحة، نضبط الحجم
    const totalWidth = finalWidth1 + finalWidth2 + finalWidth3;
    let scale = 1;
    if (totalWidth > A4_WIDTH) {
      scale = A4_WIDTH / totalWidth;
    }
    
    const finalHeight = maxHeight * scale;
    const finalW1 = finalWidth1 * scale;
    const finalW2 = finalWidth2 * scale;
    const finalW3 = finalWidth3 * scale;
    
    // محاذاة منتصف الصفحة عمودياً
    const yOffset = (A4_HEIGHT - finalHeight) / 2;

    // الصورة الأولى على اليمين
    const x1 = A4_WIDTH - finalW1;
    // الصورة الثانية على اليسار بجانب الأولى
    const x2 = x1 - finalW2;
    // الصورة الثالثة (إن وجدت) على أقصى اليسار
    const x3 = portrait3 ? x2 - finalW3 : 0;

    // الصورة الأولى (على اليمين) - عمودية مقلوبة كما تم قصها
    ctx.drawImage(portrait1, 0, 0, portrait1.width, portrait1.height, x1, yOffset, finalW1, finalHeight);
    // الصورة الثانية (على اليسار) - عمودية مقلوبة كما تم قصها
    ctx.drawImage(portrait2, 0, 0, portrait2.width, portrait2.height, x2, yOffset, finalW2, finalHeight);
    // الصورة الثالثة (إن وجدت) - عمودية مقلوبة كما تم قصها
    if (portrait3) {
      ctx.drawImage(portrait3, 0, 0, portrait3.width, portrait3.height, x3, yOffset, finalW3, finalHeight);
    }
  } else {
    // الترتيب العمودي: الصور عمودية (كما تم قصها) فوق بعضهما
    // الصورة الأولى من فوق، الثانية تحتها، الثالثة (إن وجدت) في الأسفل
    
    // كل صورة تأخذ كامل عرض الصفحة
    const targetWidth = A4_WIDTH;
    
    // حساب ارتفاع كل صورة بناءً على نسبة العرض إلى الارتفاع (الصور عمودية)
    const imgHeight1 = (portrait1.height / portrait1.width) * targetWidth;
    const imgHeight2 = (portrait2.height / portrait2.width) * targetWidth;
    const imgHeight3 = portrait3 ? (portrait3.height / portrait3.width) * targetWidth : 0;
    
    // حساب مجموع الارتفاع
    const totalHeight = imgHeight1 + imgHeight2 + imgHeight3;
    
    // إذا كان مجموع الارتفاع أكبر من ارتفاع الصفحة، نضبط الحجم مع الحفاظ على النسبة
    let finalWidth = targetWidth;
    let finalHeight1 = imgHeight1;
    let finalHeight2 = imgHeight2;
    let finalHeight3 = imgHeight3;
    
    if (totalHeight > A4_HEIGHT) {
      const scale = A4_HEIGHT / totalHeight;
      finalWidth = targetWidth * scale;
      finalHeight1 = imgHeight1 * scale;
      finalHeight2 = imgHeight2 * scale;
      finalHeight3 = imgHeight3 * scale;
    }

    // إعادة حساب الارتفاع الكلي بعد التصغير
    const finalTotalHeight = finalHeight1 + finalHeight2 + finalHeight3;
    
    // حساب المسافة الفارغة وتوزيعها من الأعلى والأسفل (محاذاة في المنتصف عمودياً)
    const verticalOffset = (A4_HEIGHT - finalTotalHeight) / 2;
    
    // حساب المسافة الفارغة وتوزيعها من اليسار واليمين (محاذاة في المنتصف أفقياً)
    const horizontalOffset = (A4_WIDTH - finalWidth) / 2;

    // الترتيب العمودي: الصورة الأولى من فوق، الثانية تحتها، الثالثة (إن وجدت) في الأسفل
    // الصورة الأولى من فوق (مع محاذاة في المنتصف)
    const y1 = verticalOffset;
    // الصورة الثانية تحتها
    const y2 = y1 + finalHeight1;
    // الصورة الثالثة (إن وجدت) في الأسفل
    const y3 = portrait3 ? y2 + finalHeight2 : 0;

    // الصورة الأولى (من فوق) - عمودية كما تم قصها (محاذاة في المنتصف أفقياً)
    ctx.drawImage(portrait1, 0, 0, portrait1.width, portrait1.height, horizontalOffset, y1, finalWidth, finalHeight1);
    // الصورة الثانية (تحتها) - عمودية كما تم قصها (محاذاة في المنتصف أفقياً)
    ctx.drawImage(portrait2, 0, 0, portrait2.width, portrait2.height, horizontalOffset, y2, finalWidth, finalHeight2);
    // الصورة الثالثة (إن وجدت) - عمودية كما تم قصها (محاذاة في المنتصف أفقياً)
    if (portrait3) {
      ctx.drawImage(portrait3, 0, 0, portrait3.width, portrait3.height, horizontalOffset, y3, finalWidth, finalHeight3);
    }
  }

  return await compressToTarget(canvas, targetBytes);
}

interface OldPassportProps {
  fileName: string;
  onFileNameChange: (name: string) => void;
  onComplete: (blob: Blob, dataUrl: string) => void;
}

type SlotIndex = 1 | 2 | 3;

export default function OldPassport({ fileName, onFileNameChange, onComplete }: OldPassportProps) {
  const [image1Src, setImage1Src] = useState<string | null>(null);
  const [image2Src, setImage2Src] = useState<string | null>(null);
  const [image3Src, setImage3Src] = useState<string | null>(null);
  const [currentImage, setCurrentImage] = useState<1 | 2 | 3>(1);
  const [useSameImage, setUseSameImage] = useState(false); // استخدام نفس الصورة للصورة الثانية
  const [useThirdImage, setUseThirdImage] = useState(false); // استخدام صورة ثالثة
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [zoomSliderValue, setZoomSliderValue] = useState(0);
  const [baseRotation, setBaseRotation] = useState(0); // التدوير الأساسي
  const [sliderRotation, setSliderRotation] = useState(0); // قيمة الشريط
  const [targetSliderRotation, setTargetSliderRotation] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels1, setCroppedAreaPixels1] = useState<Area | null>(null);
  const [croppedAreaPixels2, setCroppedAreaPixels2] = useState<Area | null>(null);
  const [croppedAreaPixels3, setCroppedAreaPixels3] = useState<Area | null>(null);
  const [croppedImage1, setCroppedImage1] = useState<string | null>(null);
  const [croppedImage2, setCroppedImage2] = useState<string | null>(null);
  const [croppedImage3, setCroppedImage3] = useState<string | null>(null);
  const [targetSize, setTargetSize] = useState(1);
  const [sizeUnit, setSizeUnit] = useState<"KB" | "MB">("MB");
  const [finalSizeBytes, setFinalSizeBytes] = useState<number | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [swapImages, setSwapImages] = useState(false);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("landscape");
  const pdfSlot1 = usePdfSource();
  const pdfSlot2 = usePdfSource();
  const pdfSlot3 = usePdfSource();
  const [slotLoading, setSlotLoading] = useState<SlotIndex | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [isStageDragOver, setIsStageDragOver] = useState(false);
  
  // أبعاد الفريم الافتراضية (جواز السفر الجديد)
  const [frameW1, setFrameW1] = useState(1593);
  const [frameH1, setFrameH1] = useState(2180);
  const [frameW2, setFrameW2] = useState(1593);
  const [frameH2, setFrameH2] = useState(2180);
  const [frameW3, setFrameW3] = useState(1593);
  const [frameH3, setFrameH3] = useState(2180);
  const [aspect1, setAspect1] = useState(1593 / 2180);
  const [aspect2, setAspect2] = useState(1593 / 2180);
  const [aspect3, setAspect3] = useState(1593 / 2180);

  const resetView = useCallback(() => {
    setZoom(1);
    setZoomSliderValue(0);
    setBaseRotation(0);
    setTargetSliderRotation(0);
    setSliderRotation(0);
    setCrop({ x: 0, y: 0 });
  }, []);

  const clearFinalPreview = useCallback(() => {
    setPreviewDataUrl(null);
    setPreviewBlob(null);
    setFinalSizeBytes(null);
  }, []);

  const clearSlot = useCallback(
    (slot: SlotIndex) => {
      if (slot === 1) {
        setImage1Src(null);
        setCroppedAreaPixels1(null);
        setCroppedImage1(null);
      } else if (slot === 2) {
        setImage2Src(null);
        setCroppedAreaPixels2(null);
        setCroppedImage2(null);
      } else {
        setImage3Src(null);
        setCroppedAreaPixels3(null);
        setCroppedImage3(null);
      }
    },
    []
  );

  const applyImageToSlot = useCallback(
    (slot: SlotIndex, dataUrl: string | null) => {
      if (!dataUrl) return;
      if (slot === 1) {
        setImage1Src(dataUrl);
        setCroppedAreaPixels1(null);
        setCroppedImage1(null);
      } else if (slot === 2) {
        setImage2Src(dataUrl);
        setCroppedAreaPixels2(null);
        setCroppedImage2(null);
      } else {
        setImage3Src(dataUrl);
        setCroppedAreaPixels3(null);
        setCroppedImage3(null);
      }
      setCurrentImage(slot);
      clearFinalPreview();
      resetView();
    },
    [clearFinalPreview, resetView]
  );

  const getPdfSlot = (slot: SlotIndex) => (slot === 1 ? pdfSlot1 : slot === 2 ? pdfSlot2 : pdfSlot3);

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
    if (currentImage === 1) {
      setCroppedAreaPixels1(pixels);
    } else if (currentImage === 2) {
      setCroppedAreaPixels2(pixels);
    } else {
      setCroppedAreaPixels3(pixels);
    }
  }, [currentImage]);

  const onWheel = (e: React.WheelEvent) => {
    const hasImage =
      currentImage === 1 ? !!image1Src : currentImage === 2 ? !!image2Src : !!image3Src;
    if (!hasImage) return;
    e.preventDefault();
    e.stopPropagation();
    // نحدّ من مقدار كل نبضة سكرول (بعض أجهزة التتبّع (trackpad) ترسل قفزات
    // كبيرة جداً دفعة واحدة أثناء السحب السريع) حتى لا تُحدث قفزة تكبير مفاجئة.
    const delta = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100);

    // تكبير/تصغير نسبي (أسّي) بدل الجمعي: نفس الإحساس بالسرعة في كل مستويات
    // التكبير، أكثر سلاسة واتساقاً من صيغة الجذر التربيعي السابقة، وبسرعة أهدأ.
    const ZOOM_SENSITIVITY = 0.00055;
    const factor = Math.exp(-delta * ZOOM_SENSITIVITY);

    setZoom((prev) => Math.min(Math.max(prev * factor, 0.1), 20));
  };

  useEffect(() => {
    const mapped = (zoom - 1) * 100;
    const clamped = Math.min(Math.max(mapped, -70), 1900);
    setZoomSliderValue(clamped);
  }, [zoom]);

  useEffect(() => {
    if (useSameImage && image1Src) {
      setImage2Src(image1Src);
    }
  }, [useSameImage, image1Src]);

  useEffect(() => {
    if (pdfSlot1.previewDataUrl) {
      applyImageToSlot(1, pdfSlot1.previewDataUrl);
    }
  }, [pdfSlot1.previewDataUrl, applyImageToSlot]);

  useEffect(() => {
    if (pdfSlot2.previewDataUrl) {
      applyImageToSlot(2, pdfSlot2.previewDataUrl);
    }
  }, [pdfSlot2.previewDataUrl, applyImageToSlot]);

  useEffect(() => {
    if (pdfSlot3.previewDataUrl) {
      applyImageToSlot(3, pdfSlot3.previewDataUrl);
    }
  }, [pdfSlot3.previewDataUrl, applyImageToSlot]);

  const handleZoomSlider = (val: number) => {
    const clamped = Math.min(Math.max(val, -70), 1900);
    setZoomSliderValue(clamped);
    const mappedZoom = Math.min(Math.max(1 + clamped / 100, 0.3), 20);
    setZoom(mappedZoom);
  };

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
  
  const applyFrame1 = () => {
    setAspect1(frameW1 / frameH1);
  };

  const applyFrame2 = () => {
    setAspect2(frameW2 / frameH2);
  };

  const applyFrame3 = () => {
    setAspect3(frameW3 / frameH3);
  };

  const applyAllFrames = (width: number, height: number) => {
    setFrameW1(width);
    setFrameH1(height);
    setAspect1(width / height);
    setFrameW2(width);
    setFrameH2(height);
    setAspect2(width / height);
    setFrameW3(width);
    setFrameH3(height);
    setAspect3(width / height);
  };
  const presetNewFamilyBooklet = () => applyAllFrames(1000, 750);
  const presetOldFamilyBooklet = () => applyAllFrames(1600, 1150);

  const handleSlotFile = async (file: File, slot: SlotIndex) => {
    setSlotError(null);
    setSlotLoading(slot);
    try {
      setCurrentImage(slot);
      clearFinalPreview();
      if (slot === 1 && useSameImage) {
        setUseSameImage(false);
        setImage2Src(null);
        setCroppedImage2(null);
        setCroppedAreaPixels2(null);
      }
      if (slot === 2) {
        setUseSameImage(false);
      }

      const pdfSlot = getPdfSlot(slot);
      if (isPdfFile(file)) {
        await pdfSlot.loadFromFile(file);
      } else {
        pdfSlot.reset();
        const dataUrl = await readFileAsDataUrl(file);
        applyImageToSlot(slot, dataUrl);
      }
    } catch (error) {
      console.error("Slot file error:", error);
      setSlotError("تعذر قراءة الملف. يرجى المحاولة مرة أخرى.");
    } finally {
      setSlotLoading(null);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>, imgNum: SlotIndex) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void handleSlotFile(file, imgNum);
    e.target.value = "";
  };

  const handleStageDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsStageDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleSlotFile(file, currentImage);
    }
  };

  const handleStageDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isStageDragOver) {
      setIsStageDragOver(true);
    }
  };

  const handleStageDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsStageDragOver(false);
  };

  const cropCurrentImage = async () => {
    const currentSrc = currentImage === 1 ? image1Src : currentImage === 2 ? image2Src : image3Src;
    const currentPixels = currentImage === 1 ? croppedAreaPixels1 : currentImage === 2 ? croppedAreaPixels2 : croppedAreaPixels3;
    if (!currentSrc || !currentPixels) return;

    const canvas = await getCroppedCanvas(currentSrc, currentPixels, rotation);
    
    // استخدام أبعاد الفريم المحددة
    const targetW = currentImage === 1 ? frameW1 : currentImage === 2 ? frameW2 : frameW3;
    const targetH = currentImage === 1 ? frameH1 : currentImage === 2 ? frameH2 : frameH3;
    
    // إنشاء canvas جديد بالأبعاد المطلوبة
    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = targetW;
    finalCanvas.height = targetH;
    const ctx = finalCanvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    
    // ملء الخلفية باللون الأبيض
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, targetW, targetH);
    
    // رسم الصورة المقطوعة مع التكيف مع الأبعاد المطلوبة
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, targetW, targetH);
    
    const dataUrl = finalCanvas.toDataURL("image/jpeg", 0.95);
    
    if (currentImage === 1) {
      setCroppedImage1(dataUrl);
      // إذا كان المستخدم يريد استخدام نفس الصورة، ننتقل للصورة الثانية
      if (useSameImage && image1Src) {
        setImage2Src(image1Src);
        setCurrentImage(2);
      } else if (image2Src) {
        setCurrentImage(2);
      } else if (useThirdImage && image3Src) {
        setCurrentImage(3);
      }
    } else if (currentImage === 2) {
      setCroppedImage2(dataUrl);
      if (useThirdImage && image3Src) {
        setCurrentImage(3);
      } else if (image1Src && croppedImage1) {
        setCurrentImage(1);
      }
    } else {
      setCroppedImage3(dataUrl);
      if (image1Src && croppedImage1) {
        setCurrentImage(1);
      } else if (image2Src && croppedImage2) {
        setCurrentImage(2);
      }
    }
    resetView();
  };

  const rotateCanvas180 = async (blob: Blob): Promise<Blob> => {
    const img = await createImage(URL.createObjectURL(blob));
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    
    if (!ctx) {
      throw new Error("فشل في الحصول على context");
    }
    
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    
    // ملء الخلفية باللون الأبيض
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // تدوير 180 درجة حول المركز
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    
    return new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.95);
    });
  };

  const createFinalA4 = async () => {
    if (!croppedImage1 || !croppedImage2) {
      alert("يرجى قص الصورتين أولاً");
      return;
    }
    
    try {
      const img1 = swapImages ? croppedImage2 : croppedImage1;
      const img2 = swapImages ? croppedImage1 : croppedImage2;
      const img3 = useThirdImage && croppedImage3 ? croppedImage3 : null;
      
      const targetBytes = sizeUnit === "MB" ? targetSize * 1024 * 1024 : targetSize * 1024;
      const blob = await createA4Page(img1, img2, img3, targetBytes, orientation);
      
      // الصور مقلوبة بالفعل داخل createA4Page
      setFinalSizeBytes(blob.size);
      setPreviewBlob(blob);

      const url = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result as string);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
      setPreviewDataUrl(url);
      onComplete(blob, url);
    } catch (error) {
      console.error("خطأ في إنشاء صفحة A4:", error);
      alert("حدث خطأ في إنشاء صفحة A4. يرجى المحاولة مرة أخرى.");
    }
  };
  
  // معاينة مباشرة عند تغيير الاتجاه أو تبديل الصور
  useEffect(() => {
    if (croppedImage1 && croppedImage2) {
      const updatePreview = async () => {
        try {
          const img1 = swapImages ? croppedImage2 : croppedImage1;
          const img2 = swapImages ? croppedImage1 : croppedImage2;
          const img3 = useThirdImage && croppedImage3 ? croppedImage3 : null;
          
          const targetBytes = sizeUnit === "MB" ? targetSize * 1024 * 1024 : targetSize * 1024;
          const blob = await createA4Page(img1, img2, img3, targetBytes, orientation);
          setFinalSizeBytes(blob.size);
          setPreviewBlob(blob);

          const url = await new Promise<string>((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result as string);
            fr.onerror = rej;
            fr.readAsDataURL(blob);
          });
          setPreviewDataUrl(url);
        } catch (error) {
          console.error("خطأ في تحديث المعاينة:", error);
        }
      };
      updatePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation, swapImages, useThirdImage, croppedImage3]);

  const download = () => {
    if (!previewDataUrl || !previewBlob) return;
    const url = URL.createObjectURL(previewBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.jpg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentImageSrc = currentImage === 1 ? image1Src : currentImage === 2 ? image2Src : image3Src;
  const hasBothCropped = croppedImage1 && croppedImage2;

  return (
    <div className="page">
      <div className="stage" onWheelCapture={onWheel}>
        {currentImageSrc ? (
          <>
            <div className="crop-container">
              <Cropper
                image={currentImageSrc}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                aspect={currentImage === 1 ? aspect1 : currentImage === 2 ? aspect2 : aspect3}
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
            className={`dropzone ${isStageDragOver ? "dragover" : ""}`}
            onClick={() => document.getElementById(`fileInput${currentImage}`)?.click()}
            onDrop={handleStageDrop}
            onDragOver={handleStageDragOver}
            onDragEnter={handleStageDragOver}
            onDragLeave={handleStageDragLeave}
          >
            <span>
              📄 {currentImage === 1 ? "الصورة الأولى - الصفحة الأولى" : currentImage === 2 ? "الصورة الثانية - الصفحة الثانية" : "الصورة الثالثة - الصفحة الثالثة"} — يدعم الصور وملفات PDF
            </span>
          </div>
        )}
      </div>

      <aside className="panel">
        <h2>جواز سفر قديم 📕</h2>
        <p>إنشاء المنسق محمد عليكاج تكتل المشاعر 1447هـ 2026م</p>
        <p>صفحتان على A4</p>

        <div className="group">
          <label>اسم الملف عند التنزيل:</label>
          <input
            className="text"
            type="text"
            value={fileName}
            onChange={(e) => onFileNameChange(e.target.value)}
          />
        </div>

        <div className="btn-row">
          <input
            id="fileInput1"
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => onFileChange(e, 1)}
            style={{ display: "none" }}
          />
          <input
            id="fileInput2"
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => onFileChange(e, 2)}
            style={{ display: "none" }}
          />
          <input
            id="fileInput3"
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => onFileChange(e, 3)}
            style={{ display: "none" }}
          />
          <button 
            className="btn ghost" 
            onClick={() => document.getElementById("fileInput1")?.click()}
            style={{ opacity: image1Src ? 0.6 : 1 }}
          >
            {slotLoading === 1
              ? "⏳ جاري التحميل..."
              : image1Src
              ? "✅ الصورة الأولى"
              : "📤 رفع الصورة الأولى"}
          </button>
          {!useSameImage && (
            <button 
              className="btn ghost" 
              onClick={() => document.getElementById("fileInput2")?.click()}
              style={{ opacity: image2Src ? 0.6 : 1 }}
            >
              {slotLoading === 2
                ? "⏳ جاري التحميل..."
                : image2Src
                ? "✅ الصورة الثانية"
                : "📤 رفع الصورة الثانية"}
            </button>
          )}
        </div>

        <div className="group">
          <label>نوع المستند (يضبط أبعاد الصور الأولى والثانية والثالثة معًا):</label>
          <div className="btn-row">
            <button className="btn ghost" onClick={presetNewFamilyBooklet}>
              📘 دفتر عائلة جديد (1000×750)
            </button>
            <button className="btn ghost" onClick={presetOldFamilyBooklet}>
              📗 دفتر عائلة قديم (1600×1150)
            </button>
          </div>
        </div>

        {image1Src && !croppedImage1 && (
          <div className="group" style={{ marginTop: "10px" }}>
            <label>
              <input
                type="checkbox"
                checked={useSameImage}
                onChange={(e) => {
                  setUseSameImage(e.target.checked);
                  if (e.target.checked && image1Src) {
                    setImage2Src(image1Src);
                    pdfSlot2.reset();
                    setCroppedAreaPixels2(null);
                    setCroppedImage2(null);
                  } else {
                    pdfSlot2.reset();
                    setImage2Src(null);
                    setCroppedImage2(null);
                    setCroppedAreaPixels2(null);
                  }
                }}
                style={{ marginLeft: "8px" }}
              />
              استخدام نفس الصورة للصورة الثانية
            </label>
          </div>
        )}
        
        {hasBothCropped && (
          <div className="group" style={{ marginTop: "10px" }}>
            <label>
              <input
                type="checkbox"
                checked={useThirdImage}
                onChange={(e) => {
                  setUseThirdImage(e.target.checked);
                  if (!e.target.checked) {
                    pdfSlot3.reset();
                    setImage3Src(null);
                    setCroppedImage3(null);
                    setCroppedAreaPixels3(null);
                  }
                }}
                style={{ marginLeft: "8px" }}
              />
              إضافة صورة ثالثة
            </label>
          </div>
        )}
        
        {useThirdImage && (
          <div className="btn-row" style={{ marginTop: "10px" }}>
            <button 
              className="btn ghost" 
              onClick={() => document.getElementById("fileInput3")?.click()}
              style={{ opacity: image3Src ? 0.6 : 1 }}
            >
              {slotLoading === 3
                ? "⏳ جاري التحميل..."
                : image3Src
                ? "✅ الصورة الثالثة"
                : "📤 رفع الصورة الثالثة"}
            </button>
          </div>
        )}

        {slotError && (
          <div style={{ color: "#f87171", fontSize: "13px", marginTop: "8px" }}>
            {slotError}
          </div>
        )}

        {pdfSlot1.hasDocument && (
          <PdfPageControls
            label="صفحات PDF - الصورة الأولى"
            pageCount={pdfSlot1.pageCount}
            currentPage={pdfSlot1.currentPage}
            onPageChange={pdfSlot1.setCurrentPage}
            previewDataUrl={pdfSlot1.previewDataUrl}
            isDocumentLoading={pdfSlot1.isDocumentLoading}
            isPageRendering={pdfSlot1.isPageRendering}
            error={pdfSlot1.error}
            onReset={() => {
              pdfSlot1.reset();
              clearSlot(1);
              clearFinalPreview();
              setSlotError(null);
            }}
          />
        )}

        {pdfSlot2.hasDocument && (
          <PdfPageControls
            label="صفحات PDF - الصورة الثانية"
            pageCount={pdfSlot2.pageCount}
            currentPage={pdfSlot2.currentPage}
            onPageChange={pdfSlot2.setCurrentPage}
            previewDataUrl={pdfSlot2.previewDataUrl}
            isDocumentLoading={pdfSlot2.isDocumentLoading}
            isPageRendering={pdfSlot2.isPageRendering}
            error={pdfSlot2.error}
            onReset={() => {
              pdfSlot2.reset();
              clearSlot(2);
              clearFinalPreview();
              setSlotError(null);
            }}
          />
        )}

        {useThirdImage && pdfSlot3.hasDocument && (
          <PdfPageControls
            label="صفحات PDF - الصورة الثالثة"
            pageCount={pdfSlot3.pageCount}
            currentPage={pdfSlot3.currentPage}
            onPageChange={pdfSlot3.setCurrentPage}
            previewDataUrl={pdfSlot3.previewDataUrl}
            isDocumentLoading={pdfSlot3.isDocumentLoading}
            isPageRendering={pdfSlot3.isPageRendering}
            error={pdfSlot3.error}
            onReset={() => {
              pdfSlot3.reset();
              clearSlot(3);
              clearFinalPreview();
              setSlotError(null);
            }}
          />
        )}

        {currentImageSrc && (
          <>
            <div style={{ 
              padding: "10px", 
              background: croppedAreaPixels1 && currentImage === 1 ? "rgba(34, 197, 94, 0.1)" : 
                          croppedAreaPixels2 && currentImage === 2 ? "rgba(34, 197, 94, 0.1)" : 
                          croppedAreaPixels3 && currentImage === 3 ? "rgba(34, 197, 94, 0.1)" : 
                          "rgba(255, 193, 7, 0.1)",
              border: `1px solid ${croppedAreaPixels1 && currentImage === 1 ? "#22c55e" : 
                                    croppedAreaPixels2 && currentImage === 2 ? "#22c55e" : 
                                    croppedAreaPixels3 && currentImage === 3 ? "#22c55e" : 
                                    "#f59e0b"}`,
              borderRadius: "8px",
              marginBottom: "10px",
              fontSize: "13px",
              color: "#cfe9ff"
            }}>
              {currentImage === 1 ? (
                croppedImage1 ? "✅ تم قص الصورة الأولى" : 
                croppedAreaPixels1 ? "⚠️ اضغط على 'قص هذه الصورة' لحفظ القص" : 
                "📸 حدد منطقة القص للصورة الأولى"
              ) : currentImage === 2 ? (
                croppedImage2 ? "✅ تم قص الصورة الثانية" : 
                croppedAreaPixels2 ? "⚠️ اضغط على 'قص هذه الصورة' لحفظ القص" : 
                "📸 حدد منطقة القص للصورة الثانية"
              ) : (
                croppedImage3 ? "✅ تم قص الصورة الثالثة" : 
                croppedAreaPixels3 ? "⚠️ اضغط على 'قص هذه الصورة' لحفظ القص" : 
                "📸 حدد منطقة القص للصورة الثالثة"
              )}
            </div>
            
            <div className="group">
              <label>أبعاد الفريم - {currentImage === 1 ? "الصورة الأولى" : currentImage === 2 ? "الصورة الثانية" : "الصورة الثالثة"}:</label>
              <div className="split">
                <div className="group">
                  <label>العرض (px):</label>
                  <input
                    className="num"
                    type="number"
                    value={currentImage === 1 ? frameW1 : currentImage === 2 ? frameW2 : frameW3}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (currentImage === 1) {
                        setFrameW1(val);
                      } else if (currentImage === 2) {
                        setFrameW2(val);
                      } else {
                        setFrameW3(val);
                      }
                    }}
                  />
                </div>
                <div className="group">
                  <label>الارتفاع (px):</label>
                  <input
                    className="num"
                    type="number"
                    value={currentImage === 1 ? frameH1 : currentImage === 2 ? frameH2 : frameH3}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (currentImage === 1) {
                        setFrameH1(val);
                      } else if (currentImage === 2) {
                        setFrameH2(val);
                      } else {
                        setFrameH3(val);
                      }
                    }}
                  />
                </div>
              </div>
              <button 
                className="btn ghost" 
                onClick={currentImage === 1 ? applyFrame1 : currentImage === 2 ? applyFrame2 : applyFrame3}
                style={{ marginTop: "8px", width: "100%" }}
              >
                تطبيق الأبعاد
              </button>
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

            <div className="btn-row">
              <button 
                className="btn" 
                onClick={cropCurrentImage}
                disabled={(currentImage === 1 && !croppedAreaPixels1) || (currentImage === 2 && !croppedAreaPixels2) || (currentImage === 3 && !croppedAreaPixels3)}
              >
                ✂️ قص هذه الصورة
              </button>
              <button className="btn ghost" onClick={resetView}>
                إعادة ضبط
              </button>
            </div>
          </>
        )}

        {hasBothCropped && (
          <>
            <div className="preview" style={{ marginTop: "16px", marginBottom: "16px" }}>
              <div className="pv-head">
                <span>المعاينة المباشرة</span>
              </div>
              <div style={{ 
                display: "grid", 
                gridTemplateColumns: "1fr 1fr", 
                gap: "10px",
                background: "#0b1220",
                border: "1px solid #203049",
                borderRadius: "12px",
                padding: "10px"
              }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "12px", color: "#9fb3ce", marginBottom: "5px" }}>
                    {swapImages ? "الصورة الثانية" : "الصورة الأولى"}
                  </div>
                  <img 
                    src={swapImages ? croppedImage2! : croppedImage1!} 
                    alt="preview 1" 
                    style={{ 
                      maxWidth: "100%", 
                      maxHeight: "150px", 
                      borderRadius: "8px",
                      border: "1px solid #203049"
                    }} 
                  />
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "12px", color: "#9fb3ce", marginBottom: "5px" }}>
                    {swapImages ? "الصورة الأولى" : "الصورة الثانية"}
                  </div>
                  <img 
                    src={swapImages ? croppedImage1! : croppedImage2!} 
                    alt="preview 2" 
                    style={{ 
                      maxWidth: "100%", 
                      maxHeight: "150px", 
                      borderRadius: "8px",
                      border: "1px solid #203049"
                    }} 
                  />
                </div>
              </div>
            </div>
            
            <div className="group">
              <label>اتجاه الصفحة:</label>
              <div className="btn-row">
                <button 
                  className={`btn ${orientation === "landscape" ? "" : "ghost"}`}
                  onClick={() => setOrientation("landscape")}
                >
                  ↔️ أفقي
                </button>
                <button 
                  className={`btn ${orientation === "portrait" ? "" : "ghost"}`}
                  onClick={() => setOrientation("portrait")}
                >
                  ↕️ عمودي
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
              <button className="btn" onClick={() => setSwapImages(!swapImages)}>
                🔄 {swapImages ? "إعادة الترتيب الأصلي" : "تبديل الأماكن"}
              </button>
              <button className="btn" onClick={createFinalA4}>
                📄 معاينة صفحة A4
              </button>
            </div>
          </>
        )}

        <div className="btn-row">
          <button className="btn success" onClick={download} disabled={!previewDataUrl}>
            💾 تنزيل
          </button>
        </div>

        <div className="preview">
          <div className="pv-head">
            <span>المعاينة النهائية</span>
            {finalSizeBytes && (
              <small>
                ({finalSizeBytes >= 1024 * 1024 
                  ? `${(finalSizeBytes / (1024 * 1024)).toFixed(2)} MB` 
                  : `${(finalSizeBytes / 1024).toFixed(1)} KB`} • A4)
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

