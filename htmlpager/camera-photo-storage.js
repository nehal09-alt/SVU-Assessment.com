(function initCameraPhotoStorage() {
  const PHOTO_PREFIX = "svuPhoto:";
  const STATUS_PREFIX = "svuCameraStatus:";
  const UPLOAD_PREFIX = "svuPhotoUploadAt:";
  const PERMISSION_KEY = "svuCameraPermission";

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (_) {
      // Ignore storage quota / availability failures.
    }
  }

  function normalizeRegNumber(regNumber) {
    return String(regNumber || "").trim();
  }

  window.cameraPhotoStorage = window.cameraPhotoStorage || {
    getPhotoData(regNumber) {
      const key = PHOTO_PREFIX + normalizeRegNumber(regNumber);
      return safeGet(key) || "";
    },
    savePhotoData(regNumber, dataUrl) {
      const key = PHOTO_PREFIX + normalizeRegNumber(regNumber);
      safeSet(key, dataUrl || "");
    },
    savePhotoUploadTimestamp(regNumber) {
      const key = UPLOAD_PREFIX + normalizeRegNumber(regNumber);
      safeSet(key, new Date().toISOString());
    },
    getPhotoUploadTimestamp(regNumber) {
      const key = UPLOAD_PREFIX + normalizeRegNumber(regNumber);
      return safeGet(key) || "";
    },
    saveCameraStatus(regNumber, status) {
      const key = STATUS_PREFIX + normalizeRegNumber(regNumber);
      safeSet(key, status || "");
    },
    getCameraStatus(regNumber) {
      const key = STATUS_PREFIX + normalizeRegNumber(regNumber);
      return safeGet(key) || "";
    },
    saveCameraPermission(status) {
      safeSet(PERMISSION_KEY, status || "");
    },
    getCameraPermission() {
      return safeGet(PERMISSION_KEY) || "";
    },
  };
})();
