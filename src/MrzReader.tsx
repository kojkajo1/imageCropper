import React, { useCallback, useEffect, useRef, useState } from "react";
import { readFileAsDataUrl } from "./fileUtils";

declare global {
  interface Window {
    mrz_worker?: (...args: unknown[]) => void;
  }
}

const WORKER_SCRIPT_URL = "/mrz-worker.bundle-min-wrapped.js";

type MrzFields = {
  firstName?: string;
  lastName?: string;
  documentNumber?: string;
  personalNumber?: string;
  birthDate?: string;
  expirationDate?: string;
  nationality?: string;
  issuingState?: string;
  sex?: string;
};

type ResultRow = {
  key: string;
  label: string;
  value: string;
};

type Status = "idle" | "loading-engine" | "processing" | "done" | "error";

function fmtMrzDate(raw?: string): string {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d]/g, "");
  if (digits.length < 6) return "";
  const yy = parseInt(digits.slice(0, 2), 10);
  const mm = digits.slice(2, 4);
  const dd = digits.slice(4, 6);
  const yyyy = yy >= 50 ? 1900 + yy : 2000 + yy;
  return `${dd}/${mm}/${yyyy}`;
}

function progressLabel(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("detect")) return "جارٍ تحديد منطقة القراءة الآلية (MRZ)...";
  if (m.includes("ocr")) return "جارٍ التعرّف الضوئي على الأحرف...";
  if (m.includes("pars")) return "جارٍ تحليل البيانات...";
  return "جارٍ المعالجة...";
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [value]);

  return (
    <button
      type="button"
      className="mrz-copy-btn"
      onClick={onCopy}
      disabled={!value}
      title="نسخ"
    >
      {copied ? "✅" : "📋"}
    </button>
  );
}

