const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const SVG_NS = 'http://www.w3.org/2000/svg';
const RELATION_ICON_SIZE = 26;
const pairKey = (a, b) => [String(a), String(b)].sort().join('|');

export function relationTitle(relation) {
  if (relation?.kind === 'divorced') {
    if (relation.divorced && relation.married) return `Брак ${relation.married} · развод ${relation.divorced}`;
    if (relation.divorced) return `Развод · ${relation.divorced}`;
    return relation.married ? `Развод · брак ${relation.married}, дата развода не указана` : 'Развод';
  }
  if (relation?.kind === 'married') return relation.married ? `Брак · ${relation.married}` : 'Брак';
  if (relation?.kind === 'partner') return 'Партнёрство';
  return 'Родители · статус союза не указан';
}

function relationIconParts(relation) {
  const kind = relation?.kind || 'parents';
  const stroke = kind === 'divorced'
    ? 'var(--tree-danger)'
    : kind === 'parents'
      ? 'var(--sl-color-gray-3)'
      : 'var(--tree-accent, var(--sl-color-accent))';
  const background = 'var(--tree-background, var(--sl-color-bg))';

  const body = kind === 'married' || kind === 'divorced'
    ? `
      <circle cx="10" cy="14" r="5" fill="none" stroke="${stroke}" stroke-width="1.7"/>
      <circle cx="18" cy="14" r="5" fill="none" stroke="${stroke}" stroke-width="1.7"/>
      ${kind === 'divorced' ? `<line x1="5" y1="22" x2="23" y2="6" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>` : ''}`
    : `
      <circle cx="9" cy="10" r="3" fill="none" stroke="${stroke}" stroke-width="1.6"/>
      <circle cx="19" cy="10" r="3" fill="none" stroke="${stroke}" stroke-width="1.6"/>
      <path d="M3 22c.4-5.2 2.7-7.7 7-7.7s6.6 2.5 7 7.7M11 22c.4-5.2 2.7-7.7 7-7.7s6.6 2.5 7 7.7" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/>`;

  return { kind, stroke, background, body };
}

export function relationIconHtml(relation, { size = 28 } = {}) {
  const title = esc(relationTitle(relation));
  const { kind, stroke, background, body } = relationIconParts(relation);
  const resolvedSize = Number(size) || 28;

  return `<span class="genealogy-relation-icon relation-${kind}" title="${title}" aria-label="${title}" style="--relation-size:${resolvedSize}px">
    <svg viewBox="0 0 28 28" width="${resolvedSize}" height="${resolvedSize}" role="img" aria-hidden="true">
      <circle cx="14" cy="14" r="13" fill="${background}" stroke="${stroke}" stroke-width="1.4"/>
      ${body}
    </svg>
  </span>`;
}

export function renderRelationSvg(canvas, family) {
  if (!canvas || !family) return;
  const linksView = canvas.querySelector('svg.main_svg .links_view');
  if (!(linksView instanceof SVGElement)) return;

  linksView.querySelectorAll('.genealogy-relation-svg').forEach((node) => node.remove());

  const relationByPair = new Map();
  for (const unit of family.families || []) {
    const partners = unit.partners || [];
    for (let i = 0; i < partners.length; i += 1) {
      for (let j = i + 1; j < partners.length; j += 1) {
        relationByPair.set(pairKey(partners[i], partners[j]), unit.relation || { kind:'parents' });
      }
    }
  }

  for (const path of linksView.querySelectorAll('path.link')) {
    const link = path.__data__;
    if (!link?.spouse) continue;

    const sourceId = link.source?.data?.id;
    const targetId = link.target?.data?.id;
    if (!sourceId || !targetId) continue;

    let point;
    try {
      point = path.getPointAtLength(path.getTotalLength() / 2);
    } catch {
      const points = Array.isArray(link.d) ? link.d : [];
      if (points.length < 2) continue;
      const first = points[0];
      const last = points[points.length - 1];
      point = { x:(first[0] + last[0]) / 2, y:(first[1] + last[1]) / 2 };
    }

    const relation = relationByPair.get(pairKey(sourceId, targetId)) || { kind:'parents' };
    const title = esc(relationTitle(relation));
    const { kind, stroke, background, body } = relationIconParts(relation);
    const scale = RELATION_ICON_SIZE / 28;

    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', `genealogy-relation-svg relation-${kind}`);
    group.setAttribute('pointer-events', 'none');
    group.setAttribute('transform', `translate(${point.x} ${point.y}) scale(${scale}) translate(-14 -14)`);
    group.innerHTML = `
      <title>${title}</title>
      <circle cx="14" cy="14" r="13" fill="${background}" stroke="${stroke}" stroke-width="1.4"/>
      ${body}`;
    linksView.append(group);
  }
}
