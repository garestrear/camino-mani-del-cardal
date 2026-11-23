"use strict";

const installButton = document.getElementById("install");
const installDialog = document.getElementById("install-help");
const standalone = matchMedia("(display-mode: standalone)");
let installPrompt;

function refreshInstallButton() {
  installButton.hidden = standalone.matches || navigator.standalone === true;
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener("appinstalled", () => {
  installPrompt = undefined;
  installButton.hidden = true;
});
standalone.addEventListener("change", refreshInstallButton);
refreshInstallButton();

installButton.addEventListener("click", async () => {
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = undefined;
    try {
      await prompt.prompt();
      return;
    } catch {
      // The browser menu remains available if the prompt cannot be shown.
    }
  }
  const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  document.getElementById("install-steps").textContent = isAppleMobile
    ? "Abre esta página en Safari. En el menú Compartir, toca Añadir a pantalla de inicio y luego Añadir."
    : "Abre el menú del navegador y elige Instalar aplicación o Añadir a pantalla de inicio.";
  installDialog.showModal();
});

if ("serviceWorker" in navigator) {
  const workers = navigator.serviceWorker;
  const admin = document.querySelector("#admin details");
  let controlled = Boolean(workers.controller);
  let pending = false;
  let reloading = false;

  function applyUpdate() {
    if (pending && !reloading && !admin.open && !document.hidden) {
      reloading = true;
      location.reload();
    }
  }

  workers.addEventListener("controllerchange", () => {
    if (controlled) pending = true;
    controlled = Boolean(workers.controller);
    applyUpdate();
  });
  admin.addEventListener("toggle", applyUpdate);

  workers.register("/sw.js", { updateViaCache: "none" }).then(registration => {
    function checkForUpdate() {
      if (document.hidden) return;
      applyUpdate();
      if (!reloading) registration.update().catch(() => {});
    }
    document.addEventListener("visibilitychange", checkForUpdate);
    window.addEventListener("online", checkForUpdate);
    setInterval(checkForUpdate, 60_000);
  }).catch(error => console.warn("No se pudo activar la actualización automática.", error));
}
