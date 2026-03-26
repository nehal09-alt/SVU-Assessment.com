const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");

const pdfPath = path.join(__dirname, "..", "CSE_2024", "CSE 2024.pdf");
const outTxt = path.join(__dirname, "..", "data", "cse2024.txt");

async function run() {
  if (!fs.existsSync(pdfPath)) {
    console.error(`PDF not found at ${pdfPath}. Please place the CSE 2024 PDF file in the CSE_2024 folder.`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(pdfPath);
  const data = await pdf(buffer);
  const text = (data && data.text) ? data.text : "";

  fs.writeFileSync(outTxt, text, "utf8");
  console.log(`Extracted text written to ${outTxt}`);

  const trimmed = text.trim();
  if (!trimmed) {
    console.warn(
      "No text was extracted from the PDF. It is likely a scanned/image-based PDF, so automated parsing is not possible without OCR.\n" +
      "Please open the PDF manually and copy the registration list into data/cse2024.json (see the existing sample entries)."
    );
    process.exit(0);
  }

  const regRegex = /\d{3}-\d{3}-\d{4}-\d{3}/g;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const matches = [];

  for (const line of lines) {
    const regs = line.match(regRegex);
    if (regs) {
      matches.push(line);
    }
  }

  if (matches.length === 0) {
    console.warn(
      "No registration numbers were detected in the extracted text.\n" +
      "Please inspect data/cse2024.txt and then manually populate data/cse2024.json."
    );
    process.exit(0);
  }

  console.log("Sample lines containing registration numbers (first 20):\n");
  matches.slice(0, 20).forEach((line) => console.log(line));
  console.log("\nUse these lines to build structured JSON in data/cse2024.json.");
}

run().catch((err) => {
  console.error("Error while extracting PDF:", err);
  process.exit(1);
});
