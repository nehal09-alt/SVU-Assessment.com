const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const { isEmailConfigured, sendOtpEmail } = require("./utils/mailer");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!key) continue;
    if (typeof process.env[key] === "undefined") {
      process.env[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }
}

loadEnvFile();

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(express.json());

// Serve the client HTML/JS/CSS from the htmlpager folder.
// This makes URLs like /SVUassessment.html work without needing /htmlpager/ prefix.
app.use(express.static(path.join(__dirname, "htmlpager")));

const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "registrations.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(dataFile)) {
  fs.writeFileSync(dataFile, "[]", "utf8");
}

let studentData = [];

function loadStudentData() {
  // Try loading from JSON first (preferred)
  const jsonPath = path.join(__dirname, 'data', 'students.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const jsonData = fs.readFileSync(jsonPath, 'utf8');
      studentData = JSON.parse(jsonData) || [];
      console.log(`Loaded ${studentData.length} student records from JSON`);
      return;
    } catch (err) {
      console.error('Error loading JSON:', err.message);
    }
  }

  // Fallback to CSV parsing
  const csvPath = path.join(__dirname, 'CSE_2024', 'CSE 2024.csv');
  if (fs.existsSync(csvPath)) {
    try {
      const data = fs.readFileSync(csvPath, 'utf8');
      const lines = data.split('\n');
      const headerIndex = lines.findIndex(line => line.startsWith('S.No.,Name'));
      if (headerIndex !== -1) {
        const dataLines = lines.slice(headerIndex + 1);
        studentData = dataLines.map(line => {
          const parts = line.split(',').map(s => s.trim());
          if (parts.length >= 8 && parts[0] && parts[3]) {
            return {
              sno: parts[0],
              name: parts[1],
              dept: parts[2],
              regNum: parts[3],
              rollNum: parts[4],
              abcId: parts[5] || '',
              dob: parts[6] || '',
              gender: parts[7] || ''
            };
          }
          return null;
        }).filter(item => item && item.regNum);
      }
      console.log(`Loaded ${studentData.length} student records from CSV`);
    } catch (err) {
      console.error('Error loading CSV:', err.message);
    }
  }

  if (studentData.length === 0) {
    console.warn('No student data loaded from JSON or CSV');
  }
}

loadStudentData();

/**
 * Read a JSON file and safely return an array.
 * If the file is missing/invalid, it returns an empty array.
 */
function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw || "[]");
  } catch (e) {
    return [];
  }
}

/**
 * Validate password requirements:
 * - Must contain lowercase letter
 * - Must contain number
 * - Must contain special character (!@#$%^&*)
 * - Must not contain uppercase letter
 */
function validatePassword(password) {
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*]/.test(password);
  const hasNoUppercase = !/[A-Z]/.test(password);

  return {
    isValid: hasLowercase && hasNumber && hasSpecial && hasNoUppercase,
    hasLowercase,
    hasNumber,
    hasSpecial,
    hasNoUppercase,
  };
}

app.get("/student-info", (req, res) => {
  const regNumber = (req.query.regNumber || "").toString().trim();
  if (!regNumber) {
    return res.status(400).json({ message: "regNumber is required" });
  }

  const match = studentData.find((s) => s.regNum === regNumber);
  if (!match) {
    return res.status(404).json({ message: "Registration number not found" });
  }

  return res.status(200).json({
    regNumber: match.regNum,
    admitNumber: match.rollNum || "",
    studentName: match.name || "",
  });
});

// Backwards compatibility and proper signup route redirection.
app.get(["/SVUsignup.html", "/SVUassessment.html", "/signup"], (req, res) => {
  res.redirect(302, "/SVUsingup.html");
});

