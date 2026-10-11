const sexOf = (person) => String(person?.sex || '').toUpperCase();
const isMale = (person) => ['M', 'MALE'].includes(sexOf(person));
const isFemale = (person) => ['F', 'FEMALE'].includes(sexOf(person));
const gendered = (person, male, female, neutral = 'родственник') => isMale(person) ? male : isFemale(person) ? female : neutral;
const result = (label, title = label) => ({ label, title });

const cousinPrefix = (degree, person) => {
  if (degree <= 1) return '';
  if (degree === 2) return isFemale(person) ? 'двоюродная ' : 'двоюродный ';
  return isFemale(person) ? 'троюродная ' : 'троюродный ';
};

const cousinGenitive = (degree, person) => {
  if (degree <= 1) return '';
  if (degree === 2) return isFemale(person) ? 'двоюродной ' : 'двоюродного ';
  return isFemale(person) ? 'троюродной ' : 'троюродного ';
};

function buildRelations(family) {
  const ids = new Set((family.people || []).map((person) => person.id));
  const parents = new Map([...ids].map((id) => [id, new Set()]));
  const partners = new Map([...ids].map((id) => [id, []]));

  for (const unit of family.families || []) {
    const unitPartners = (unit.partners || []).filter((id) => ids.has(id));
    const children = (unit.children || []).filter((id) => ids.has(id));
    for (const child of children) for (const parent of unitPartners) parents.get(child)?.add(parent);
    for (let i = 0; i < unitPartners.length; i += 1) {
      for (let j = i + 1; j < unitPartners.length; j += 1) {
        const relation = unit.relation || { kind:'parents' };
        const a = unitPartners[i], b = unitPartners[j];
        partners.get(a)?.push({ id:b, relation });
        partners.get(b)?.push({ id:a, relation });
      }
    }
  }
  return { parents, partners };
}

function ancestorDistances(parents, startId) {
  const distances = new Map();
  if (!startId || !parents.has(startId)) return distances;
  distances.set(startId, 0);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    const distance = distances.get(id) || 0;
    for (const parent of parents.get(id) || []) {
      const next = distance + 1;
      if (distances.has(parent) && distances.get(parent) <= next) continue;
      distances.set(parent, next);
      queue.push(parent);
    }
  }
  return distances;
}

function closestCommonAncestor(focusAncestors, targetAncestors) {
  let best = null;
  for (const [id, focusDistance] of focusAncestors) {
    if (focusDistance === 0 || !targetAncestors.has(id)) continue;
    const targetDistance = targetAncestors.get(id);
    if (targetDistance === 0) continue;
    const score = focusDistance + targetDistance;
    const spread = Math.abs(focusDistance - targetDistance);
    if (!best || score < best.score || (score === best.score && spread < best.spread)) {
      best = { id, focusDistance, targetDistance, score, spread };
    }
  }
  return best;
}

const ancestorLabel = (p, d) => d === 1 ? gendered(p,'отец','мать','родитель') : d === 2 ? gendered(p,'дед','бабушка','предок') : gendered(p,'прадед','прабабушка','предок');
const descendantLabel = (p, d) => d === 1 ? gendered(p,'сын','дочь','ребёнок') : d === 2 ? gendered(p,'внук','внучка','потомок') : gendered(p,'правнук','правнучка','потомок');
const siblingLabel = (p) => gendered(p,'брат','сестра');
const uncleLabel = (p) => gendered(p,'дядя','тётя');
const nephewLabel = (p) => gendered(p,'племянник','племянница');
const olderCollateralLabel = (p, gap) => gap <= 1 ? uncleLabel(p) : gendered(p,'прадядя','пратётя','боковой предок');
const youngerCollateralLabel = (p, gap) => gap <= 1 ? nephewLabel(p) : gap === 2 ? gendered(p,'внучатый племянник','внучатая племянница','внучатый родственник') : gendered(p,'правнучатый племянник','правнучатая племянница','правнучатый родственник');

function bloodRelationshipInfo(byId, parents, focusId, targetId) {
  const target = byId.get(targetId);
  if (!target || !focusId || !targetId) return null;
  if (focusId === targetId) return { kind:'self', label:'центральная фигура', title:'центральная фигура' };
  const fa = ancestorDistances(parents, focusId);
  const ta = ancestorDistances(parents, targetId);
  if (fa.has(targetId)) {
    const distance = fa.get(targetId), label = ancestorLabel(target, distance);
    return { kind:'ancestor', distance, label, title:label };
  }
  if (ta.has(focusId)) {
    const distance = ta.get(focusId), label = descendantLabel(target, distance);
    return { kind:'descendant', distance, label, title:label };
  }
  const common = closestCommonAncestor(fa, ta);
  if (!common) return null;
  const a = common.focusDistance, b = common.targetDistance;
  if (a === b) {
    if (a === 1) { const label = siblingLabel(target); return { kind:'sibling', degree:1, label, title:label }; }
    const degree = Math.min(3, a), label = `${cousinPrefix(degree,target)}${siblingLabel(target)}`;
    return { kind:'cousin', degree, label, title:label };
  }
  if (a > b) {
    const gap = a - b, degree = Math.min(3, b);
    const label = gap === 1 ? `${cousinPrefix(degree,target)}${uncleLabel(target)}` : `${cousinPrefix(degree,target)}${olderCollateralLabel(target,gap)}`;
    return { kind:gap === 1 ? 'uncle' : 'older-collateral', degree, gap, label, title:label };
  }
  const gap = b - a, degree = Math.min(3, a);
  const label = `${cousinPrefix(degree,target)}${youngerCollateralLabel(target,gap)}`;
  return { kind:gap === 1 ? 'nephew' : 'younger-collateral', degree, gap, label, title:label };
}

