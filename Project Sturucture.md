## 📁 Project Structure

SVU.assessment.com/
│
├── htmlpager/ # Frontend HTML & CSS
│ ├── SVUlanding.html # Landing page with portal intro
│ ├── SVUsingup.html # Student registration form
│ ├── SVUsignin.html # Login page
│ ├── SVUdashboard.html # Student dashboard
│ ├── SVUfaculty.html # Faculty management portal
│ ├── SVUnotice.html # Notice & announcements board
│ └── SVUdashboard.css # Responsive styling
│
├── scripts/ # Data processing utilities
│ ├── extract-cse2024.js # CSV extraction script
│ ├── extract-pdf-cse2024.js # PDF extraction script
│ └── ocr-cse2024.js # OCR processing script
│
├── utils/ # Helper modules
│ └── mailer.js # Email configuration & sending
│
├── data/ # Data storage (local JSON)
│ ├── registrations.json # Student login credentials
│ └── students.json # Student academic records
│
├── server.js # Express server setup & routes
├── package.json # Project dependencies
└── .gitignore # Git ignore configuration



## 🚀 How It Works

### User Registration Flow
1. New student visits `/SVUsingup.html`
2. Enters registration number, name, email, and password
3. System validates input and checks for duplicates
4. Password is hashed using bcrypt (10 salt rounds)
5. Account stored in `data/registrations.json`
6. User redirected to sign-in page
7. Can now login with credentials

### User Login Flow
1. Student enters email and password on `/SVUsignin.html`
2. System retrieves record from database
3. Password compared using bcrypt.compare() for secure verification
4. On success → redirected to `/SVUdashboard.html`
5. On failure → error message displayed
6. Session maintained for dashboard access

### Password Recovery Flow
1. Student clicks "Forgot Password" on login page
2. Enters registered email address
3. System generates 6-digit OTP
4. OTP sent via Gmail SMTP email integration
5. Student enters OTP on verification page
6. If valid OTP → redirected to password reset form
7. Student enters new password (bcrypt hashed)
8. Database updated with new password

### Data Extraction Flow
1. Faculty uploads CSV or PDF file via `/SVUfaculty.html`
2. `scripts/extract-cse2024.js` or `scripts/extract-pdf-cse2024.js` processes file
3. Data extracted and validated
4. For scanned documents, `scripts/ocr-cse2024.js` processes with OCR
5. Data sanitized and formatted to JSON
6. Bulk inserted into `data/students.json`
7. Records now available in student database
