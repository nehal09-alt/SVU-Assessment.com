 const fs = require("fs");
const path = require("path");
const { supabase } = require("./supabase-client");

const CSV_PATH = path.join(__dirname, "..", "Subject_list_allcourses .csv");
let cachedCourses = null;

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    values.push(current.trim());
  }

  return values;
}

function loadCoursesFromCsv() {
  if (cachedCourses) {
    return cachedCourses;
  }

  if (!fs.existsSync(CSV_PATH)) {
    cachedCourses = [];
    return cachedCourses;
  }

  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  const header = lines.shift();
  if (!header) {
    cachedCourses = [];
    return cachedCourses;
  }

  const rows = lines.map((line) => {
    const parts = splitCsvLine(line);
    if (parts.length < 4) return null;

    return {
      course: parts[0].trim(),
      year: parts[1].trim(),
      semester: parts[2].trim(),
      subject: parts[3].trim(),
    };
  }).filter((row) => row && row.course && row.subject);

  cachedCourses = rows;
  return cachedCourses;
}

function getCourseList() {
  return loadCoursesFromCsv();
}

function getUniqueCourseNames() {
  const courses = loadCoursesFromCsv();
  const names = courses.map((row) => row.course);
  return [...new Set(names)].sort();
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeCourseName(value) {
  let normalized = normalizeText(value);

  normalized = normalized
    .replace(/\b(btech cse|b tech cse|b\.tech cse|b tech in computer science engineering|btech in computer science engineering|b tech in computer science and engineering|btech in computer science and engineering|computer science and engineering|computer science engineering)\b/g, "cse")
    .replace(/\bcomputer science\b/g, "cse")
    .replace(/\b(bca|bachelor of computer applications|computer applications)\b/g, "bca")
    .replace(/\bb\.tech\b/g, "btech")
    .replace(/\bengineering\b/g, "eng");

  return normalized.trim();
}

function getCoursesFor(course, semester) {
  const rows = loadCoursesFromCsv();
  if (!course && !semester) return rows;

  const normalizedCourse = normalizeCourseName(course);
  const normalizedSemester = String(semester || "").trim().toLowerCase();

  return rows.filter((row) => {
    const rowCourseNormalized = normalizeCourseName(row.course);
    const matchesCourse = course
      ? rowCourseNormalized.includes(normalizedCourse) || normalizedCourse.includes(rowCourseNormalized)
      : true;
    const matchesSemester = semester
      ? String(row.semester).trim().toLowerCase() === normalizedSemester
      : true;
    return matchesCourse && matchesSemester;
  });
}

function getSemestersForCourse(course) {
  const rows = loadCoursesFromCsv();
  if (!course) return [];

  const normalizedCourse = normalizeCourseName(course);
  const semesters = rows
    .filter((row) => {
      const rowCourseNormalized = normalizeCourseName(row.course);
      return rowCourseNormalized.includes(normalizedCourse) || normalizedCourse.includes(rowCourseNormalized);
    })
    .map((row) => String(row.semester).trim())
    .filter((sem) => sem);

  return [...new Set(semesters)].sort((a, b) => Number(a) - Number(b));
}

async function importCoursesToSupabase() {
  const rows = loadCoursesFromCsv();
  if (rows.length === 0) {
    return { success: false, message: "No course data found in CSV." };
  }

  // Remove duplicates based on the primary key (course, year, semester, subject)
  const uniqueRows = rows.filter((row, index, self) =>
    index === self.findIndex(r =>
      r.course === row.course &&
      r.year === row.year &&
      r.semester === row.semester &&
      r.subject === row.subject
    )
  );

  try {
    const { data, error } = await supabase
      .from("courses")
      .upsert(uniqueRows, { onConflict: ["course", "year", "semester", "subject"] })
      .select();

    if (error) {
      return { success: false, message: error.message || "Supabase upsert failed" };
    }

    return { success: true, count: Array.isArray(data) ? data.length : 0 };
  } catch (err) {
    return { success: false, message: err.message || "Unknown error" };
  }
}

function parseOrdinalNumber(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

async function getSupabaseCoursesForStudent(course, semester, year) {
  const normalizedCourse = normalizeCourseName(course);
  const normalizedSemester = String(semester || "").trim();
  const numericYear = parseOrdinalNumber(year);

  try {
    const { data, error } = await supabase
      .from("courses")
      .select("course, year, semester, subject")
      .eq("semester", normalizedSemester);

    if (error) {
      return { success: false, message: error.message || "Could not load courses from Supabase." };
    }

    const rows = (data || []).filter((row) => {
      const rowCourseNormalized = normalizeCourseName(row.course);
      const rowYear = parseOrdinalNumber(row.year);
      const matchesCourse = normalizedCourse
        ? rowCourseNormalized.includes(normalizedCourse) || normalizedCourse.includes(rowCourseNormalized)
        : true;
      const matchesYear = numericYear ? rowYear === numericYear : true;
      return matchesCourse && matchesYear;
    });

    return { success: true, subjects: rows };
  } catch (err) {
    return { success: false, message: err.message || "Could not load courses from Supabase." };
  }
}

module.exports = {
  getCourseList,
  getUniqueCourseNames,
  getCoursesFor,
  getSemestersForCourse,
  getSupabaseCoursesForStudent,
  importCoursesToSupabase,
};
