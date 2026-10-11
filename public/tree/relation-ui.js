const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

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

export function relationIconHtml(relation, { size = 28 } = {}) {
  const kind = relation?.kind || 'parents';
  const title = esc(relationTitle(relation));
  const stroke = kind === 'divorced'
    ? 'var(--tree-danger)'
    : kind === 'parents'
      ? 'var(--sl-color-gray-3)'
      : 'var(--tree-accent, var(--sl-color-accent))';
  const background = 'var(--tree-background, var(--sl-color-bg))';

  let body = '';
  if (kind === 'married' || kind === 'divorced') {
    body = `
      <circle cx="10" cy="14" r="5" fill="none" stroke="${stroke}" stroke-width="1.7"/>
      <circle cx="18" cy="14" r="5" fill="none" stroke="${stroke}" stroke-width="1.7"/>
      ${kind === 'divorced' ? `<line x1="5" y1="22" x2="23" y2="6" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>` : ''}`;
  } else {
    body = `
      <circle cx="9" cy="10" r="3" fill="none" stroke="${stroke}" stroke-width="1.6"/>
      <circle cx="19" cy="10" r="3" fill="none" stroke="${stroke}" stroke-width="1.6"/>
      <path d="M3 22c.4-5.2 2.7-7.7 7-7.7s6.6 2.5 7 7.7M11 22c.4-5.2 2.7-7.7 7-7.7s6.6 2.5 7 7.7" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/>`;
  }

  return `<span class="genealogy-relation-icon relation-${kind}" title="${title}" aria-label="${title}" style="--relation-size:${Number(size) || 28}px">
    <svg viewBox="0 0 28 28" width="${Number(size) || 28}" height="${Number(size) || 28}" role="img" aria-hidden="true">
      <circle cx="14" cy="14" r="13" fill="${background}" stroke="${stroke}" stroke-width="1.4"/>
      ${body}
    </svg>
  </span>`;
}

export function renderRelationOverlay(overlay, canvas, family) {
  if (!overlay || !canvas || !family) return;
  overlay.replaceChildren();

  const shell = overlay.parentElement;
  const shellRect = shell?.getBoundingClientRect?.();
  if (!shellRect) return;

  const cardById = new Map(
    [...canvas.querySelectorAll('genealogy-person-card')]
      .map((element) => [element.getAttribute('person-id'), element])
      .filter(([id]) => Boolean(id)),
  );

  for (const unit of family.families || []) {
    const partners = (unit.partners || []).filter((id) => cardById.has(id));
    for (let i = 0; i < partners.length; i += 1) {
      for (let j = i + 1; j < partners.length; j += 1) {
        const left = cardById.get(partners[i])?.getBoundingClientRect?.();
        const right = cardById.get(partners[j])?.getBoundingClientRect?.();
        if (!left || !right) continue;

        const x = ((left.left + left.width / 2) + (right.left + right.width / 2)) / 2 - shellRect.left;
        const y = ((left.top + left.height / 2) + (right.top + right.height / 2)) / 2 - shellRect.top;
        const item = document.createElement('div');
        item.className = 'genealogy-relation-overlay-item';
        item.style.left = `${x}px`;
        item.style.top = `${y}px`;
        item.innerHTML = relationIconHtml(unit.relation || { kind:'parents' }, { size:26 });
        overlay.append(item);
      }
    }
  }
}
