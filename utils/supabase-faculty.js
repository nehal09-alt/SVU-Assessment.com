const { supabase } = require("./supabase-client");

async function findFacultyByEmail(email) {
  if (!email) return null;
  try {
    const { data, error } = await supabase
      .from("faculty")
      .select("*")
      .eq("email", email.toLowerCase())
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      console.error("Error finding faculty by email:", error);
      return null;
    }

    return data || null;
  } catch (err) {
    console.error("Error finding faculty by email:", err);
    return null;
  }
}

async function saveFaculty(facultyData) {
  if (!facultyData || !facultyData.email) {
    return null;
  }

  try {
    const normalized = {
      ...facultyData,
      email: facultyData.email.toLowerCase(),
      approved: facultyData.approved !== false,
      subjects: Array.isArray(facultyData.subjects)
        ? facultyData.subjects
        : facultyData.subjects
        ? String(facultyData.subjects).split(/\s*[,;]\s*/).filter(Boolean)
        : [],
    };

    const { data, error } = await supabase
      .from("faculty")
      .upsert(normalized, { onConflict: "email" })
      .select();

    if (error) {
      console.error("Error saving faculty:", error);
      return null;
    }

    return data?.[0] || null;
  } catch (err) {
    console.error("Error saving faculty:", err);
    return null;
  }
}

async function loadFaculty() {
  try {
    const { data, error } = await supabase
      .from("faculty")
      .select("*");

    if (error) {
      console.error("Error loading faculty list:", error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("Error loading faculty list:", err);
    return [];
  }
}

module.exports = {
  findFacultyByEmail,
  saveFaculty,
  loadFaculty,
};
