# ملاحظات ميزة "تحميل بطاقات الحج" (للمطوّر فقط — مش جزء من الموقع)

## شو تم

- `src/HajjDownloader.tsx` — الصفحة الجديدة (`/hajj-download`)، مضافة بالـ Nav بعد `/mrz`.
- `hajj-extension/` — كود إضافة Chrome (Manifest V3) اللي تسوي كل الأتمتة محليًا بجهاز المستخدم.
- `scripts/zip-extension.mjs` — يبني `public/hajj-extension.zip` تلقائيًا قبل كل `npm run build`
  (وممكن تشغّله لحاله بـ `npm run build:extension`).
- `PRIVATE_KEEP_extension_signing_key/` (بجانب هذا المجلد، مو جواه) — فيها المفتاح الخاص المستخدم
  لتوليد معرّف ثابت للإضافة. **لا ترفعها لأي مكان عام ولا تحذفها** — لو ضاعت، أي تحديث مستقبلي
  للإضافة رح ياخد معرّف (ID) مختلف، ولازم تحدّث `EXTENSION_ID` بـ `HajjDownloader.tsx` من جديد.

## شغلتين لازم تتابعهم

1. **رابط فيديو يوتيوب**: بأعلى `src/HajjDownloader.tsx` في ثابت `YOUTUBE_TUTORIAL_URL = ""`.
   لما يجهز الفيديو، حطّ رابطه هون وأعد البناء والنشر.

2. **دومين Netlify الفعلي**: بملف `hajj-extension/manifest.json`، `externally_connectable.matches`
   فيها حاليًا `https://*.netlify.app/*` (بيغطي أي موقع نيتليفاي مبدئيًا). إذا حطّيت دومين خاص
   (custom domain) بدل `xxx.netlify.app`، **لازم تضيفه هون كمان**، وبعدها:
   - أعد توليد الملف: `npm run build:extension`
   - أعد نشر الموقع (rebuild + redeploy)
   - أي نسخة قديمة من الإضافة عند المستخدمين لازم يعيدوا تحميلها من جديد (الملف تغيّر).

## اختبار محلي سريع

```
npm run dev
```
افتح `http://localhost:5173/hajj-download`، حمّل الإضافة (Load unpacked) من مجلد `hajj-extension/`
مباشرة (بدون فك ضغط، فولدر لحاله كافي بوضع المطوّر)، اضغط "تأكد من التثبيت"، وجرّب برفع ملف إكسل
فيه اسمين تجريبيين.
