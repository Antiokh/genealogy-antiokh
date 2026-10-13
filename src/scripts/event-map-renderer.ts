// @ts-nocheck
import maplibregl from 'maplibre-gl';

const root = document.querySelector('[data-map-shell]');
const canvas = document.querySelector('[data-map-canvas]');
const rangeControl = document.querySelector('[data-range-control]');
const rangeTrack = document.querySelector('[data-range-track]');
const rangeFrom = document.querySelector('[data-range-from]');
const rangeTo = document.querySelector('[data-range-to]');
const rangeLabel = document.querySelector('[data-range-label]');
const status = document.querySelector('[data-map-status]');

if (!(root instanceof HTMLElement)
  || !(canvas instanceof HTMLElement)
  || !(rangeControl instanceof HTMLElement)
  || !(rangeTrack instanceof HTMLElement)
  || !(rangeFrom instanceof HTMLInputElement)
  || !(rangeTo instanceof HTMLInputElement)
  || !(rangeLabel instanceof HTMLOutputElement)
  || !(status instanceof HTMLElement)) {
  throw new Error('Event map renderer is missing required DOM nodes.');
}

const mapStyleUrls = {
  dark: 'https://tiles.openfreemap.org/styles/fiord',
  light: 'https://raw.githubusercontent.com/gpxstudio/styles/main/osm.json',
};

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function formatDateValue(value) {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  if (value.text) return value.text;
  if (!value.year) return '';
  return [value.day, value.month, value.year].filter(Boolean).join('.');
}

function eventDateLabel(feature) {
  const start = formatDateValue(feature.properties.date);
  const end = formatDateValue(feature.properties.endDate);
  return end && end !== start ? `${start || '…'}–${end}` : start;
}

function overlaps(feature, from, to) {
  const start = feature.properties.startYear;
  const end = feature.properties.endYear ?? start;
  return Number.isFinite(start) && Number.isFinite(end) && Number(start) <= to && Number(end) >= from;
}

function overviewIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('rslive-map-overview-icon');
  for (const [cx, cy, radius] of [[7, 8, 2.2], [16.5, 7, 1.8], [13, 16, 2.4]]) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(radius));
    svg.append(circle);
  }
  return svg;
}

class HomeControl {
  constructor(onOverview) {
    this.onOverview = onOverview;
  }
  onAdd() {
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'rslive-map-home';
    this.button.title = 'Показать все события';
    this.button.setAttribute('aria-label', 'Показать все события');
    this.button.append(overviewIcon());
    this.button.addEventListener('click', this.onOverview);
    this.container.append(this.button);
    return this.container;
  }
  onRemove() {
    this.button?.removeEventListener('click', this.onOverview);
    this.container?.remove();
  }
}

function collapseAttribution() {
  const control = root.querySelector('.maplibregl-ctrl-attrib');
  if (!(control instanceof HTMLElement)) return;
  control.classList.add('maplibregl-compact');
  control.classList.remove('maplibregl-compact-show');
  const button = control.querySelector('.maplibregl-ctrl-attrib-button');
  if (button instanceof HTMLElement) button.setAttribute('aria-expanded', 'false');
}

const [eventResponse, peopleResponse] = await Promise.all([
  fetch('/generated/places.geojson'),
  fetch('/generated/people.json'),
]);
if (!eventResponse.ok || !peopleResponse.ok) {
  status.hidden = false;
  status.classList.add('error');
  status.textContent = 'Не удалось загрузить данные карты.';
  throw new Error(`Failed to load event map data: events=${eventResponse.status}, people=${peopleResponse.status}`);
}

const dataset = await eventResponse.json();
const peopleDataset = await peopleResponse.json();
const peopleByRef = new Map((peopleDataset.people ?? []).map((person) => [person.ref, person]));
const datedFeatures = (dataset.features ?? []).filter((feature) => Number.isFinite(feature.properties?.startYear));
const years = datedFeatures.flatMap((feature) => [
  Number(feature.properties.startYear),
  Number(feature.properties.endYear ?? feature.properties.startYear),
]).filter(Number.isFinite);

if (!years.length) {
  status.hidden = false;
  status.textContent = 'Нет датированных событий для отображения.';
  throw new Error('Event map has no dated features.');
}

const datasetMin = Math.min(...years);
const datasetMax = Math.max(...years);
let selectedFrom = datasetMin;
let selectedTo = datasetMax;
let theme = currentTheme();
const markers = [];

for (const input of [rangeFrom, rangeTo]) {
  input.min = String(datasetMin);
  input.max = String(datasetMax);
  input.step = '1';
}
rangeFrom.value = String(datasetMin);
rangeTo.value = String(datasetMax);
rangeControl.hidden = false;

const map = new maplibregl.Map({
  container: canvas,
  style: mapStyleUrls[theme],
  center: [30, 52],
  zoom: 2.5,
  attributionControl: false,
  renderWorldCopies: false,
});

function filteredFeatures() {
  return datedFeatures.filter((feature) => overlaps(feature, selectedFrom, selectedTo));
}

