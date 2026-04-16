# SVU Assessment Portal

A comprehensive web-based platform for **SWAMI VIVEKANANDA University (SVU)** designed to manage student registration, secure authentication, and academic assessments. The portal streamlines the student onboarding process and provides dedicated dashboards for both students and faculty to track assessments and academic progress efficiently.

## 🎯 Project Overview

SVU Assessment Portal is an educational technology solution built with **Node.js and Express.js** that digitizes the student registration and assessment management process. It provides a secure, user-friendly platform for students to register, authenticate, and access their academic information, while faculty can manage student records and assessments seamlessly.

### Core Purpose
- Enable secure student registration and authentication
- Manage coursework assessments and grades
- Extract and process student data from various file formats
- Provide role-based dashboards for students and faculty
- Ensure secure handling of sensitive educational data

---

## ✨ Key Features

### 1. Student Registration System
- Simple, intuitive sign-up form with validation
- Email verification process
- Strong password requirements (uppercase, lowercase, numbers, special characters)
- Pre-populated student data from university database
- Automatic account creation upon successful registration

### 2. Secure Authentication
- **Password Hashing**: bcrypt implementation with 10 salt rounds
- Login/Sign-in functionality with credential verification
- Session management for user tracking
- Role-based access control (Student/Faculty)
- Secure credential storage with no plain-text passwords

### 3. Password Recovery & OTP System
- "Forgot Password" functionality
- **OTP Generation**: 6-digit time-limited codes
- **Email Delivery**: Via Gmail SMTP integration using Nodemailer
- Secure password reset with re-hashing
- OTP expiration after 10 minutes
- No sensitive data logging

### 4. Student Dashboard
After login, students can view:
- Personal academic information (Name, Admission Number, Registration Number)
- Enrolled courses with semester and year details
- Assessment status and progress tracking
- Academic performance metrics and grades
- Mobile-responsive design for accessibility

### 5. Faculty Dashboard
Faculty members can:
- View all registered student records
- Upload and manage student data files
- Extract data from CSV and PDF formats
- Process bulk student information updates
- Generate reports and analytics

### 6. Data Extraction & Processing
- **CSV Processing**: Extract and import student records from spreadsheets
- **PDF Text Extraction**: Parse student information from PDF documents
- **OCR (Optical Character Recognition)**: Process scanned documents using Tesseract.js
- **Automated Validation**: Sanitize and validate extracted data
- **Bulk Updates**: Import multiple student records at once

### 7. Multi-Page Responsive UI
- **Landing Page**: Portal introduction and feature overview
- **Sign-Up Page**: Student registration form with validation
- **Sign-In Page**: Secure login with forgot password option
- **Student Dashboard**: Personal academic information and assessment status
- **Faculty Dashboard**: Student management and data import tools
- **Notice Board**: Announcements and important notifications
- **Mobile-Friendly**: Responsive design for all devices

### 8. Email Integration
- **Nodemailer Integration**: Gmail SMTP configuration
- OTP delivery via email
- Password recovery emails
- Secure SMTP credentials management via `.env` file
- No hardcoded sensitive information

---

## 🔧 Technology Stack

### Backend
- **Node.js**: JavaScript runtime environment
- **Express.js** (v4.22.1): Web application framework
- **bcrypt** (v6.0.0): Cryptographic password hashing
- **Nodemailer** (v6.10.1): Email service integration

### Frontend
- **HTML5**: Semantic markup and structure
- **CSS3**: Responsive styling and layout
- **Vanilla JavaScript**: Client-side interactivity

### Data Processing
- **pdf-parse** (v1.1.1): PDF text extraction
- **pdfjs-dist** (v5.5.207): PDF rendering and processing
- **tesseract.js** (v7.0.0): OCR for scanned documents
- **canvas** (v3.2.1): Image processing capabilities

### Data Storage
- **JSON Files**: Lightweight file-based storage
  - `registrations.json`: Student accounts & login credentials
  - `students.json`: Student academic information

### Other Tools
- **Git**: Version control
- **npm**: Node Package Manager

---

