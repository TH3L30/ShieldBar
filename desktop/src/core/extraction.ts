export interface ProbeAddressPayload {
  address: string
  country?: string | null
  countryCode?: string | null
}

export interface ProbePayload {
  readyState?: string | null
  pageIPv4?: string | null
  pageIPv4CountryCode?: string | null
  pageIPv6?: string | null
  countryCode?: string | null
  country?: string | null
  region?: string | null
  city?: string | null
  isp?: string | null
  organization?: string | null
  rtcSupported?: boolean | null
  rtcLocalText?: string | null
  rtcPublicText?: string | null
  rtcLocal?: ProbeAddressPayload[] | null
  rtcPublic?: ProbeAddressPayload[] | null
  rtcLocalLoading?: boolean | null
  rtcPublicLoading?: boolean | null
  rtcLeakText?: string | null
  rtcMismatchText?: string | null
}

/**
 * Adapted verbatim from the macOS BrowserLeaksProbe. Selectors must stay in
 * sync with the live BrowserLeaks /ip page so a layout change fails closed.
 */
export const EXTRACTION_JS = String.raw`(() => {
  const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();

  const rowValue = (label) => {
    const rows = Array.from(document.querySelectorAll('tr'));
    const row = rows.find((candidate) => {
      return candidate.cells &&
        candidate.cells.length >= 2 &&
        clean(candidate.cells[0].innerText) === label;
    });
    return row ? clean(row.cells[1].innerText) : null;
  };

  const readAddresses = (selector) => {
    const element = document.querySelector(selector);
    if (!element) {
      return { present: false, text: null, addresses: [] };
    }

    const text = clean(element.innerText);
    let addresses = Array.from(element.querySelectorAll('.flag-container')).map((container) => {
      const img = container.querySelector('img');
      const flagText = container.querySelector('.flag-text');
      return {
        address: clean(flagText ? flagText.innerText : container.innerText),
        country: img ? img.getAttribute('title') : null,
        countryCode: img ? img.getAttribute('alt') : null
      };
    }).filter((entry) => entry.address.length > 0);

    if (addresses.length === 0) {
      const direct = clean(element.innerText);
      const lower = direct.toLowerCase();
      if (direct && lower !== 'n/a' && lower !== '-' && lower !== '−' && lower !== 'unknown') {
        addresses = [{ address: direct, country: null, countryCode: null }];
      }
    }

    return { present: true, text, addresses };
  };

  const ipv4Element = document.querySelector('#client-ipv4');
  const ipv6 = readAddresses('#client-ipv6');
  const local = readAddresses('#rtc-local');
  const publicWebRTC = readAddresses('#rtc-public');
  const leakRow = document.querySelector('#rtc-leak');
  const mismatchRow = document.querySelector('.rtc-leak-tr');
  const lookupFlag = document.querySelector('#lookup-flag');

  const parentIsLoading = (selector) => {
    const element = document.querySelector(selector);
    return Boolean(element && element.parentElement && element.parentElement.classList.contains('load-td'));
  };

  return JSON.stringify({
    readyState: document.readyState,
    pageIPv4: ipv4Element ? (ipv4Element.dataset.ip || clean(ipv4Element.innerText)) : null,
    pageIPv4CountryCode: ipv4Element ? (ipv4Element.dataset.iso_code || null) : null,
    pageIPv6: ipv6.addresses.length > 0 ? ipv6.addresses[0].address : null,
    countryCode: lookupFlag ? (lookupFlag.dataset.iso_code || null) : (ipv4Element ? (ipv4Element.dataset.iso_code || null) : null),
    country: rowValue('Country') || (lookupFlag ? clean(lookupFlag.innerText) : null),
    region: rowValue('State/Region'),
    city: rowValue('City'),
    isp: rowValue('ISP'),
    organization: rowValue('Organization'),
    rtcSupported: typeof RTCPeerConnection === 'function',
    rtcLocalText: local.text,
    rtcPublicText: publicWebRTC.text,
    rtcLocal: local.addresses,
    rtcPublic: publicWebRTC.addresses,
    rtcLocalLoading: parentIsLoading('#rtc-local'),
    rtcPublicLoading: parentIsLoading('#rtc-public'),
    rtcLeakText: leakRow ? clean(leakRow.innerText) : null,
    rtcMismatchText: mismatchRow ? clean(mismatchRow.innerText) : null
  });
})()`

export function cleanText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim()
}

export function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return (
    normalized === 'n/a' ||
    normalized === '-' ||
    normalized === '−' ||
    normalized === 'unknown'
  )
}

export function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function sanitizedAddress(value: unknown): string | null {
  const trimmed = trimmedOrNull(value)
  if (!trimmed || isPlaceholder(trimmed)) return null
  return trimmed
}

export function normalizedCountryCode(value: unknown): string | null {
  const trimmed = trimmedOrNull(value)
  if (!trimmed) return null
  const code = trimmed.toUpperCase()
  return /^[A-Z]{2}$/.test(code) ? code : null
}

export function cleanedCountry(value: unknown, code: string | null): string | null {
  const trimmed = trimmedOrNull(value)
  if (!trimmed) return null
  const cleaned = code
    ? trimmed.replace(new RegExp(`\\s*\\(${code}\\)\\s*$`), '').trim()
    : trimmed
  return cleaned.length > 0 ? cleaned : null
}
