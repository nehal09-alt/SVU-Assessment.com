const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

/**
 * Agent 1: Extract student data from CSE 2024 PDF
 * Reads the PDF file and extracts student information (regNumber, studentName)
 * Saves the extracted data to cse2024.json
 */

const pdfPath = path.join(__dirname, "..", "CSE_2024", "CSE 2024.pdf");
const outputPath = path.join(__dirname, "..", "data", "cse2024.json");

async function extractPdfData() {
  try {
    if (!fs.existsSync(pdfPath)) {
      console.error("PDF file not found at:", pdfPath);
      process.exit(1);
    }

    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfData = await pdfParse(pdfBuffer);
    const text = pdfData.text;

    // Extract student data using regex patterns
    // Looking for patterns like:
    // - Registration Number: 002-103-2024-XXX
    // - Student Name: Name

    const students = [];
    const lines = text.split("\n");

    let currentStudent = {
      regNumber: "",
      admitNumber: "",
      studentName: "",
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Match registration number pattern: XXX-XXX-XXXX-XXX
      const regMatch = line.match(/(\d{3})-(\d{3})-(\d{4})-(\d{3})/);
      if (regMatch) {
        if (currentStudent.regNumber && currentStudent.studentName) {
          students.push({ ...currentStudent });
        }
        currentStudent = {
          regNumber: regMatch[0],
          admitNumber: "",
          studentName: "",
        };
        continue;
      }

      // Match student name (capital letters followed by lowercase or spaces)
      const nameMatch = line.match(/^([A-Z][a-z]+(?: [A-Z][a-z]+)*)$/);
      if (nameMatch && currentStudent.regNumber) {
        currentStudent.studentName = nameMatch[1];
      }
    }

    // Add the last student if exists
    if (currentStudent.regNumber && currentStudent.studentName) {
      students.push(currentStudent);
    }

    if (students.length === 0) {
      console.warn("⚠️  No students extracted from PDF. PDF format may be different.");
      console.log("Attempting to read cse2024.txt file instead...");
      extractFromTextFile();
      return;
    }

    // Remove duplicates
    const uniqueStudents = Array.from(
      new Map(students.map((s) => [s.regNumber, s])).values()
    );

    // Write to JSON file
    fs.writeFileSync(
      outputPath,
      JSON.stringify(uniqueStudents, null, 2),
      "utf8"
    );

    console.log(
      `✓ Extracted ${uniqueStudents.length} unique students from PDF`
    );
    console.log(`✓ Data saved to: ${path.relative(process.cwd(), outputPath)}`);
  } catch (error) {
    console.error("Error extracting PDF data:", error.message);
    console.log("Attempting to read cse2024.txt file instead...");
    extractFromTextFile();
  }
}

function extractFromTextFile() {
  try {
    const textPath = path.join(__dirname, "..", "data", "cse2024.txt");
    if (!fs.existsSync(textPath)) {
      console.error("Text file not found at:", textPath);
      process.exit(1);
    }

    const textContent = fs.readFileSync(textPath, "utf8");
    const students = [];

    const lines = textContent.split("\n");

    let currentStudent = {
      regNumber: "",
      admitNumber: "",
      studentName: "",
    };

    for (const line of lines) {
      const trimmed = line.trim();

      // Match registration number pattern: XXX-XXX-XXXX-XXX
      const regMatch = trimmed.match(/(\d{3})-(\d{3})-(\d{4})-(\d{3})/);
      if (regMatch) {
        if (currentStudent.regNumber && currentStudent.studentName) {
          students.push({ ...currentStudent });
        }
        currentStudent = {
          regNumber: regMatch[0],
          admitNumber: "",
          studentName: "",
        };
      }

      // Match student name (capital letters followed by lowercase or spaces)
      const nameMatch = trimmed.match(/^([A-Z][a-z]+(?: [A-Z][a-z]+)*)$/);
      if (nameMatch && currentStudent.regNumber) {
        currentStudent.studentName = nameMatch[1];
      }
    }

    // Add the last student if exists
    if (currentStudent.regNumber && currentStudent.studentName) {
      students.push(currentStudent);
    }

    if (students.length === 0) {
      console.warn(
        "⚠️  No students extracted. Check the format of cse2024.txt"
      );
      process.exit(1);
    }

    // Remove duplicates
    const uniqueStudents = Array.from(
      new Map(students.map((s) => [s.regNumber, s])).values()
    );

    // Write to JSON file
    fs.writeFileSync(
      outputPath,
      JSON.stringify(uniqueStudents, null, 2),
      "utf8"
    );

    console.log(
      `✓ Extracted ${uniqueStudents.length} unique students from text file`
    );
    console.log(`✓ Data saved to: ${path.relative(process.cwd(), outputPath)}`);
  } catch (error) {
    console.error("Error extracting text data:", error.message);
    process.exit(1);
  }
}

// Run the extraction
extractPdfData();