function directPartnerLabel(person, relation) {
  const kind = relation?.kind || 'partner';
  if (kind === 'divorced') return result(gendered(person,'бывший муж','бывшая жена','бывший супруг'));
  if (kind === 'married') return result(gendered(person,'муж','жена','супруг'));
  if (kind === 'parents') return result('со-родитель');
  return result(gendered(person,'партнёр','партнёрша','партнёр'));
}

function partnerGenitive(person, relation) {
  const kind = relation?.kind || 'partner';
  if (kind === 'married') return isFemale(person) ? 'жены' : isMale(person) ? 'мужа' : 'супруга';
  if (kind === 'divorced') return isFemale(person) ? 'бывшей жены' : isMale(person) ? 'бывшего мужа' : 'бывшего супруга';
  if (kind === 'parents') return 'со-родителя';
  return isFemale(person) ? 'партнёрши' : 'партнёра';
}

function maybeFormer(label, relation, person) {
  if (relation?.kind !== 'divorced') return label;
  return `${isFemale(person) ? 'бывшая' : 'бывший'} ${label}`;
}

function inLawFromPartnerBlood(partnerPerson, partnerLink, target, info) {
  if (!info || info.kind === 'self') return null;
  const relation = partnerLink.relation || { kind:'partner' };
  const formalSpouse = ['married','divorced'].includes(relation.kind);
  const suffix = partnerGenitive(partnerPerson, relation);
  if (info.kind === 'ancestor' && info.distance === 1) {
    if (formalSpouse && isFemale(partnerPerson)) return result(maybeFormer(gendered(target,'тесть','тёща','родитель жены'),relation,target), `${info.label} ${suffix}`);
    if (formalSpouse && isMale(partnerPerson)) return result(maybeFormer(gendered(target,'свёкор','свекровь','родитель мужа'),relation,target), `${info.label} ${suffix}`);
    return result(`${info.label} ${suffix}`);
  }
  if (info.kind === 'sibling') {
    if (formalSpouse && isFemale(partnerPerson)) return result(maybeFormer(gendered(target,'шурин','свояченица','сиблинг жены'),relation,target), `${info.label} ${suffix}`);
    if (formalSpouse && isMale(partnerPerson)) return result(maybeFormer(gendered(target,'деверь','золовка','сиблинг мужа'),relation,target), `${info.label} ${suffix}`);
    return result(`${info.label} ${suffix}`);
  }
  if (info.kind === 'descendant' && info.distance === 1) return result(gendered(target,'пасынок','падчерица','ребёнок партнёра'), `${info.label} ${suffix}`);
  return result(`${info.label} ${suffix}`);
}

function spousePhrase(relative, target, base) {
  if (isMale(target)) return `муж ${isFemale(relative) ? base.female : base.male}`;
  if (isFemale(target)) return `жена ${isMale(relative) ? base.male : base.female}`;
  return `супруг ${base.neutral}`;
}

function spouseOfBloodRelative(relative, target, info) {
  if (!info || info.kind === 'self') return null;
  if (info.kind === 'ancestor' && info.distance === 1) return result(gendered(target,'отчим','мачеха','супруг родителя'), spousePhrase(relative,target,{male:'отца',female:'матери',neutral:'родителя'}));
  if (info.kind === 'descendant' && info.distance === 1) {
    if (isMale(relative) && isFemale(target)) return result('невестка','жена сына');
    if (isFemale(relative) && isMale(target)) return result('зять','муж дочери');
    return result(spousePhrase(relative,target,{male:'сына',female:'дочери',neutral:'ребёнка'}));
  }
  if (info.kind === 'sibling') {
    if (isMale(relative) && isFemale(target)) return result('невестка','жена брата');
    if (isFemale(relative) && isMale(target)) return result('зять','муж сестры');
    return result(spousePhrase(relative,target,{male:'брата',female:'сестры',neutral:'сиблинга'}));
  }
  if (info.kind === 'uncle') {
    const label = gendered(target,'дядя','тётя','супруг дяди или тёти');
    const base = isFemale(relative) ? {male:'тёти',female:'тёти',neutral:'тёти'} : {male:'дяди',female:'дяди',neutral:'дяди'};
    return result(label, spousePhrase(relative,target,base));
  }
  if (info.kind === 'nephew') return result(spousePhrase(relative,target,{male:'племянника',female:'племянницы',neutral:'племянника или племянницы'}));
  if (info.kind === 'cousin') {
    const degree = Math.min(3, info.degree || 2);
    const base = `${cousinGenitive(degree,relative)}${isFemale(relative) ? 'сестры' : 'брата'}`;
    return result(`${isMale(target) ? 'муж' : isFemale(target) ? 'жена' : 'супруг'} ${base}`);
  }
  if (info.kind === 'ancestor') {
    const base = info.distance === 2 ? (isFemale(relative) ? 'бабушки' : 'деда') : (isFemale(relative) ? 'прабабушки' : 'прадеда');
    return result(`${isMale(target) ? 'муж' : isFemale(target) ? 'жена' : 'супруг'} ${base}`);
  }
  if (info.kind === 'descendant') {
    const base = info.distance === 2 ? (isFemale(relative) ? 'внучки' : 'внука') : (isFemale(relative) ? 'правнучки' : 'правнука');
    return result(`${isMale(target) ? 'муж' : isFemale(target) ? 'жена' : 'супруг'} ${base}`);
  }
  return result(`супруг ${info.label}`);
}

