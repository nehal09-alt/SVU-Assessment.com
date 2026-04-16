(function setupLandingPage() {
  const loader = document.getElementById("pageLoader");
  const particlesHost = document.getElementById("particles");
  const cursorGlow = document.getElementById("cursorGlow");
  const revealTargets = document.querySelectorAll(".reveal");
  const navToggle = document.getElementById("navToggle");
  const navMenu = document.getElementById("navMenu");

  function hideLoader() {
    if (!loader) return;
    window.setTimeout(() => {
      loader.classList.add("is-hidden");
    }, 500);
  }

  function buildParticles() {
    if (!particlesHost) return;

    const totalParticles = 22;
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < totalParticles; index += 1) {
      const particle = document.createElement("span");
      const size = Math.random() * 3 + 2;
      const left = Math.random() * 100;
      const duration = Math.random() * 12 + 10;
      const delay = Math.random() * -16;
      const hue = index % 3;

      particle.className = "particle";
      particle.style.left = `${left}%`;
      particle.style.width = `${size}px`;
      particle.style.height = `${size}px`;
      particle.style.animationDuration = `${duration}s`;
      particle.style.animationDelay = `${delay}s`;
      particle.style.background =
        hue === 0 ? "rgba(92, 244, 255, 0.88)" : hue === 1 ? "rgba(139, 93, 255, 0.82)" : "rgba(91, 169, 255, 0.86)";

      fragment.appendChild(particle);
    }

    particlesHost.appendChild(fragment);
  }

  function setupReveal() {
    if (!("IntersectionObserver" in window)) {
      revealTargets.forEach((item) => item.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      {
        threshold: 0.14,
      }
    );

    revealTargets.forEach((item) => observer.observe(item));
  }

  function setupCursorGlow() {
    if (!cursorGlow || window.matchMedia("(pointer: coarse)").matches) return;

    document.addEventListener("mousemove", (event) => {
      cursorGlow.style.opacity = "1";
      cursorGlow.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    });

    document.addEventListener("mouseleave", () => {
      cursorGlow.style.opacity = "0";
    });
  }

  function setupNav() {
    if (!navToggle || !navMenu) return;

    navToggle.addEventListener("click", () => {
      const isOpen = navMenu.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", String(isOpen));
      document.body.classList.toggle("nav-open", isOpen);
    });

    navMenu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        navMenu.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
        document.body.classList.remove("nav-open");
      });
    });
  }

  buildParticles();
  setupReveal();
  setupCursorGlow();
  setupNav();

  if (document.readyState === "complete") {
    hideLoader();
  } else {
    window.addEventListener("load", hideLoader, { once: true });
  }
})();
