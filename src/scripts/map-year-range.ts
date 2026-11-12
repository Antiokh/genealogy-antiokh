/**
 * Shared year-range filtering for the full map and the maps embedded in person pages.
 * Undated records remain visible in the complete range and disappear only when the
 * reader narrows it, exactly as on the original all-events map.
 */

export interface MapDatedFeature {
  properties?: {
    startYear?: number | null;
    endYear?: number | null;
  };
}
export interface MapDatedPhoto {
  year?: number | null;
}
export interface MapYearRange {
  min: number;
  max: number;
}
export interface MapSelectedYears {
  from: number;
  to: number;
  full: boolean;
}

export function mapYearBounds(
  events: readonly MapDatedFeature[],
  photos: readonly MapDatedPhoto[],
): MapYearRange | null {
  const years: number[] = [];
  for (const feature of events) {
    const start = feature.properties?.startYear;
    if (!Number.isFinite(start)) continue;
    years.push(start as number);
    const end = feature.properties?.endYear;
    if (Number.isFinite(end)) years.push(end as number);
  }
  for (const photo of photos) {
    if (Number.isFinite(photo.year)) years.push(photo.year as number);
  }
  return years.length ? { min: Math.min(...years), max: Math.max(...years) } : null;
}

export function mapEventsInYears<T extends MapDatedFeature>(
  events: readonly T[],
  range: MapSelectedYears,
): T[] {
  return events.filter((feature) => {
    const start = feature.properties?.startYear;
    if (!Number.isFinite(start)) return range.full;
    const end = feature.properties?.endYear;
    const finish = Number.isFinite(end) ? (end as number) : (start as number);
    return (start as number) <= range.to && finish >= range.from;
  });
}

export function mapPhotosInYears<T extends MapDatedPhoto>(
  photos: readonly T[],
  range: MapSelectedYears,
): T[] {
  return photos.filter((photo) => (
    Number.isFinite(photo.year)
      ? (photo.year as number) >= range.from && (photo.year as number) <= range.to
      : range.full
  ));
}

/**
 * Mount on pre-rendered controls in either renderer. All selectors are scoped
 * to one control, so separate person maps on the same page cannot interfere.
 * The caller owns the map markers and may re-render them in onChange.
 */
export function mountMapYearRange(
  control: HTMLElement,
  events: readonly MapDatedFeature[],
  photos: readonly MapDatedPhoto[],
  onChange: () => void,
): { selected: () => MapSelectedYears; dispose: () => void } {
  const fromInput = control.querySelector<HTMLInputElement>('[data-range-from]');
  const toInput = control.querySelector<HTMLInputElement>('[data-range-to]');
  const track = control.querySelector<HTMLElement>('[data-range-track]');
  const label = control.querySelector<HTMLOutputElement>('[data-range-label]');
  if (!fromInput || !toInput || !track || !label) {
    throw new Error('Map year slider is missing required elements.');
  }

  const bounds = mapYearBounds(events, photos);
  control.hidden = !bounds;
  const min = bounds?.min ?? 0;
  const max = bounds?.max ?? 0;
  let from = min;
  let to = max;
  const selected = (): MapSelectedYears => ({
    from, to,
    full: !bounds || (from === min && to === max),
  });

  if (bounds) {
    for (const input of [fromInput, toInput]) {
      input.min = String(min);
      input.max = String(max);
      input.step = '1';
      input.disabled = min === max;
    }
    fromInput.value = String(min);
    toInput.value = String(max);
  }

  const update = (notify: boolean) => {
    if (!bounds) return;
    from = Number(fromInput.value);
    to = Number(toInput.value);
    if (from > to) {
      if (document.activeElement === fromInput) to = from;
      else from = to;
      fromInput.value = String(from);
      toInput.value = String(to);
    }
    const years = from === to ? String(from) : `${from}–${to}`;
    label.value = years;
    label.setAttribute('aria-label', `Временной интервал: ${years}`);
    const span = Math.max(1, max - min);
    track.style.setProperty('--range-from', `${((from - min) / span) * 100}%`);
    track.style.setProperty('--range-to', `${((to - min) / span) * 100}%`);
    if (notify) onChange();
  };
  const handleInput = () => update(true);
  if (bounds) {
    fromInput.addEventListener('input', handleInput);
    toInput.addEventListener('input', handleInput);
    update(false);
  }
  return {
    selected,
    dispose: () => {
      fromInput.removeEventListener('input', handleInput);
      toInput.removeEventListener('input', handleInput);
    },
  };
}