function secondOrderAffinity(partnerPerson, partnerLink, relative, target, relativeInfo) {
  const relation = partnerLink.relation || { kind:'partner' };
  if (!['married','divorced'].includes(relation.kind) || relativeInfo?.kind !== 'sibling') return null;
  if (isFemale(partnerPerson) && isFemale(relative) && isMale(target)) return result(maybeFormer('свояк',relation,target), `муж сестры ${partnerGenitive(partnerPerson,relation)}`);
  if (isMale(partnerPerson) && isMale(relative) && isFemale(target)) return result(maybeFormer('невестка',relation,target), `жена брата ${partnerGenitive(partnerPerson,relation)}`);
  if (isMale(partnerPerson) && isFemale(relative) && isMale(target)) return result(maybeFormer('зять',relation,target), `муж сестры ${partnerGenitive(partnerPerson,relation)}`);
  return null;
}

export function buildKinshipLabels(family, requestedFocusId) {
  const people = family.people || [];
  const byId = new Map(people.map((person) => [person.id, person]));
  const focusId = byId.has(requestedFocusId) ? requestedFocusId : people[0]?.id || '';
  const { parents, partners } = buildRelations(family);
  const labels = new Map();
  const bloodInfo = new Map();

  for (const person of people) {
    const info = bloodRelationshipInfo(byId,parents,focusId,person.id);
    if (!info) continue;
    bloodInfo.set(person.id,info);
    labels.set(person.id,result(info.label,info.title));
  }

  const focusPartnerLinks = partners.get(focusId) || [];
  for (const link of focusPartnerLinks) {
    const person = byId.get(link.id);
    if (person) labels.set(link.id,directPartnerLabel(person,link.relation));
  }

  for (const person of people) {
    if (labels.has(person.id)) continue;
    for (const link of partners.get(person.id) || []) {
      const relative = byId.get(link.id), info = bloodInfo.get(link.id);
      if (!relative || !info || info.kind === 'self') continue;
      const affinity = spouseOfBloodRelative(relative,person,info);
      if (affinity) { labels.set(person.id,affinity); break; }
    }
  }

  for (const person of people) {
    if (labels.has(person.id)) continue;
    for (const partnerLink of focusPartnerLinks) {
      const partnerPerson = byId.get(partnerLink.id);
      if (!partnerPerson) continue;
      const info = bloodRelationshipInfo(byId,parents,partnerPerson.id,person.id);
      if (!info || info.kind === 'self') continue;
      const affinity = inLawFromPartnerBlood(partnerPerson,partnerLink,person,info);
      if (affinity) { labels.set(person.id,affinity); break; }
    }
  }

  for (const person of people) {
    if (labels.has(person.id)) continue;
    for (const partnerLink of focusPartnerLinks) {
      const partnerPerson = byId.get(partnerLink.id);
      if (!partnerPerson) continue;
      for (const targetPartnerLink of partners.get(person.id) || []) {
        const relative = byId.get(targetPartnerLink.id);
        if (!relative) continue;
        const info = bloodRelationshipInfo(byId,parents,partnerPerson.id,relative.id);
        const affinity = secondOrderAffinity(partnerPerson,partnerLink,relative,person,info);
        if (affinity) { labels.set(person.id,affinity); break; }
      }
      if (labels.has(person.id)) break;
    }
  }

  for (const person of people) {
    if (labels.has(person.id)) continue;
    for (const link of partners.get(person.id) || []) {
      const known = labels.get(link.id);
      if (!known) continue;
      const phrase = isMale(person) ? 'муж' : isFemale(person) ? 'жена' : 'супруг';
      labels.set(person.id,result(`${phrase} ${known.label}`,`${phrase} родственника: ${known.title}`));
      break;
    }
  }

  return labels;
}
