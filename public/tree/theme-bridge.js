const TOKENS = [
  '--sl-font-system',
  '--sl-color-accent-low', '--sl-color-accent', '--sl-color-accent-high',
  '--sl-color-gray-1', '--sl-color-gray-2', '--sl-color-gray-3', '--sl-color-gray-4', '--sl-color-gray-5', '--sl-color-gray-6', '--sl-color-gray-7',
  '--sl-color-bg', '--sl-color-hairline', '--sl-color-text', '--sl-color-text-accent',
];

export function startThemeBridge(onChange) {
  let parentDocument = null;
  try {
    if (window.parent && window.parent !== window) parentDocument = window.parent.document;
  } catch {}

  const apply = () => {
    const root = document.documentElement;
    let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (parentDocument) {
      const parentRoot = parentDocument.documentElement;
      const parentTheme = parentRoot.dataset.theme;
      if (parentTheme === 'light' || parentTheme === 'dark') theme = parentTheme;
      const styles = getComputedStyle(parentRoot);
      for (const token of TOKENS) {
        const value = styles.getPropertyValue(token).trim();
        if (value) root.style.setProperty(token, value);
      }

      // The site header intentionally uses --sl-color-bg-nav as the dark leather
      // cover in the album light theme. Tree cards, however, need a content
      // surface rather than the navigation/header surface, so bridge the
      // genealogy surface tokens explicitly when they are available.
      const surface = styles.getPropertyValue('--genea-surface').trim()
        || styles.getPropertyValue('--sl-color-bg-nav').trim();
      const sidebar = styles.getPropertyValue('--genea-sidebar').trim()
        || styles.getPropertyValue('--sl-color-bg-sidebar').trim();
      if (surface) root.style.setProperty('--sl-color-bg-nav', surface);
      if (sidebar) root.style.setProperty('--sl-color-bg-sidebar', sidebar);
    }
    root.dataset.theme = theme;
    root.style.colorScheme = theme;

    // Tree renderer pages can start painting before their dynamic modules finish
    // loading (especially the BALKAN renderer). Reveal only after the resolved
    // theme and bridged tokens are in place, so no legacy/default palette flashes.
    root.dataset.themeReady = '1';
    onChange?.(theme);
  };

  apply();
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', apply);
  let observer = null;
  if (parentDocument) {
    observer = new MutationObserver(apply);
    observer.observe(parentDocument.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  }
  return () => {
    media.removeEventListener('change', apply);
    observer?.disconnect();
  };
}
