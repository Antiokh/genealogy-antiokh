/**
 * Shared map control from the RSLive renderer: return to the bounds of all
 * currently visible points without changing filters or the selected years.
 * Kept independent of MapLibre so the personal and full maps share one icon.
 */
function overviewIcon(): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('genealogy-map-overview-icon');

  for (const [cx, cy, radius] of [[7, 8, 2.2], [16.5, 7, 1.8], [13, 16, 2.4]]) {
    const circle = document.createElementNS(namespace, 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(radius));
    svg.append(circle);
  }

  return svg;
}

export class MapOverviewControl {
  private container?: HTMLDivElement;
  private button?: HTMLButtonElement;

  constructor(
    private readonly onOverview: () => void,
    private readonly label = 'Показать все точки',
  ) {}

  onAdd(): HTMLElement {
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'genealogy-map-home';
    this.button.title = this.label;
    this.button.setAttribute('aria-label', this.label);
    this.button.append(overviewIcon());
    this.button.addEventListener('click', this.onOverview);
    this.container.append(this.button);
    return this.container;
  }

  onRemove(): void {
    this.button?.removeEventListener('click', this.onOverview);
    this.container?.remove();
    this.button = undefined;
    this.container = undefined;
  }
}
