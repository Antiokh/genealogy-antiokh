import { buildKinshipLabels } from '/tree/kinship.js';
import { enrichKinshipLabels } from '/tree/kinship-extended.js';

export const PERSON_CARD_WIDTH = 240;
export const PERSON_CARD_HEIGHT = 108;

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const initials = (name) => String(name || '?')
  .trim().split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('') || '?';

const normalizeSex = (value) => {
  const sex = String(value || '').toUpperCase();
  if (sex === 'M' || sex === 'MALE') return 'male';
  if (sex === 'F' || sex === 'FEMALE') return 'female';
  return 'unknown';
};

const nameSizeClass = (name) => {
  const length = String(name || '').trim().length;
  if (length > 58) return ' name-xxlong';
  if (length > 44) return ' name-xlong';
  if (length > 30) return ' name-long';
  return '';
};

const shouldShowBirthSurname = (name, birthSurname) => {
  const surname = String(birthSurname || '').trim();
  if (!surname) return false;
  return !String(name || '').trim().toLocaleLowerCase().endsWith(surname.toLocaleLowerCase());
};

const branchIcon = (state) => {
  const badge = state === 'expand'
    ? '<path d="M21 23h6M24 20v6"/>'
    : '<path d="M21 23h6"/>';
  return `<svg viewBox="0 0 30 30" width="30" height="30" aria-hidden="true">
    <circle class="branch-bg" cx="15" cy="15" r="14"/>
    <path class="branch-lines" d="M15 7v6M9 13h12M9 13v5M21 13v5"/>
    <circle class="branch-node" cx="15" cy="7" r="2"/>
    <circle class="branch-node" cx="9" cy="20" r="2"/>
    <circle class="branch-node" cx="21" cy="20" r="2"/>
    <circle class="branch-badge" cx="24" cy="23" r="6"/>
    <g class="branch-badge-mark">${badge}</g>
  </svg>`;
};

let kinshipLabelsPromise = null;

function loadKinshipLabels() {
  if (!kinshipLabelsPromise) {
    kinshipLabelsPromise = fetch('/generated/tree.json')
      .then((response) => {
        if (!response.ok) throw new Error(`tree.json: ${response.status}`);
        return response.json();
      })
      .then((family) => {
        const focusId = new URLSearchParams(globalThis.location?.search || '').get('person') || '';
        const labels = buildKinshipLabels(family, focusId);
        return enrichKinshipLabels(family, focusId, labels);
      })
      .catch((error) => {
        console.warn('Could not calculate kinship labels', error);
        return new Map();
      });
  }
  return kinshipLabelsPromise;
}