app.post("/signup", (req, res) => {
  const body = req.body || {};

  if (!body.regNumber || !body.email || !body.password) {
    return res.status(400).json({ message: "regNumber, email and password are required" });
  }

  // Validate password requirements
  const passwordValidation = validatePassword(body.password);
  if (!passwordValidation.isValid) {
    let errors = [];
    if (!passwordValidation.hasLowercase) errors.push("lowercase letter");
    if (!passwordValidation.hasNumber) errors.push("number");
    if (!passwordValidation.hasSpecial) errors.push("special character (!@#$%^&*)");
    if (!passwordValidation.hasNoUppercase) errors.push("no uppercase letters");
    
    return res.status(400).json({ 
      message: `Password must contain: ${errors.join(", ")}` 
    });
  }

  const newEntry = {
    studentName: body.studentName || "",
    regNumber: body.regNumber,
    admitNumber: body.admitNumber || "",
    email: body.email,
    course: body.course || "",
    year: body.year || "",
    semester: body.semester || "",
    // Password is now hashed using bcrypt for security
    password: body.password,
    createdAt: body.createdAt || new Date().toISOString(),
    otp: null,
    otpExpiresAt: null,
  };

  fs.readFile(dataFile, "utf8", (err, content) => {
    if (err) {
      console.error("Error reading data file:", err);
      return res.status(500).json({ message: "Error reading data file" });
    }

    let list = [];
    try {
      list = JSON.parse(content || "[]");
    } catch (e) {
      console.error("Error parsing JSON file:", e);
    }

    // Ensure registration number is unique
    const exists = list.find(
      (entry) =>
        entry.regNumber === newEntry.regNumber &&
        entry.email === newEntry.email
    );

    if (exists) {
      return res.status(409).json({ message: "Account already exists for this registration number and email" });
    }

    // Hash the password before storing
    bcrypt.hash(newEntry.password, 10, (err, hash) => {
      if (err) {
        console.error("Error hashing password:", err);
        return res.status(500).json({ message: "Error processing password" });
      }

      newEntry.password = hash;

      list.push(newEntry);

      // Check if regNumber is in CSV data
      const isIdentified = studentData.some(s => s.regNum === body.regNumber);
      if (!isIdentified) {
        const unidentifiedDir = path.join(dataDir, 'unidentified');
        if (!fs.existsSync(unidentifiedDir)) {
          fs.mkdirSync(unidentifiedDir, { recursive: true });
        }
        const unidentifiedData = {
          ...newEntry,
          timestamp: new Date().toISOString()
        };
        const filePath = path.join(unidentifiedDir, `${body.regNumber}.json`);
        fs.writeFileSync(filePath, JSON.stringify(unidentifiedData, null, 2));
      }

      fs.writeFile(dataFile, JSON.stringify(list, null, 2), "utf8", (writeErr) => {
        if (writeErr) {
          console.error("Error writing data file:", writeErr);
          return res.status(500).json({ message: "Error saving data" });
        }

        res.status(201).json({ message: "Signup stored successfully" });
      });
    });
  });
});

app.post("/signin", (req, res) => {
  const body = req.body || {};

  if (!body.regNumber || !body.email || !body.password) {
    return res.status(400).json({ message: "regNumber, email and password are required" });
  }

  fs.readFile(dataFile, "utf8", (err, content) => {
    if (err) {
      console.error("Error reading data file:", err);
      return res.status(500).json({ message: "Error reading data file" });
    }

    let list = [];
    try {
      list = JSON.parse(content || "[]");
    } catch (e) {
      console.error("Error parsing JSON file:", e);
    }

    const match = list.find(
      (entry) =>
        entry.regNumber === body.regNumber &&
        entry.email === body.email
    );

    if (!match) {
      return res.status(401).json({ message: "No account found for this registration number and email" });
    }

    // Compare hashed password
    bcrypt.compare(body.password, match.password, (err, isMatch) => {
      if (err) {
        console.error("Error comparing password:", err);
        return res.status(500).json({ message: "Error verifying password" });
      }

      if (!isMatch) {
        return res.status(401).json({ message: "Incorrect password" });
      }

      return res.status(200).json({
        message: "Sign in successful",
        studentName: match.studentName || "",
      });
    });
  });
});