function placeGroups() {
  const groups = new Map();
  for (const feature of filteredFeatures()) {
    const ref = feature.properties.placeRef;
    if (!groups.has(ref)) {
      groups.set(ref, {
        ref,
        label: feature.properties.placeLabel,
        coordinates: feature.geometry.coordinates,
        events: [],
      });
    }
    groups.get(ref).events.push(feature);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

function appendParticipants(row, feature) {
  const refs = Array.isArray(feature.properties.participants) ? feature.properties.participants : [];
  const participants = refs
    .map((ref) => peopleByRef.get(ref) ?? { ref, displayName: ref, url: `/people/${String(ref).replace(/\.mdx?$/i, '')}/` })
    .filter(Boolean);
  if (!participants.length) return;

  const actors = document.createElement('div');
  actors.className = 'rslive-map-popup-event-date';
  const prefix = document.createElement('span');
  prefix.textContent = participants.length === 1 ? 'Участник: ' : 'Участники: ';
  actors.append(prefix);

  participants.forEach((person, index) => {
    if (index > 0) actors.append(document.createTextNode(', '));
    const personLink = document.createElement('a');
    personLink.href = person.url;
    personLink.target = '_top';
    personLink.textContent = person.displayName || person.title || person.ref;
    actors.append(personLink);
  });
  row.append(actors);
}

function popupFor(group) {
  const wrapper = document.createElement('div');
  wrapper.className = 'rslive-map-popup';

  const name = document.createElement('strong');
  name.textContent = group.label;
  wrapper.append(name);

  const list = document.createElement('div');
  list.className = 'rslive-map-popup-events';
  for (const feature of group.events) {
    const row = document.createElement('div');
    row.className = 'rslive-map-popup-event';

    const date = eventDateLabel(feature);
    if (date) {
      const time = document.createElement('span');
      time.className = 'rslive-map-popup-event-date';
      time.textContent = date;
      row.append(time);
    }

    const link = document.createElement('a');
    link.href = feature.properties.eventUrl;
    link.target = '_top';
    link.textContent = feature.properties.eventTitle;
    row.append(link);
    appendParticipants(row, feature);
    list.append(row);
  }
  wrapper.append(list);
  return wrapper;
}

function createPlacePopup(group) {
  const popup = new maplibregl.Popup({
    maxWidth: 'min(22rem, 80vw)',
    offset: 24,
    focusAfterOpen: false,
  }).setDOMContent(popupFor(group));

  popup.on('open', () => {
    const content = popup.getElement()?.querySelector('.maplibregl-popup-content');
    if (content instanceof HTMLElement) content.style.border = '0';
  });
  return popup;
}

function clearMarkers() {
  while (markers.length) markers.pop()?.remove();
}

function renderMarkers() {
  clearMarkers();
  for (const group of placeGroups()) {
    markers.push(
      new maplibregl.Marker()
        .setLngLat(group.coordinates)
        .setPopup(createPlacePopup(group))
        .addTo(map),
    );
  }
}

function fitOverview(animate = true) {
  const groups = placeGroups();
  if (!groups.length) return;
  if (groups.length === 1) {
    map.easeTo({ center: groups[0].coordinates, zoom: Math.min(map.getMaxZoom(), 12.2), duration: animate ? 350 : 0 });
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  for (const group of groups) bounds.extend(group.coordinates);
  map.fitBounds(bounds, {
    padding: { top: 82, right: 48, bottom: 58, left: 48 },
    maxZoom: Math.min(map.getMaxZoom(), 12.2),
    duration: animate ? 350 : 0,
  });
}

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new HomeControl(() => fitOverview(true)), 'top-right');
map.addControl(new maplibregl.FullscreenControl({ container: root }), 'top-right');
map.addControl(new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
}), 'top-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

function updateRange() {
  let from = Number(rangeFrom.value);
  let to = Number(rangeTo.value);
  if (from > to) {
    if (document.activeElement === rangeFrom) to = from;
    else from = to;
    rangeFrom.value = String(from);
    rangeTo.value = String(to);
  }
  selectedFrom = from;
  selectedTo = to;
  rangeLabel.value = `Временной интервал: ${from === to ? from : `${from}–${to}`}`;

  const span = Math.max(1, datasetMax - datasetMin);
  rangeTrack.style.setProperty('--range-from', `${((from - datasetMin) / span) * 100}%`);
  rangeTrack.style.setProperty('--range-to', `${((to - datasetMin) / span) * 100}%`);
  renderMarkers();
}

rangeFrom.addEventListener('input', updateRange);
rangeTo.addEventListener('input', updateRange);

map.on('load', () => {
  updateRange();
  collapseAttribution();
  fitOverview(false);
});
map.once('idle', collapseAttribution);

let parentDocument = null;
try {
  if (window.parent && window.parent !== window) parentDocument = window.parent.document;
} catch {}

const syncTheme = () => {
  let next = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const parentValue = parentDocument?.documentElement.dataset.theme;
  if (parentValue === 'light' || parentValue === 'dark') next = parentValue;
  if (next === theme) return;
  theme = next;
  document.documentElement.dataset.theme = next;
  map.setStyle(mapStyleUrls[next]);
  map.once('style.load', collapseAttribution);
};

if (parentDocument) {
  const parentObserver = new MutationObserver(syncTheme);
  parentObserver.observe(parentDocument.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);