export class GenealogyPersonCard extends HTMLElement {
  static get observedAttributes() {
    return ['person-id', 'name', 'url', 'years', 'sex', 'deceased', 'photo', 'birth-surname', 'branch-state'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._relationship = null;
    this._relationshipFor = '';
  }

  connectedCallback() {
    this.render();
    this.loadRelationship();
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    this.render();
    if (name === 'person-id') this.loadRelationship();
  }

  async loadRelationship() {
    const personId = this.getAttribute('person-id') || '';
    if (!personId || this._relationshipFor === personId) return;
    this._relationshipFor = personId;
    const labels = await loadKinshipLabels();
    if (!this.isConnected || this.getAttribute('person-id') !== personId) return;
    this._relationship = labels.get(personId) || null;
    this.render();
  }

  render() {
    const name = this.getAttribute('name') || 'Unknown person';
    const url = this.getAttribute('url') || '';
    const years = this.getAttribute('years') || '';
    const personId = this.getAttribute('person-id') || '';
    const sex = normalizeSex(this.getAttribute('sex'));
    const deceased = this.hasAttribute('deceased');
    const photo = this.getAttribute('photo') || '';
    const birthSurname = this.getAttribute('birth-surname') || '';
    const branchState = this.getAttribute('branch-state') || '';
    const relationship = this._relationship;
    const relationshipLabel = typeof relationship === 'string' ? relationship : relationship?.label || '';
    const relationshipTitle = typeof relationship === 'string' ? relationship : relationship?.title || relationshipLabel;
    const showBirthSurname = shouldShowBirthSurname(name, birthSurname);
    const nameClass = `name${nameSizeClass(name)}`;
    const nameHtml = `<div class="${nameClass}">${esc(name)}</div>`;
    const avatar = `<div class="avatar ${sex}${deceased ? ' deceased' : ''}" aria-hidden="true">
      <span class="avatar-initials">${esc(initials(name))}</span>
      <img class="avatar-placeholder" src="/tree/person-placeholder.svg" alt="" draggable="false">
      ${photo ? `<img class="avatar-photo" src="${esc(photo)}" alt="" draggable="false">` : ''}
      <span class="avatar-shield"></span>
    </div>`;
    const avatarHtml = url
      ? `<a class="avatar-link genealogy-person-link" href="${esc(url)}" target="_top" aria-label="Открыть страницу: ${esc(name)}">${avatar}</a>`
      : avatar;
    const branchHtml = branchState === 'expand' || branchState === 'collapse'
      ? `<button class="branch-control branch-${branchState}" type="button" title="${branchState === 'expand' ? 'Раскрыть связи' : 'Свернуть связи'}" aria-label="${branchState === 'expand' ? 'Раскрыть связи' : 'Свернуть связи'}: ${esc(name)}">${branchIcon(branchState)}</button>`
      : '';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display:block; width:${PERSON_CARD_WIDTH}px; height:${PERSON_CARD_HEIGHT}px; overflow:visible;
          font-family:var(--sl-font-system, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
          color:var(--sl-color-text, #1f2937);
        }
        * { box-sizing:border-box; }
        .card {
          position:relative; width:100%; height:100%; display:grid; grid-template-columns:44px minmax(0,1fr);
          gap:10px; align-items:center; padding:8px 12px; overflow:visible;
          border-radius:14px; border:1px solid var(--sl-color-gray-5, #d7dde4);
          background:color-mix(in srgb, var(--sl-color-bg-nav, #fff) 96%, transparent);
          box-shadow:0 2px 9px color-mix(in srgb, var(--sl-color-black, #000) 10%, transparent);
          text-align:left;
        }
        .avatar-link {
          display:block; width:44px; height:44px; border-radius:50%; text-decoration:none;
          outline:none;
        }
        .avatar-link:focus-visible {
          outline:2px solid var(--sl-color-accent, #6b8cff); outline-offset:3px;
        }
        .avatar {
          --avatar-accent:var(--sl-color-accent, #6b8cff);
          position:relative; width:44px; height:44px; display:grid; place-items:center;
          overflow:hidden; border-radius:50%; background:var(--sl-color-gray-6, #eef0f3);
          color:var(--sl-color-gray-2, #4b5563); font-size:12px; font-weight:700;
          letter-spacing:.02em; user-select:none;
        }
        .avatar.male { --avatar-accent:color-mix(in srgb, var(--sl-color-accent, #6b8cff) 68%, #6f93a8); }
        .avatar.female { --avatar-accent:color-mix(in srgb, var(--sl-color-accent, #6b8cff) 55%, #c47e91); }
        .avatar-initials { position:relative; z-index:0; opacity:0; }
        .avatar-initials.visible { opacity:1; }
        .avatar-placeholder {
          position:absolute; z-index:1; width:31px; height:31px; object-fit:contain;
          opacity:.78; pointer-events:none; user-select:none; -webkit-user-drag:none;
        }
        .avatar-photo {
          position:absolute; z-index:2; inset:1px; width:42px; height:42px; border-radius:50%;
          object-fit:cover; opacity:0; transition:opacity .12s ease-out; user-select:none; -webkit-user-drag:none;
        }
        .avatar-photo.loaded { opacity:1; }
        .avatar.deceased .avatar-photo { filter:grayscale(1); }
        .avatar.deceased .avatar-placeholder { filter:grayscale(1); opacity:.62; }
        .avatar.deceased .avatar-initials { filter:grayscale(1); }
        .avatar.deceased .avatar-initials.visible { opacity:.72; }
        .avatar.deceased::after {
          content:''; position:absolute; z-index:3; right:-8px; bottom:8px; width:38px; height:5px;
          background:#000;
          transform:rotate(-42deg); pointer-events:none;
        }
        .avatar::before {
          content:''; position:absolute; z-index:4; inset:0; border:2px solid var(--avatar-accent);
          border-radius:50%; pointer-events:none;
        }
        .avatar-shield { position:absolute; z-index:5; inset:0; border-radius:50%; }
        .text { min-width:0; align-self:center; }
        .name {
          display:inline; font-size:14px; line-height:1.14; font-weight:650; color:var(--sl-color-text, #1f2937);
          white-space:normal; overflow:visible; overflow-wrap:anywhere; word-break:normal; hyphens:auto;
        }
        .name-long { font-size:13px; line-height:1.12; }
        .name-xlong { font-size:12px; line-height:1.1; }
        .name-xxlong { font-size:11px; line-height:1.08; }
        .birth-surname {
          margin-top:3px; font-size:10.5px; line-height:1.1; color:var(--sl-color-text-accent, var(--sl-color-accent, #6b8cff));
          white-space:normal; overflow-wrap:anywhere;
        }
        .years { margin-top:4px; font-size:11.5px; line-height:1.1; color:var(--sl-color-gray-3, #667085); white-space:nowrap; }
        .relationship {
          position:absolute; z-index:6; top:6px; right:9px; max-width:58%;
          overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
          color:var(--sl-color-text-accent, var(--sl-color-accent, #6b8cff));
          font-size:9.5px; line-height:1.1; font-weight:600; text-align:right;
          pointer-events:none;
        }
        .branch-control {
          appearance:none; position:absolute; z-index:9; left:-12px; top:-12px; width:30px; height:30px;
          padding:0; border:0; border-radius:50%; background:transparent;
          color:inherit; cursor:pointer; display:block;
        }
        .branch-control:focus-visible { outline:2px solid var(--tree-accent, var(--sl-color-accent)); outline-offset:2px; }
        .branch-control svg { display:block; overflow:visible; }
        .branch-bg { fill:var(--tree-background, var(--sl-color-bg)); stroke:var(--tree-accent, var(--sl-color-accent)); stroke-width:1.7; }
        .branch-lines { fill:none; stroke:var(--tree-accent, var(--sl-color-accent)); stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
        .branch-node { fill:var(--tree-accent, var(--sl-color-accent)); }
        .branch-badge { fill:var(--tree-accent, var(--sl-color-accent)); stroke:var(--tree-background, var(--sl-color-bg)); stroke-width:1.5; }
        .branch-badge-mark path { fill:none; stroke:var(--tree-background, var(--sl-color-bg)); stroke-width:1.8; stroke-linecap:round; }
      </style>
      <article class="card" data-person-id="${esc(personId)}">
        ${relationshipLabel ? `<div class="relationship" title="${esc(relationshipTitle)}">${esc(relationshipLabel)}</div>` : ''}
        ${avatarHtml}
        <div class="text">
          ${nameHtml}
          ${showBirthSurname ? `<div class="birth-surname">при рожд. ${esc(birthSurname)}</div>` : ''}
          <div class="years">${esc(years)}</div>
        </div>
        ${branchHtml}
      </article>`;

    const avatarLink = this.shadowRoot.querySelector('.avatar-link');
    avatarLink?.addEventListener('click', (event) => event.stopPropagation());

    const branchControl = this.shadowRoot.querySelector('.branch-control');
    branchControl?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.dispatchEvent(new CustomEvent('genealogy:toggle-person', {
        bubbles:true,
        composed:true,
        detail:personId,
      }));
    });

    const placeholder = this.shadowRoot.querySelector('.avatar-placeholder');
    const initialsFallback = this.shadowRoot.querySelector('.avatar-initials');
    if (placeholder) {
      const useInitials = () => {
        placeholder.remove();
        initialsFallback?.classList.add('visible');
      };
      placeholder.addEventListener('error', useInitials, { once:true });
      if (placeholder.complete && placeholder.naturalWidth === 0) useInitials();
    }

    const image = this.shadowRoot.querySelector('.avatar-photo');
    if (image) {
      const showPhoto = () => image.classList.add('loaded');
      const useFallback = () => image.remove();
      image.addEventListener('load', showPhoto, { once:true });
      image.addEventListener('error', useFallback, { once:true });
      if (image.complete) image.naturalWidth > 0 ? showPhoto() : useFallback();
    }
  }
}

if (!customElements.get('genealogy-person-card')) {
  customElements.define('genealogy-person-card', GenealogyPersonCard);
}

export function personCardElementHtml(person, { branchState = '' } = {}) {
  const deceasedAttribute = person.deceased ? '\n    deceased' : '';
  const urlAttribute = person.url ? `\n    url="${esc(person.url)}"` : '';
  const photoAttribute = person.photo ? `\n    photo="${esc(person.photo)}"` : '';
  const birthSurnameAttribute = person.birthSurname ? `\n    birth-surname="${esc(person.birthSurname)}"` : '';
  const branchAttribute = branchState ? `\n    branch-state="${esc(branchState)}"` : '';
  const displayName = person.cardName || person.name || 'Unknown person';

  return `<genealogy-person-card
    style="display:block;width:${PERSON_CARD_WIDTH}px;height:${PERSON_CARD_HEIGHT}px"
    person-id="${esc(person.id || '')}"
    name="${esc(displayName)}"
    years="${esc(person.years || '')}"
    sex="${esc(person.sex || '')}"${deceasedAttribute}${urlAttribute}${photoAttribute}${birthSurnameAttribute}${branchAttribute}
  ></genealogy-person-card>`;
}
