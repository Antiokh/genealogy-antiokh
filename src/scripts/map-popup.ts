// Shared popup and marker renderer for the personal and all-events maps.
// @ts-nocheck

export function formatMapDate(value) {
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  if (!value || typeof value !== 'object') return '';
  if (value.text) return String(value.text);
  if (!value.year) return '';
  const date = [value.day, value.month, value.year].filter(Boolean).join('.');
  return value.circa ? `ок. ${date}` : date;
}

export function groupMapRecords(events = [], photos = []) {
  const groups = new Map();
  const ensure = (key, label, coordinates, placeUrl) => {
    if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(Number.isFinite)) return null;
    if (!groups.has(key)) {
      groups.set(key, { key, label: label || 'Место съёмки', placeUrl, coordinates, events: [], photos: [] });
    }
    return groups.get(key);
  };
  for (const feature of events) {
    const props = feature?.properties ?? {};
    if (!props.placeRef) continue;
    const group = ensure(`place:${props.placeRef}`, props.placeLabel, feature?.geometry?.coordinates,
      `/places/${String(props.placeRef).replace(/\.mdx?$/i, '')}/`);
    if (group) group.events.push(feature);
  }
  for (const photo of photos) {
    if (!photo?.ref || !photo.thumbnailUrl) continue;
    const key = photo.geoExplicit || !photo.placeRef ? `photo:${photo.ref}` : `place:${photo.placeRef}`;
    const group = ensure(key, photo.placeLabel || photo.title, photo.coordinates, photo.placeUrl);
    if (group) group.photos.push(photo);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru') || a.key.localeCompare(b.key));
}

function link(text, href, className) {
  const anchor = document.createElement('a');
  anchor.textContent = text || '';
  anchor.href = href;
  anchor.target = '_top';
  if (className) anchor.className = className;
  return anchor;
}

function appendParticipants(row, feature, peopleByRef) {
  const refs = Array.isArray(feature.properties?.participants) ? feature.properties.participants : [];
  if (!refs.length) return;
  const actors = document.createElement('div');
  actors.className = 'genealogy-map-popup-meta';
  actors.append(document.createTextNode(refs.length === 1 ? 'Участник: ' : 'Участники: '));
  refs.forEach((ref, index) => {
    if (index) actors.append(document.createTextNode(', '));
    const person = peopleByRef.get(ref);
    const url = person?.url || `/people/${String(ref).replace(/\.mdx?$/i, '')}/`;
    actors.append(link(person?.displayName || person?.title || ref, url));
  });
  row.append(actors);
}

export function createMapPopupContent(group, peopleByRef = new Map()) {
  const root = document.createElement('div');
  root.className = 'genealogy-map-popup';

  const heading = document.createElement('strong');
  if (group.placeUrl) heading.append(link(group.label, group.placeUrl));
  else heading.textContent = group.label;
  root.append(heading);

  if (group.events.length) {
    const list = document.createElement('div');
    list.className = 'genealogy-map-popup-events';
    for (const feature of group.events) {
      const props = feature.properties ?? {};
      const row = document.createElement('div');
      row.className = 'genealogy-map-popup-event';
      const start = formatMapDate(props.date);
      const end = formatMapDate(props.endDate);
      const date = end && end !== start ? `${start || '…'}–${end}` : start;
      if (date) {
        const time = document.createElement('span');
        time.className = 'genealogy-map-popup-meta';
        time.textContent = date;
        row.append(time);
      }
      if (props.eventUrl) row.append(link(props.eventTitle, props.eventUrl));
      else {
        const title = document.createElement('span');
        title.textContent = props.eventTitle || '';
        row.append(title);
      }
      appendParticipants(row, feature, peopleByRef);
      list.append(row);
    }
    root.append(list);
  }

  if (group.photos.length) {
    const label = document.createElement('span');
    label.className = 'genealogy-map-popup-section-label';
    label.textContent = group.photos.length === 1 ? 'Фотография' : `Фотографии (${group.photos.length})`;
    root.append(label);
    const gallery = document.createElement('div');
    gallery.className = 'genealogy-map-popup-photos';
    for (const photo of group.photos) {
      const item = link('', photo.url, 'genealogy-map-popup-photo');
      item.setAttribute('aria-label', `Карточка фотографии: ${photo.title || photo.caption || 'Без названия'}`);
      const img = document.createElement('img');
      img.src = photo.thumbnailUrl;
      img.alt = photo.alt || photo.title || 'Фотография';
      img.loading = 'lazy';
      img.decoding = 'async';
      item.append(img);
      const caption = document.createElement('span');
      caption.textContent = [photo.title || photo.caption, formatMapDate(photo.date)].filter(Boolean).join(' · ');
      item.append(caption);
      gallery.append(item);
    }
    root.append(gallery);
  }
  return root;
}

export function createPhotoMarkerElement(group) {
  const element = document.createElement('div');
  element.className = 'genealogy-map-photo-marker';
  element.setAttribute('aria-label', `${group.label}: ${group.photos.length} фото`);
  const img = document.createElement('img');
  img.src = group.photos[0].thumbnailUrl;
  img.alt = '';
  img.decoding = 'async';
  element.append(img);
  if (group.photos.length > 1) {
    const count = document.createElement('span');
    count.className = 'genealogy-map-photo-count';
    count.textContent = String(group.photos.length);
    element.append(count);
  }
  return element;
}

export function mountMapLayerSwitch(container, hasEvents, hasPhotos, onChange) {
  if (!hasEvents || !hasPhotos) return () => {};
  const control = document.createElement('div');
  control.className = 'genealogy-map-layer-switch';
  control.setAttribute('role', 'group');
  control.setAttribute('aria-label', 'Что показывать на карте');
  const items = [
    ['all', 'Все'],
    ['events', 'События'],
    ['photos', 'Фото'],
  ];
  const buttons = [];
  for (const [value, title] of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = title;
    button.setAttribute('aria-pressed', String(value === 'all'));
    button.addEventListener('click', () => {
      for (const item of buttons) item.setAttribute('aria-pressed', String(item.dataset.layer === value));
      onChange(value);
    });
    button.dataset.layer = value;
    buttons.push(button);
    control.append(button);
  }
  container.append(control);
  return () => control.remove();
}
