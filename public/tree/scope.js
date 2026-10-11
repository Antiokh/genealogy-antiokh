function normalizeDepth(value) {
  if (value === 'all' || value === Infinity) return Infinity;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 1;
}

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

export function scopeTreeDataset(family, focusId, depth = 1) {
  if (!focusId || !(family.people || []).some((person) => person.id === focusId)) {
    return {
      ...family,
      focus: null,
      scope: { depth: 'all', people: family.people?.length || 0, totalPeople: family.people?.length || 0, hasMore: false },
    };
  }

  const maxDepth = normalizeDepth(depth);
  const adjacency = buildAdjacency(family);
  const distances = new Map([[focusId, 0]]);
  const queue = [focusId];
  while (queue.length) {
    const current = queue.shift();
    const distance = distances.get(current) || 0;
    if (distance >= maxDepth) continue;
    for (const neighbor of adjacency.get(current) || []) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, distance + 1);
      queue.push(neighbor);
    }
  }

  const selected = new Set(distances.keys());
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
      depth: maxDepth === Infinity ? 'all' : maxDepth,
      people: people.length,
      totalPeople: family.people?.length || people.length,
      hasMore: people.length < (family.people?.length || people.length),
    },
  };
}

export function treeRenderContext(search = globalThis.location?.search || '') {
  const params = new URLSearchParams(search);
  return {
    person: params.get('person') || '',
    depth: params.get('depth') === 'all' ? 'all' : normalizeDepth(params.get('depth') || 1),
  };
}

export function reportTreeScope(family) {
  if (!globalThis.parent || globalThis.parent === globalThis) return;
  globalThis.parent.postMessage({
    type: 'genealogy:tree-scope',
    scope: family.scope || null,
    focus: family.focus || null,
  }, globalThis.location?.origin || '*');
}
