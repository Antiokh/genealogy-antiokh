function buildAdjacency(family) {
  const adjacency = new Map((family.people || []).map((person) => [person.id, new Set()]));
  const link = (a, b) => {
    if (!a || !b || a === b || !adjacency.has(a) || !adjacency.has(b)) return;
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  };

  for (const unit of family.families || []) {
    const partners = (unit.partners || []).filter((id) => adjacency.has(id));
    const children = (unit.children || []).filter((id) => adjacency.has(id));
    for (let i = 0; i < partners.length; i += 1) {
      for (let j = i + 1; j < partners.length; j += 1) link(partners[i], partners[j]);
    }
    for (const parent of partners) {
      for (const child of children) link(parent, child);
    }
  }
  return adjacency;
}

function projectFamily(family, selected, focusId, expanded) {
  const people = (family.people || []).filter((person) => selected.has(person.id));
  const families = (family.families || []).map((unit) => ({
    ...unit,
    partners: (unit.partners || []).filter((id) => selected.has(id)),
    children: (unit.children || []).filter((id) => selected.has(id)),
  })).filter((unit) => new Set([...(unit.partners || []), ...(unit.children || [])]).size >= 2);

  return {
    ...family,
    focus: focusId,
    people,
    families,
    summary: {
      ...(family.summary || {}),
      people: people.length,
      families: families.length,
      totalPeople: family.people?.length || people.length,
      totalFamilies: family.families?.length || families.length,
    },
    scope: {
      people: people.length,
      totalPeople: family.people?.length || people.length,
      hasMore: people.length < (family.people?.length || people.length),
      expanded: [...expanded],
    },
  };
}

export function createTreeExpansionState(family, focusId) {
  const hasFocus = Boolean(focusId && (family.people || []).some((person) => person.id === focusId));
  const resolvedFocus = hasFocus ? focusId : family.people?.[0]?.id || '';
  const adjacency = buildAdjacency(family);
  const expanded = new Set(resolvedFocus ? [resolvedFocus] : []);
  let showAll = false;

  const visibleIds = () => {
    if (showAll) return new Set((family.people || []).map((person) => person.id));
    if (!resolvedFocus || !adjacency.has(resolvedFocus)) return new Set((family.people || []).map((person) => person.id));
    const visible = new Set([resolvedFocus]);
    const queue = [resolvedFocus];
    const traversed = new Set();

    while (queue.length) {
      const current = queue.shift();
      if (traversed.has(current) || !expanded.has(current)) continue;
      traversed.add(current);
      for (const neighbor of adjacency.get(current) || []) {
        visible.add(neighbor);
        if (expanded.has(neighbor) && !traversed.has(neighbor)) queue.push(neighbor);
      }
    }
    return visible;
  };

  const hasHiddenNeighbor = (id, visible = visibleIds()) => {
    const neighbors = adjacency.get(id);
    if (!neighbors?.size) return false;
    return [...neighbors].some((neighbor) => !visible.has(neighbor));
  };

  const snapshot = () => projectFamily(family, visibleIds(), resolvedFocus, expanded);

  return {
    focusId: resolvedFocus,
    isExpanded(id) {
      return expanded.has(id);
    },
    canExpand(id) {
      if (expanded.has(id)) return true;
      return hasHiddenNeighbor(id);
    },
    branchState(id) {
      const neighbors = adjacency.get(id);
      if (!neighbors?.size) return '';
      if (expanded.has(id)) return 'collapse';
      return hasHiddenNeighbor(id) ? 'expand' : '';
    },
    toggle(id) {
      if (!id || !adjacency.has(id)) return snapshot();
      showAll = false;
      if (expanded.has(id)) {
        expanded.delete(id);
      } else {
        const visible = visibleIds();
        if (!hasHiddenNeighbor(id, visible)) return snapshot();
        expanded.add(id);
      }
      return snapshot();
    },
    reset() {
      showAll = false;
      expanded.clear();
      if (resolvedFocus) expanded.add(resolvedFocus);
      return snapshot();
    },
    expandAll() {
      showAll = true;
      expanded.clear();
      for (const id of adjacency.keys()) expanded.add(id);
      return snapshot();
    },
    snapshot,
  };
}

export function treeRenderContext(search = globalThis.location?.search || '') {
  const params = new URLSearchParams(search);
  return {
    person: params.get('person') || '',
    overviewMode: params.get('overview') === '1',
  };
}

export function renderTreeStatus(status, {
  focusName,
  visiblePeople,
  totalPeople,
  onFocus,
  onExpandAll,
  overviewMode = false,
} = {}) {
  if (!status || !globalThis.document) return;
  status.classList.remove('error');

  if (overviewMode) {
    const totalText = document.createElement('span');
    totalText.className = 'tree-status__total';
    totalText.textContent = `${totalPeople ?? visiblePeople ?? 0} людей в дереве`;
    status.replaceChildren(totalText);
    return;
  }

  const focusButton = document.createElement('button');
  focusButton.type = 'button';
  focusButton.className = 'tree-status__action tree-status__focus';
  focusButton.textContent = focusName || 'Семейное дерево';
  focusButton.title = 'Центрировать по человеку';
  focusButton.setAttribute('aria-label', `Центрировать по человеку: ${focusButton.textContent}`);
  if (typeof onFocus === 'function') focusButton.addEventListener('click', onFocus);
  else focusButton.disabled = true;

  // Renderer capability: BALKAN free mode has a 200-person ceiling, so its
  // total count remains display-only. Other renderers may opt into expand-all
  // by supplying onExpandAll.
  const isBalkan = globalThis.location?.pathname?.includes('/balkan-familytree-classic');
  let totalControl;
  if (!isBalkan && typeof onExpandAll === 'function') {
    const totalButton = document.createElement('button');
    totalButton.type = 'button';
    totalButton.className = 'tree-status__action tree-status__total';
    totalButton.textContent = `${totalPeople ?? 0} людей`;
    totalButton.title = 'Раскрыть всё дерево';
    totalButton.setAttribute('aria-label', `Раскрыть всё дерево: ${totalButton.textContent}`);
    totalButton.addEventListener('click', onExpandAll);
    totalControl = totalButton;
  } else {
    const totalText = document.createElement('span');
    totalText.className = 'tree-status__total';
    totalText.textContent = `${totalPeople ?? 0} людей`;
    if (isBalkan) totalText.title = 'Полное раскрытие отключено из-за лимита BALKAN free mode';
    totalControl = totalText;
  }

  status.replaceChildren(
    focusButton,
    document.createTextNode(` · ${visiblePeople ?? 0} из `),
    totalControl,
  );
}

export function reportTreeScope(family) {
  if (!globalThis.parent || globalThis.parent === globalThis) return;
  globalThis.parent.postMessage({
    type: 'genealogy:tree-scope',
    scope: family.scope || null,
    focus: family.focus || null,
  }, globalThis.location?.origin || '*');
}
