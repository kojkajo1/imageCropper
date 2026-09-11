import React, { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import JSZip from "jszip";

// ============================================================================
// إعدادات — يُحدَّث هذا القسم إذا تغيّر معرّف الإضافة أو رابط الفيديو
// ============================================================================

// معرّف الإضافة ثابت (مبني على مفتاح موقَّع في ملف manifest.json)، ولا يتغيّر حتى
// إذا أعاد المستخدم تثبيت الإضافة أو ثبّتها على أكثر من جهاز.
const EXTENSION_ID = "ilonopokaponmcmamhldhgollebodpoi";

// رابط فيديو الشرح على يوتيوب — قيمة مؤقتة إلى حين توفّر الرابط الفعلي
const YOUTUBE_TUTORIAL_URL = "";

const EXTENSION_ZIP_URL = "/hajj-extension.zip";
const TEMPLATE_URL = "/names_template.xlsx";

// ============================================================================
// أنواع البيانات
// ============================================================================

type Person = { name: string; familyNo: string };

type ReportRow = {
  name: string;
  familyNo: string;
  status: string;
  receiptStatus: string;
  familyStatus: string;
};

type ResultFile = { filename: string; base64: string };

type ExtensionStatus = "checking" | "missing" | "ready";
type JobState = "idle" | "running" | "done" | "error";

// ============================================================================
// تواصل مع الإضافة عبر chrome.runtime (بدون أي سيرفر)
// ============================================================================

function getChrome(): any {
  return (window as any).chrome;
}

function pingExtension(): Promise<boolean> {
  return new Promise((resolve) => {
    const chromeObj = getChrome();
    if (!chromeObj?.runtime?.sendMessage) {
      resolve(false);
      return;
    }
    try {
      chromeObj.runtime.sendMessage(EXTENSION_ID, { type: "ping" }, (response: any) => {
        if (chromeObj.runtime.lastError) {
          resolve(false);
        } else {
          resolve(!!response && response.type === "pong");
        }
      });
    } catch {
      resolve(false);
    }
  });
}

type ProgressMsg = { type: "progress"; done: number; total: number; percent: number; currentName: string };
type DoneMsg = { type: "done"; report: ReportRow[]; files: ResultFile[] };
type ErrorMsg = { type: "error"; message: string };

function startJob(
  email: string,
  password: string,
  people: Person[],
  onProgress: (m: ProgressMsg) => void,
  onDone: (m: DoneMsg) => void,
  onError: (message: string) => void
) {
  const chromeObj = getChrome();
  const port = chromeObj.runtime.connect(EXTENSION_ID, { name: "hajj-job" });
  port.onMessage.addListener((msg: ProgressMsg | DoneMsg | ErrorMsg) => {
    if (msg.type === "progress") onProgress(msg);
    else if (msg.type === "done") onDone(msg);
    else if (msg.type === "error") onError(msg.message);
  });
  port.onDisconnect.addListener(() => {
    // إذا انقطع الاتصال بدون رسالة done/error واضحة
  });
  port.postMessage({ type: "start", email, password, people });
  return port;
}

// ============================================================================
// قراءة قائمة الأسماء من ملف الإكسل
// ============================================================================

async function parseExcelFile(file: File): Promise<Person[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return rows
    .map((r) => ({
      name: String(r["اسم الحاج الثلاثي"] ?? r.name ?? r["الاسم"] ?? "").trim(),
      familyNo: String(r["رقم الطلب العائلي"] ?? r.familyNo ?? r["رقم العائلة"] ?? "").trim(),
    }))
    .filter((r) => r.name.length > 0);
}

// ============================================================================
// بناء ملف ZIP النهائي (تقرير + مجلد PDF)
// ============================================================================

async function buildResultZip(report: ReportRow[], files: ResultFile[]): Promise<Blob> {
  const wsData = report.map((r) => ({
    "الاسم": r.name,
    "رقم الطلب العائلي": r.familyNo,
    "الحالة": r.status,
    "بطاقة التسجيل": r.receiptStatus,
    "الطلب العائلي": r.familyStatus,
  }));
  const ws = XLSX.utils.json_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "التقرير");
  const xlsxArray = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

  const zip = new JSZip();
  zip.file("تقرير التحميل.xlsx", xlsxArray);
  const pdfFolder = zip.folder("ملفات PDF")!;
  for (const f of files) {
    pdfFolder.file(f.filename, f.base64, { base64: true });
  }
  return zip.generateAsync({ type: "blob" });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ============================================================================
// المكوّن
// ============================================================================

export default function HajjDownloader() {
  const [extensionStatus, setExtensionStatus] = useState<ExtensionStatus>("checking");

  const [people, setPeople] = useState<Person[] | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [jobState, setJobState] = useState<JobState>("idle");
  const [progress, setProgress] = useState<ProgressMsg | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [report, setReport] = useState<ReportRow[]>([]);
  const [files, setFiles] = useState<ResultFile[]>([]);

  const portRef = useRef<any>(null);

  const checkExtension = useCallback(async () => {
    setExtensionStatus("checking");
    const ok = await pingExtension();
    setExtensionStatus(ok ? "ready" : "missing");
  }, []);

  useEffect(() => {
    checkExtension();
  }, [checkExtension]);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const file = Array.from(fileList)[0];
    if (!file) return;
    setErrorMessage("");
    try {
      const parsed = await parseExcelFile(file);
      if (parsed.length === 0) {
        setErrorMessage("لم يُعثر على أي اسم في ملف الإكسل — يُرجى التأكد من تعبئة عمود «اسم الحاج الثلاثي».");
        return;
      }
      setPeople(parsed);
      setFileName(file.name);
    } catch (e) {
      setErrorMessage(
        "تعذّرت قراءة ملف الإكسل. يُرجى التأكد من أنه بصيغة xlsx، وأنه يحتوي عمودي «اسم الحاج الثلاثي» و«رقم الطلب العائلي»."
      );
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);
  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) handleFiles(e.target.files);
      e.target.value = "";
    },
    [handleFiles]
  );

  const handleStart = useCallback(() => {
    if (!people || people.length === 0) {
      setErrorMessage("يُرجى رفع ملف إكسل أولًا.");
      return;
    }
    if (!email.trim() || !password) {
      setErrorMessage("يُرجى إدخال البريد الإلكتروني وكلمة المرور الخاصَّين بنظام الحج.");
      return;
    }

    setErrorMessage("");
    setReport([]);
    setFiles([]);
    setProgress({ type: "progress", done: 0, total: people.length, percent: 0, currentName: "" });
    setJobState("running");

    portRef.current = startJob(
      email,
      password,
      people,
      (msg) => setProgress(msg),
      (msg) => {
        setReport(msg.report);
        setFiles(msg.files);
        setJobState("done");
      },
      (message) => {
        setErrorMessage(message);
        setJobState("error");
      }
    );
  }, [people, email, password]);

  const handleDownloadZip = useCallback(async () => {
    const blob = await buildResultZip(report, files);
    downloadBlob(blob, "بطاقات الحج.zip");
  }, [report, files]);

  const successCount = report.filter((r) => r.receiptStatus === "تم" || r.familyStatus === "تم").length;

  return (
    <div className="page">
      <div className="stage">
        {jobState === "idle" && (
          <div className="hajj-install-box">
            <h3>📌 الإضافة المطلوبة لتشغيل الأداة</h3>

            {extensionStatus === "ready" ? (
              <p className="hajj-status-ok">✅ الإضافة مثبَّتة وتعمل على جهازك.</p>
            ) : (
              <p>يجب تحميل هذه الإضافة وتثبيتها على جهازك أول مرة حتى تعمل الأداة.</p>
            )}

            <div className="btn-row">
              <a className="btn success" href={EXTENSION_ZIP_URL} download>
                ⬇️ تحميل الإضافة
              </a>
              {YOUTUBE_TUTORIAL_URL ? (
                <a className="btn ghost" href={YOUTUBE_TUTORIAL_URL} target="_blank" rel="noreferrer">
                  🎬 فيديو شرح التثبيت والاستخدام
                </a>
              ) : (
                <span className="hajj-muted">🎬 فيديو الشرح — قريبًا</span>
              )}
            </div>

            {extensionStatus !== "ready" && (
              <>
                <p className="hajj-muted">
                  بعد التثبيت (Load unpacked من صفحة chrome://extensions مع تفعيل «وضع المطوِّر»)،
                  يُرجى الضغط على الزر أدناه للتأكد.
                </p>
                <button className="btn ghost" onClick={checkExtension}>
                  🔄 تأكد من التثبيت
                </button>
              </>
            )}

            <div className="hajj-install-box-divider" />

            {extensionStatus === "ready" && !people && (
              <div className="hajj-hint">
                <div className="hajj-arrow">⬇</div>
                <p>حمِّل قالب ملف الإكسل من اللوحة الجانبية، عبِّئه بالأسماء وأرقام العائلة، ثم ارفعه.</p>
              </div>
            )}

            {extensionStatus === "ready" && people && (
              <p className="hajj-status-ok">
                ✅ تم رفع {people.length} اسمًا من الملف «{fileName}». يُرجى إدخال بيانات الدخول
                والضغط على زر «ابدأ» في اللوحة الجانبية.
              </p>
            )}
          </div>
        )}

        {jobState === "running" && progress && (
          <ProgressRing percent={progress.percent} currentName={progress.currentName} done={progress.done} total={progress.total} />
        )}

        {jobState === "done" && (
          <div className="hajj-summary">
            <div className="hajj-summary-icon">✅</div>
            <h3>اكتمل التحميل!</h3>
            <p>
              تم تحميل ملفات {successCount} من أصل {report.length} حاجًّا بنجاح.
            </p>
            <button className="btn success" onClick={handleDownloadZip}>
              ⬇️ تحميل النتائج (ZIP)
            </button>
          </div>
        )}

        {jobState === "error" && (
          <div className="hajj-summary">
            <div className="hajj-summary-icon">⚠️</div>
            <h3>حدث خطأ</h3>
            <p className="mrz-error">{errorMessage}</p>
            {report.length > 0 && (
              <button className="btn success" onClick={handleDownloadZip}>
                ⬇️ تحميل النتائج الجزئية (ZIP)
              </button>
            )}
          </div>
        )}
      </div>

      <aside className="panel">
        <h2>تحميل بطاقات الحج 🕋</h2>
        <p>يقوم بتحميل بطاقة التسجيل وبطاقة الطلب العائلي لكل حاجّ من hajjregister.com تلقائيًا.</p>

        <p className="mrz-privacy-note">
          🔒 تعمل الأداة بالكامل محليًا على جهازك عبر الإضافة؛ بيانات الدخول لا تُرسَل إلى أي خادم،
          وتُستخدم فقط لتعبئة نموذج تسجيل الدخول الفعلي في الموقع.
        </p>

        <div className="group">
          <label>١) قالب ملف الإكسل</label>
          <div className="btn-row">
            <a className="btn ghost" href={TEMPLATE_URL} download>
              ⬇️ تحميل القالب
            </a>
          </div>
        </div>

        <div className="group">
          <label>٢) رفع الملف بعد تعبئته</label>
          <div
            className={`dropzone ${isDragOver ? "dragover" : ""}`}
            style={{ height: 90, margin: 0 }}
            onClick={() => document.getElementById("hajjFileInput")?.click()}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDragEnter={onDragOver}
          >
            <span>{people ? `📄 ${fileName} (${people.length} اسمًا)` : "📥 انقر هنا أو اسحب ملف الإكسل وأفلِته"}</span>
          </div>
          <input id="hajjFileInput" type="file" accept=".xlsx,.xls" onChange={onFileInputChange} style={{ display: "none" }} />
        </div>

        <div className="group">
          <label>٣) بيانات الدخول (نظام الحج)</label>
          <input
            className="text"
            type="email"
            placeholder="البريد الإلكتروني"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ marginBottom: 8 }}
            disabled={jobState === "running"}
          />
          <input
            className="text"
            type="password"
            placeholder="كلمة المرور"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={jobState === "running"}
          />
        </div>

        {errorMessage && jobState !== "error" && <p className="mrz-error">{errorMessage}</p>}

        <div className="btn-row">
          <button
            className="btn success"
            onClick={handleStart}
            disabled={extensionStatus !== "ready" || jobState === "running" || !people}
          >
            {jobState === "running" ? "⏳ جارٍ التحميل..." : "🚀 ابدأ"}
          </button>
        </div>

        {jobState === "running" && progress && (
          <p className="mrz-status">
            <span className="mrz-spinner" />
            {progress.currentName ? `جارٍ معالجة: ${progress.currentName}` : "جارٍ التحميل..."} (
            {progress.done}/{progress.total})
          </p>
        )}
      </aside>
    </div>
  );
}

// ============================================================================
// دائرة نسبة مئوية
// ============================================================================

function ProgressRing({
  percent,
  currentName,
  done,
  total,
}: {
  percent: number;
  currentName: string;
  done: number;
  total: number;
}) {
  const radius = 80;
  const stroke = 12;
  const normalizedRadius = radius - stroke / 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="hajj-progress-wrap">
      <svg height={radius * 2} width={radius * 2} className="hajj-progress-ring">
        <circle
          stroke="#203049"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <circle
          stroke="#42b7ff"
          fill="transparent"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          style={{ strokeDashoffset: offset, transition: "stroke-dashoffset 0.3s" }}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <text x="50%" y="50%" textAnchor="middle" dy="0.35em" className="hajj-progress-text">
          {percent}%
        </text>
      </svg>
      <p className="hajj-progress-caption">
        {currentName ? `جارٍ معالجة: ${currentName}` : "جارٍ التحميل..."}
        <br />
        {done} / {total}
      </p>
    </div>
  );
}
