import { DAY_NAMES } from '../utils/constants';

/**
 * Convert a published Google Sheets URL to a base /pub URL.
 */
export function getBaseUrl(url) {
  if (!url) return null;
  url = url.trim();
  if (url.includes('?')) url = url.split('?')[0];
  if (url.includes('#')) url = url.split('#')[0];
  if (url.endsWith('/pubhtml')) url = url.replace('/pubhtml', '/pub');
  if (url.endsWith('/edit')) url = url.replace('/edit', '/pub');
  if (!url.endsWith('/pub')) url = url + '/pub';
  return url;
}

/**
 * Build a proxy URL to avoid CORS.
 * Uses local proxy on localhost, public CORS proxy when deployed (e.g. GitHub Pages).
 */
export function getProxyUrl(targetUrl) {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocal) {
    return `/proxy?url=${encodeURIComponent(targetUrl)}`;
  }
  return `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
}

/**
 * Fetch with a timeout.
 */
export async function fetchWithTimeout(url, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Discover all tabs from a published Google Sheet.
 */
export async function discoverTabs(baseUrl) {
  const pubHtmlUrl = baseUrl.replace('/pub', '/pubhtml');
  const proxyUrl = getProxyUrl(pubHtmlUrl);
  const response = await fetchWithTimeout(proxyUrl, 15000);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching tabs`);
  const html = await response.text();

  const tabs = [];
  let match;

  // Try old HTML list format
  const oldRegex = /<li[^>]*id="sheet-button-(\d+)"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/g;
  while ((match = oldRegex.exec(html)) !== null) {
    tabs.push({ gid: match[1], name: match[2].trim() });
  }

  // Try new JS array format if old format failed
  if (tabs.length === 0) {
    const newRegex = /\{name:\s*"([^"]+)"[^}]+gid:\s*"(\d+)"/g;
    while ((match = newRegex.exec(html)) !== null) {
      tabs.push({ gid: match[2], name: match[1].trim() });
    }
  }

  if (tabs.length === 0) {
    throw new Error('Could not find any tabs. Make sure the sheet is published.');
  }
  return tabs;
}

/**
 * Filter tabs to only day-schedule tabs.
 */
export function filterDayTabs(allTabs) {
  return allTabs.filter((tab) => {
    const lower = tab.name.toLowerCase();
    return DAY_NAMES.some((day) => lower.includes(day.toLowerCase()));
  });
}
