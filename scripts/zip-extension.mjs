// يبني public/hajj-extension.zip من مجلد hajj-extension/ ليصير قابل للتحميل من الصفحة.
// يشتغل قبل vite build (وممكن يشتغل يدويًا: node scripts/zip-extension.mjs)
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = join(__dirname, "..");
const extDir = join(root, "hajj-extension");
const outDir = join(root, "public");
const outFile = join(outDir, "hajj-extension.zip");

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const zip = new JSZip();
  const files = walk(extDir);
  for (const file of files) {
    const rel = relative(extDir, file).replace(/\\/g, "/");
    zip.file(rel, readFileSync(file));
  }
  mkdirSync(outDir, { recursive: true });
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  writeFileSync(outFile, buf);
  console.log(`✓ hajj-extension.zip (${files.length} ملفات) -> ${outFile}`);
}

main().catch((err) => {
  console.error("فشل تعبئة الإضافة:", err);
  process.exit(1);
});