export default function MrzReader() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [progressText, setProgressText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [rows, setRows] = useState<ResultRow[]>([]);

  const workerRef = useRef<Worker | null>(null);
  const engineReadyRef = useRef<Promise<Worker> | null>(null);

  useEffect(() => {
    return () => {
      workerRef.current?.postMessage({ cmd: "stop" });
      workerRef.current?.terminate();
    };
  }, []);

  const loadEngine = useCallback((): Promise<Worker> => {
    if (engineReadyRef.current) return engineReadyRef.current;

    engineReadyRef.current = new Promise<Worker>((resolve, reject) => {
      const spawnWorker = () => {
        try {
          const factory = window.mrz_worker;
          if (!factory) {
            reject(new Error("تعذّر تحميل محرك القراءة."));
            return;
          }
          const src = factory
            .toString()
            .replace(/^function\s+.+\{?|\}$/g, "");
          const blob = new Blob([src], { type: "text/javascript" });
          const objectUrl = URL.createObjectURL(blob);
          const worker = new Worker(objectUrl);

          worker.addEventListener("message", (e: MessageEvent) => {
            const data = e.data;
            switch (data?.type) {
              case "progress":
                setProgressText(progressLabel(String(data.msg || "")));
                break;
              case "error":
                setStatus("error");
                setErrorMsg(
                  data.error ||
                    "تعذّر قراءة بيانات الجواز. تأكد من ظهور سطرَي MRZ أسفل الصورة بوضوح."
                );
                break;
              case "result":
                handleResult(data.result);
                break;
              default:
                break;
            }
          });

          worker.addEventListener("error", () => {
            setStatus("error");
            setErrorMsg("حدث خطأ داخل محرك القراءة.");
          });

          workerRef.current = worker;
          resolve(worker);
        } catch (err) {
          reject(err);
        }
      };

      if (window.mrz_worker) {
        spawnWorker();
        return;
      }

      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${WORKER_SCRIPT_URL}"]`
      );
      if (existing) {
        existing.addEventListener("load", spawnWorker);
        existing.addEventListener("error", () =>
          reject(new Error("تعذّر تحميل ملف محرك القراءة."))
        );
        return;
      }

      const script = document.createElement("script");
      script.src = WORKER_SCRIPT_URL;
      script.async = true;
      script.onload = spawnWorker;
      script.onerror = () => reject(new Error("تعذّر تحميل ملف محرك القراءة."));
      document.body.appendChild(script);
    });

    return engineReadyRef.current;
  }, []);

  function handleResult(result: {
    error?: string;
    ocrized?: string[];
    parsed?: { valid?: boolean; fields?: MrzFields };
  }) {
    if (result?.error) {
      setStatus("error");
      setErrorMsg(
        "تعذّر تحديد منطقة MRZ في الصورة. جرّب صورة أوضح وبزاوية مستقيمة تظهر فيها السطرين أسفل صفحة الجواز."
      );
      return;
    }

    const fields = result?.parsed?.fields || {};
    const given = fields.firstName || "";
    const surname = fields.lastName || "";
    const passportNo = fields.documentNumber || "";
    const nationalNo = fields.personalNumber || "";
    const birth = fmtMrzDate(fields.birthDate);
    const expiry = fmtMrzDate(fields.expirationDate);

    const nextRows: ResultRow[] = [
      { key: "given", label: "الاسم", value: given },
      { key: "surname", label: "الكنية", value: surname },
      { key: "passport", label: "رقم الجواز", value: passportNo },
      { key: "national", label: "الرقم الوطني", value: nationalNo },
      { key: "birth", label: "تاريخ الميلاد", value: birth },
      { key: "expiry", label: "تاريخ الانتهاء", value: expiry },
    ];

    setRows(nextRows);

    if (!result?.parsed?.valid) {
      setStatus("error");
      setErrorMsg(
        "تم استخراج نص MRZ لكن بعض الحقول قد تكون غير دقيقة — يرجى مراجعتها يدويًا قبل الاستخدام."
      );
      return;
    }

    setStatus("done");
    setErrorMsg("");
  }

  const processFile = useCallback(
    async (file: File) => {
      if (!/^image\//.test(file.type)) return;
      setRows([]);
      setErrorMsg("");
      setStatus("loading-engine");
      setProgressText("جارٍ تحميل محرك القراءة (أول استخدام فقط)...");

      const dataUrl = await readFileAsDataUrl(file);
      setImageSrc(dataUrl);

      try {
        const worker = await loadEngine();
        setStatus("processing");
        setProgressText("جارٍ المعالجة...");
        worker.postMessage({ cmd: "process", image: dataUrl });
      } catch (err) {
        setStatus("error");
        setErrorMsg(
          err instanceof Error ? err.message : "تعذّر تشغيل محرك القراءة."
        );
      }
    },
    [loadEngine]
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const isBusy = status === "loading-engine" || status === "processing";

  return (
    <div className="page">
      <div className="stage">
        {imageSrc ? (
          <div className="mrz-preview">
            <img src={imageSrc} alt="صورة الجواز" />
          </div>
        ) : (
          <div
            className={`dropzone ${isDragOver ? "dragover" : ""}`}
            onClick={() => document.getElementById("mrzFileInput")?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDragEnter={handleDragOver}
          >
            <span>📄 انقر أو اسحب صورة جواز السفر هنا (يجب أن يظهر سطرا MRZ أسفل الصفحة)</span>
          </div>
        )}
      </div>

      <aside className="panel">
        <h2>قارئ بيانات الجواز (MRZ) 🛂</h2>
        <p>إنشاء المنسق محمد عليكاج تكتل المشاعر 1447هـ 2026م</p>

        <p className="mrz-privacy-note">
          🔒 تتم قراءة الصورة بالكامل داخل متصفحك — لا تُرفع الصورة ولا أي بيانات إلى أي خادم.
        </p>

        <input
          id="mrzFileInput"
          type="file"
          accept="image/*"
          onChange={onFileChange}
          style={{ display: "none" }}
        />
        <div className="btn-row">
          <button
            className="btn ghost"
            onClick={() => document.getElementById("mrzFileInput")?.click()}
            disabled={isBusy}
          >
            {imageSrc ? "اختيار صورة أخرى" : "اختيار صورة"}
          </button>
        </div>

        {isBusy && (
          <div className="mrz-status">
            <div className="mrz-spinner" />
            <span>{progressText}</span>
          </div>
        )}

        {status === "error" && errorMsg && (
          <div className="mrz-error">{errorMsg}</div>
        )}

        {rows.length > 0 && (
          <div className="mrz-results">
            {rows.map((r) => (
              <div className="mrz-row" key={r.key}>
                <div className="mrz-row-label">{r.label}</div>
                <div className="mrz-row-value">{r.value || "—"}</div>
                <CopyButton value={r.value} />
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
