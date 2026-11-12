// @ts-nocheck
import maplibregl from 'maplibre-gl';
import { createMapPopupContent, createPhotoMarkerElement, groupMapRecords, mountMapLayerSwitch } from './map-popup';
import { MapOverviewControl } from './map-controls';

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
  dark: 'https://tiles.openfreemap.org/styles/bright',
  light: 'https://tiles.openfreemap.org/styles/bright',
};

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function overlaps(feature, from, to) {
  const start = feature.properties.startYear;
  const end = feature.properties.endYear ?? start;
  return Number.isFinite(start) && Number.isFinite(end) && Number(start) <= to && Number(end) >= from;
}

function collapseAttribution() {
  const control = root.querySelector('.maplibregl-ctrl-attrib');
  if (!(control instanceof HTMLElement)) return;
  control.classList.add('maplibregl-compact');
  control.classList.remove('maplibregl-compact-show');
  const button = control.querySelector('.maplibregl-ctrl-attrib-button');
  if (button instanceof HTMLElement) button.setAttribute('aria-expanded', 'false');
}

const [eventResponse, peopleResponse, photoResponse] = await Promise.all([
  fetch('/generated/places.geojson'),
  fetch('/generated/people.json'),
  fetch('/events/map-media.json'),
]);
if (!eventResponse.ok || !peopleResponse.ok || !photoResponse.ok) {
  status.hidden = false;
  status.classList.add('error');
  status.textContent = 'Не удалось загрузить данные карты.';
  throw new Error(`Failed to load map data: events=${eventResponse.status}, people=${peopleResponse.status}, photos=${photoResponse.status}`);
}

const dataset = await eventResponse.json();
const peopleDataset = await peopleResponse.json();
const photoDataset = await photoResponse.json();
const peopleByRef = new Map((peopleDataset.people ?? []).map((person) => [person.ref, person]));
const allFeatures = dataset.features ?? [];
const allPhotos = photoDataset.photos ?? [];
const datedFeatures = allFeatures.filter((feature) => Number.isFinite(feature.properties?.startYear));
const years = [
  ...datedFeatures.flatMap((feature) => [
    Number(feature.properties.startYear),
    Number(feature.properties.endYear ?? feature.properties.startYear),
  ]),
  ...allPhotos.map((photo) => photo.year),
].filter(Number.isFinite);

if (!allFeatures.length && !allPhotos.length) {
  status.hidden = false;
  status.textContent = 'Нет географически привязанных событий или фотографий.';
  throw new Error('Event map has no georeferenced records.');
}

const hasDatedRange = years.length > 0;
const datasetMin = hasDatedRange ? Math.min(...years) : 0;
const datasetMax = hasDatedRange ? Math.max(...years) : 0;
let selectedFrom = datasetMin;
let selectedTo = datasetMax;
let layerMode = 'all';
let theme = currentTheme();
const markers = [];

if (hasDatedRange) {
  for (const input of [rangeFrom, rangeTo]) {
    input.min = String(datasetMin);
    input.max = String(datasetMax);
    input.step = '1';
  }
  rangeFrom.value = String(datasetMin);
  rangeTo.value = String(datasetMax);
}
rangeControl.hidden = !hasDatedRange;

const map = new maplibregl.Map({
  container: canvas,
  style: mapStyleUrls[theme],
  center: [30, 52],
  zoom: 2.5,
  attributionControl: false,
  renderWorldCopies: false,
});

function isFullRange() {
  return !hasDatedRange || (selectedFrom === datasetMin && selectedTo === datasetMax);
}

function filteredFeatures() {
  return allFeatures.filter((feature) => (
    Number.isFinite(feature.properties?.startYear)
      ? overlaps(feature, selectedFrom, selectedTo)
      : isFullRange()
  ));
}

function filteredPhotos() {
  return allPhotos.filter((photo) => (
    Number.isFinite(photo.year)
      ? photo.year >= selectedFrom && photo.year <= selectedTo
      : isFullRange()
  ));
}

function placeGroups() {
  return groupMapRecords(
    layerMode === 'photos' ? [] : filteredFeatures(),
    layerMode === 'events' ? [] : filteredPhotos(),
  );
}

function clearMarkers() {
  while (markers.length) markers.pop()?.remove();
}

function renderMarkers() {
  clearMarkers();
  for (const group of placeGroups()) {
    const hasPhotos = group.photos.length > 0;
    markers.push(
      new maplibregl.Marker(hasPhotos
        ? { element: createPhotoMarkerElement(group), anchor: 'bottom' }
        : undefined)
        .setLngLat(group.coordinates)
        .setPopup(new maplibregl.Popup({
          maxWidth: 'min(22rem, 80vw)',
          offset: hasPhotos ? 22 : 24,
          focusAfterOpen: false,
        }).setDOMContent(createMapPopupContent(group, peopleByRef)))
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

mountMapLayerSwitch(root, allFeatures.length > 0, allPhotos.length > 0, (next) => {
  layerMode = next;
  renderMarkers();
  fitOverview(false);
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new MapOverviewControl(() => fitOverview(true), 'Показать все объекты'), 'top-right');
map.addControl(new maplibregl.FullscreenControl({ container: root }), 'top-right');
map.addControl(new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
}), 'top-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

function updateRange() {
  if (!hasDatedRange) {
    renderMarkers();
    return;
  }
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