app.post("/forgot-password", (req, res) => {
  const body = req.body || {};

  if (!body.email) {
    return res.status(400).json({ message: "Email is required" });
  }

  if (!isEmailConfigured()) {
    return res.status(500).json({
      message: "Email service is not configured. Please contact administrator.",
    });
  }

  fs.readFile(dataFile, "utf8", (err, content) => {
    if (err) {
      console.error("Error reading data file:", err);
      return res.status(500).json({ message: "Error reading data file" });
    }

    let list = [];
    try {
      list = JSON.parse(content || "[]");
    } catch (e) {
      console.error("Error parsing JSON file:", e);
    }

    const userIndex = list.findIndex((entry) => entry.email === body.email);

    if (userIndex === -1) {
      return res.status(404).json({ message: "No account found with this email" });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    sendOtpEmail(body.email, otp)
      .then(() => {
        list[userIndex].otp = otp;
        list[userIndex].otpExpiresAt = expiresAt;

        fs.writeFile(dataFile, JSON.stringify(list, null, 2), "utf8", (writeErr) => {
          if (writeErr) {
            console.error("Error writing data file:", writeErr);
            return res.status(500).json({ message: "Error saving OTP" });
          }

          return res.status(200).json({ message: "OTP sent to your email." });
        });
      })
      .catch((mailErr) => {
        console.error("Error sending OTP email:", mailErr.message || mailErr);
        const code = mailErr && mailErr.code ? String(mailErr.code) : "";
        let responseMessage = "Unable to send OTP email right now. Please try again later.";
        if (code === "EAUTH") {
          responseMessage =
            "SMTP authentication failed. Please check SMTP_USER and SMTP_PASS (use Gmail App Password).";
        } else if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION") {
          responseMessage =
            `SMTP connection failed (${code}). Check internet/firewall and SMTP host/port settings.`;
        } else if (code) {
          responseMessage = `SMTP error (${code}). Please verify email configuration.`;
        }

        return res.status(500).json({
          message: responseMessage,
        });
      });
  });
});

app.post("/reset-password", (req, res) => {
  const body = req.body || {};

  if (!body.email || !body.otp || !body.newPassword) {
    return res.status(400).json({ message: "email, otp and newPassword are required" });
  }

  fs.readFile(dataFile, "utf8", (err, content) => {
    if (err) {
      console.error("Error reading data file:", err);
      return res.status(500).json({ message: "Error reading data file" });
    }

    let list = [];
    try {
      list = JSON.parse(content || "[]");
    } catch (e) {
      console.error("Error parsing JSON file:", e);
    }

    const userIndex = list.findIndex((entry) => entry.email === body.email);

    if (userIndex === -1) {
      return res.status(404).json({ message: "No account found with this email" });
    }

    const user = list[userIndex];

    if (!user.otp || !user.otpExpiresAt) {
      return res.status(400).json({ message: "No OTP request found. Please request a new OTP." });
    }

    if (Date.now() > user.otpExpiresAt) {
      return res.status(400).json({ message: "OTP has expired. Please request a new OTP." });
    }

    if (user.otp !== body.otp) {
      return res.status(401).json({ message: "Invalid OTP" });
    }

    const passwordValidation = validatePassword(body.newPassword);
    if (!passwordValidation.isValid) {
      let errors = [];
      if (!passwordValidation.hasLowercase) errors.push("lowercase letter");
      if (!passwordValidation.hasNumber) errors.push("number");
      if (!passwordValidation.hasSpecial) errors.push("special character (!@#$%^&*)");
      if (!passwordValidation.hasNoUppercase) errors.push("no uppercase letters");

      return res.status(400).json({
        message: `Password must contain: ${errors.join(", ")}`
      });
    }

    // Hash the new password
    bcrypt.hash(body.newPassword, 10, (err, hash) => {
      if (err) {
        console.error("Error hashing new password:", err);
        return res.status(500).json({ message: "Error processing new password" });
      }

      user.password = hash;
      user.otp = null;
      user.otpExpiresAt = null;

      list[userIndex] = user;

      fs.writeFile(dataFile, JSON.stringify(list, null, 2), "utf8", (writeErr) => {
        if (writeErr) {
          console.error("Error writing data file:", writeErr);
          return res.status(500).json({ message: "Error saving new password" });
        }

        return res.status(200).json({ message: "Password reset successful" });
      });
    });
  });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Stop the other server or run this app with a different port, for example: $env:PORT=3002; node server.js`
    );
    return;
  }

  console.error("Server failed to start:", err);
});

