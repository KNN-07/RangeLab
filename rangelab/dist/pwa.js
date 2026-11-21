(() => {
  const standalone = window.matchMedia('(display-mode: standalone)');
  let installPrompt = null;
  let installed = standalone.matches || navigator.standalone === true;
  let offlineReady = false;

  function state() {
    return { installed, canPrompt: Boolean(installPrompt), offlineReady };
  }

  function publishState() {
    window.dispatchEvent(new CustomEvent('rangelab:pwa', { detail: state() }));
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    publishState();
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installed = true;
    publishState();
  });

  async function install() {
    if (installed) return 'installed';
    if (!installPrompt) return 'manual';
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      return (await prompt.userChoice).outcome;
    } catch {
      return 'manual';
    } finally {
      publishState();
    }
  }

  window.RangePWA = { state, install };
  if (window.isSecureContext && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        offlineReady = true;
        publishState();
      })
      .catch(error => console.warn('RangeLab offline setup failed.', error));
  }
})();
