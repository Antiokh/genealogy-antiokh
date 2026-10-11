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

  const visibleIds = () => {
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

  const snapshot = () => projectFamily(family, visibleIds(), resolvedFocus, expanded);

  return {
    focusId: resolvedFocus,
    isExpanded(id) {
      return expanded.has(id);
    },
    canExpand(id) {
      return (adjacency.get(id)?.size || 0) > 0;
    },
    toggle(id) {
      if (!id || id === resolvedFocus || !adjacency.has(id)) return snapshot();
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      return snapshot();
    },
    reset() {
      expanded.clear();
      if (resolvedFocus) expanded.add(resolvedFocus);
      return snapshot();
    },
    snapshot,
  };
}

export function treeRenderContext(search = globalThis.location?.search || '') {
  const params = new URLSearchParams(search);
  return { person: params.get('person') || '' };
}

export function reportTreeScope(family) {
  if (!globalThis.parent || globalThis.parent === globalThis) return;
  globalThis.parent.postMessage({
    type: 'genealogy:tree-scope',
    scope: family.scope || null,
    focus: family.focus || null,
  }, globalThis.location?.origin || '*');
}
