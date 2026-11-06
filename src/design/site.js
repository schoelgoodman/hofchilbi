// Hofchilbi Wil — small progressive enhancements. The site works without this file:
// the footer has all page links, galleries link to the large images.
(() => {
  "use strict";

  // ---------- Sticky header ----------
  // Fixed once JS runs: see-through at the top, black after scrolling, hidden while scrolling
  // down (more room to read), back as soon as the visitor scrolls up or tabs into it.
  const header = document.querySelector(".header");
  if (header) {
    document.documentElement.classList.add("js-header");
    let lastY = window.scrollY;
    let ticking = false;
    const update = () => {
      const y = window.scrollY;
      header.classList.toggle("is-solid", y > 40);
      if (y < 200 || y < lastY - 4) header.classList.remove("is-hidden");
      else if (y > lastY + 4 && !header.contains(document.activeElement)) header.classList.add("is-hidden");
      lastY = y;
      ticking = false;
    };
    window.addEventListener(
      "scroll",
      () => {
        if (!ticking) requestAnimationFrame(update);
        ticking = true;
      },
      { passive: true },
    );
    header.addEventListener("focusin", () => header.classList.remove("is-hidden"));
    update();
  }

  // ---------- Navigation overlay ----------
  const nav = document.getElementById("nav");
  const openBtn = document.querySelector("[data-nav-open]");
  const closeBtn = document.querySelector("[data-nav-close]");
  const focusable = (root) =>
    [...root.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
      (el) => el.offsetParent !== null,
    );

  function openNav() {
    nav.hidden = false;
    requestAnimationFrame(() => nav.classList.add("is-open"));
    document.body.classList.add("nav-open");
    openBtn.setAttribute("aria-expanded", "true");
    closeBtn.focus();
  }
  function closeNav() {
    nav.classList.remove("is-open");
    document.body.classList.remove("nav-open");
    openBtn.setAttribute("aria-expanded", "false");
    setTimeout(() => (nav.hidden = true), 250);
    openBtn.focus();
  }
  if (nav && openBtn && closeBtn) {
    openBtn.hidden = false;
    openBtn.addEventListener("click", openNav);
    closeBtn.addEventListener("click", closeNav);
    nav.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return closeNav();
      if (e.key !== "Tab") return;
      const items = focusable(nav);
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  // ---------- Anzapfer decades ----------
  // An accordion on phones (the HTML has only the newest open); wide screens show them all.
  const decades = [...document.querySelectorAll(".anz-decade")];
  if (decades.length) {
    const wide = window.matchMedia("(min-width: 900px)");
    const sync = () => decades.forEach((d, i) => (d.open = wide.matches || i === 0));
    if (wide.matches) sync();
    wide.addEventListener("change", sync);
    for (const d of decades) {
      d.querySelector("summary").addEventListener("click", (e) => wide.matches && e.preventDefault());
    }
  }

  // ---------- Gallery lightbox ----------
  const links = [...document.querySelectorAll("[data-lightbox]")];
  if (links.length && "HTMLDialogElement" in window) {
    const dialog = document.createElement("dialog");
    dialog.className = "lightbox";
    dialog.setAttribute("aria-label", "Bildansicht");
    dialog.innerHTML =
      '<button class="lb-close" type="button" aria-label="Schliessen">×</button>' +
      '<button class="lb-prev" type="button" aria-label="Vorheriges Bild">‹</button>' +
      '<button class="lb-next" type="button" aria-label="Nächstes Bild">›</button><img alt="">';
    document.body.append(dialog);
    const img = dialog.querySelector("img");
    let index = 0;
    const show = (i) => {
      index = (i + links.length) % links.length;
      const a = links[index];
      img.src = a.href;
      img.alt = a.querySelector("img")?.alt ?? "";
    };
    links.forEach((a, i) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        show(i);
        dialog.showModal();
      }),
    );
    dialog.querySelector(".lb-close").addEventListener("click", () => dialog.close());
    dialog.querySelector(".lb-prev").addEventListener("click", () => show(index - 1));
    dialog.querySelector(".lb-next").addEventListener("click", () => show(index + 1));
    dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());
    dialog.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") show(index - 1);
      if (e.key === "ArrowRight") show(index + 1);
    });
    let x0 = null;
    dialog.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), { passive: true });
    dialog.addEventListener("touchend", (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
      x0 = null;
    });
  }
})();
