const TOKENS = [
  '--sl-font-system',
  '--sl-color-accent-low', '--sl-color-accent', '--sl-color-accent-high',
  '--sl-color-white', '--sl-color-black',
  '--sl-color-gray-1', '--sl-color-gray-2', '--sl-color-gray-3', '--sl-color-gray-4', '--sl-color-gray-5', '--sl-color-gray-6', '--sl-color-gray-7',
  '--sl-color-bg', '--sl-color-bg-nav', '--sl-color-bg-sidebar', '--sl-color-hairline', '--sl-color-text', '--sl-color-text-accent',
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
    }
    root.dataset.theme = theme;
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
