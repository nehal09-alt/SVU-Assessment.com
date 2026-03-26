const fs = require("fs");
const path = require("path");
const { createCanvas } = require("canvas");
const { recognize } = require("tesseract.js");

const pdfPath = path.join(__dirname, "..", "CSE_2024", "CSE 2024.pdf");
const outTxt = path.join(__dirname, "..", "data", "cse2024-ocr.txt");
const outJson = path.join(__dirname, "..", "data", "cse2024.json");

async function renderPageToPng(page) {
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d");

  const renderContext = {
    canvasContext: ctx,
    viewport,
  };

  await page.render(renderContext).promise;
  return canvas.toBuffer("image/png");
}

function parseRecordsFromText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => !!l);

  const regRegex = /\d{3}-\d{3}-\d{4}-\d{3}/g;
  const records = [];

  for (const line of lines) {
    const regs = line.match(regRegex);
    if (!regs) continue;

    // Try to split by whitespace and find reg number index
    const parts = line.split(/\s+/);
    const regIndex = parts.findIndex((p) => regRegex.test(p));
    if (regIndex === -1) continue;

    const regNumber = parts[regIndex];
    const nameParts = parts.slice(regIndex + 1);
    const studentName = nameParts.join(" ").replace(/\s{2,}/g, " ").trim();

    if (!studentName) continue;

    records.push({ regNumber, studentName, admitNumber: "" });
  }

  return records;
}

async function run() {
  if (!fs.existsSync(pdfPath)) {
    console.error(`PDF not found at ${pdfPath}`);
    process.exit(1);
  }

  // pdfjs-dist is only available as ESM. Dynamically import it here.
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  let fullText = "";
  const allRecords = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    console.log(`\nRendering page ${i}/${pdf.numPages}...`);
    const page = await pdf.getPage(i);
    const image = await renderPageToPng(page);

    console.log("Running OCR...");
    const { data: { text } } = await recognize(image, "eng");

    fullText += text + "\n";

    const records = parseRecordsFromText(text);
    if (records.length > 0) {
      console.log(`Found ${records.length} record(s) on page ${i}`);
      allRecords.push(...records);
    }
  }

  fs.writeFileSync(outTxt, fullText, "utf8");
  console.log(`\nOCR output written to ${outTxt}`);

  if (allRecords.length === 0) {
    console.warn("No structured student records were detected. Please inspect the OCR output file manually.");
    process.exit(0);
  }

  // Deduplicate by regNumber
  const map = new Map();
  for (const rec of allRecords) {
    if (!map.has(rec.regNumber)) {
      map.set(rec.regNumber, rec);
    }
  }

  const finalRecords = Array.from(map.values());
  fs.writeFileSync(outJson, JSON.stringify(finalRecords, null, 2), "utf8");
  console.log(`Wrote ${finalRecords.length} parsed records to ${outJson}`);
}

run().catch((err) => {
  console.error("Error during OCR extraction:", err);
  process.exit(1);
});
