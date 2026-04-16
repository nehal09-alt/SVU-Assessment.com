(function initSvuModal() {
  function alertModal(message, tone) {
    const text = String(message || "Something went wrong.");
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(text);
      return;
    }
    console[tone === "error" ? "error" : "log"](text);
  }

  window.svuModal = window.svuModal || {
    alert: alertModal,
  };
})();
