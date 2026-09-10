/**
 * QA & Bug Tracker Service Client
 * Connects to PostgreSQL via /api/new/qa-tracker
 */

const API_PATH = '/api/new/qa-tracker';

export const ISSUE_STATUSES = [
  'Open',
  'In Progress',
  'Ready for QA',
  'Resolved',
  'Closed',
  'Deferred'
];

export const ISSUE_TYPES = [
  'Bug',
  'UI/UX Tweak',
  'Feature Request',
  'Performance',
  'QA Update',
  'Data/Config'
];

export const ISSUE_PRIORITIES = [
  'Critical',
  'High',
  'Medium',
  'Low'
];

export const ISSUE_MODULES = [
  'General',
  'Schedule',
  'Operationals',
  'Students',
  'Subscriptions',
  'Report Cards',
  'Live Progress',
  'CRM',
  'Instructors',
  'Workload',
  'Leave',
  'Trial Availability',
  'Users',
  'Activity Log',
  'Auth / Login'
];

export const STATUS_COLORS = {
  'Open': { bg: '#fee2e2', text: '#991b1b', border: '#fecaca' },
  'In Progress': { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe' },
  'Ready for QA': { bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
  'Resolved': { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' },
  'Closed': { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' },
  'Deferred': { bg: '#f3e8ff', text: '#6b21a8', border: '#e9d5ff' }
};

export const PRIORITY_COLORS = {
  'Critical': { bg: '#ef4444', text: '#ffffff' },
  'High': { bg: '#f97316', text: '#ffffff' },
  'Medium': { bg: '#f59e0b', text: '#ffffff' },
  'Low': { bg: '#64748b', text: '#ffffff' }
};

export const TYPE_ICONS_MAP = {
  'Bug': 'AlertCircle',
  'UI/UX Tweak': 'Palette',
  'Feature Request': 'Sparkles',
  'Performance': 'Zap',
  'QA Update': 'CheckCircle2',
  'Data/Config': 'Database'
};

/**
 * Fetch issues with optional filters.
 */
export async function getIssues(filters = {}) {
  const qs = new URLSearchParams();
  if (filters.status && filters.status !== 'all') qs.set('status', filters.status);
  if (filters.type && filters.type !== 'all') qs.set('type', filters.type);
  if (filters.priority && filters.priority !== 'all') qs.set('priority', filters.priority);
  if (filters.module && filters.module !== 'all') qs.set('module', filters.module);
  if (filters.search && filters.search.trim()) qs.set('search', filters.search.trim());
  if (filters.limit) qs.set('limit', String(filters.limit));

  const res = await fetch(`${API_PATH}?${qs.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch QA issues');
  }
  return await res.json();
}

/**
 * Fetch single issue by ID.
 */
export async function getIssueById(id) {
  const res = await fetch(`${API_PATH}?id=${id}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch issue details');
  }
  return await res.json();
}

/**
 * Sanitizes attachments before sending to the server:
 * Strips redundant large fields like `originalUrl` to reduce payload size.
 */
export function sanitizeAttachmentsForPayload(attachments = []) {
  if (!Array.isArray(attachments)) return [];
  return attachments.map(att => {
    if (!att || typeof att !== 'object') return att;
    const { originalUrl, ...cleanAtt } = att;
    return cleanAtt;
  });
}

/**
 * Create a new QA issue.
 */
export async function createIssue(data) {
  const payload = { ...data };
  if (payload.attachments) {
    payload.attachments = sanitizeAttachmentsForPayload(payload.attachments);
  }

  const res = await fetch(API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    if (res.status === 413) {
      throw new Error('Upload size exceeded server limit (HTTP 413 Request Entity Too Large). Please reduce the number of screenshots or attachment sizes.');
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create QA issue (HTTP ${res.status})`);
  }
  return await res.json();
}

/**
 * Update an existing QA issue.
 */
export async function updateIssue(id, data) {
  const payload = { ...data };
  if (payload.attachments) {
    payload.attachments = sanitizeAttachmentsForPayload(payload.attachments);
  }

  const res = await fetch(`${API_PATH}?id=${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    if (res.status === 413) {
      throw new Error('Upload size exceeded server limit (HTTP 413 Request Entity Too Large). Please reduce screenshot attachments.');
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update QA issue (HTTP ${res.status})`);
  }
  return await res.json();
}

/**
 * Delete a QA issue.
 */
export async function deleteIssue(id) {
  const res = await fetch(`${API_PATH}?id=${id}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete QA issue');
  }
  return await res.json();
}

/**
 * Get comments for an issue.
 */
export async function getComments(issueId) {
  const res = await fetch(`${API_PATH}/${issueId}/comments`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch comments');
  }
  return await res.json();
}

/**
 * Post a new comment.
 */
export async function addComment(issueId, commentData) {
  const payload = { ...commentData };
  if (payload.attachments) {
    payload.attachments = sanitizeAttachmentsForPayload(payload.attachments);
  }

  const res = await fetch(`${API_PATH}/${issueId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    if (res.status === 413) {
      throw new Error('Comment upload size exceeded server limit (HTTP 413). Please reduce attached screenshots.');
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to add comment (HTTP ${res.status})`);
  }
  return await res.json();
}

/**
 * Subscribe to issues via polling.
 */
export function subscribeToIssues(callback, onError, filters = {}, intervalMs = 10000) {
  let active = true;

  const poll = async () => {
    try {
      const data = await getIssues(filters);
      if (active) callback(data);
    } catch (error) {
      if (active && onError) onError(error);
    }
  };

  poll();
  const interval = setInterval(poll, intervalMs);

  return () => {
    active = false;
    clearInterval(interval);
  };
}

/**
 * Capture browser/environment information automatically.
 */
export function captureEnvironmentInfo() {
  const userAgent = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
  let browser = 'Chrome / Browser';
  if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Edg')) browser = 'Edge';
  else if (userAgent.includes('Chrome')) browser = 'Chrome';
  else if (userAgent.includes('Safari')) browser = 'Safari';

  let os = 'Windows / Desktop';
  if (userAgent.includes('Win')) os = 'Windows';
  else if (userAgent.includes('Mac')) os = 'macOS';
  else if (userAgent.includes('Linux')) os = 'Linux';
  else if (userAgent.includes('Android')) os = 'Android';
  else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS';

  const screenStr = typeof window !== 'undefined' && window.screen 
    ? `${window.screen.width || 1920}x${window.screen.height || 1080}` 
    : '1920x1080';

  const viewportStr = typeof window !== 'undefined' 
    ? `${window.innerWidth || 1920}x${window.innerHeight || 1080}` 
    : '1920x1080';

  const urlStr = typeof window !== 'undefined' && window.location 
    ? (window.location.pathname || '/') + (window.location.search || '') 
    : '/';

  return {
    browser,
    os,
    screen: screenStr,
    viewport: viewportStr,
    url: urlStr,
    capturedAt: new Date().toISOString()
  };
}

/**
 * Compresses an image dataURL / File using HTML5 canvas.
 * Reduces file payload to ensure fast network transfer and storage.
 * Automatically tries WebP with JPEG fallback, scaling to target budget.
 *
 * @param {File|Blob|string} fileOrDataUrl
 * @param {number} [maxWidth=1280] Max width in pixels (default 1280)
 * @param {number} [maxHeight=900] Max height in pixels (default 900)
 * @param {number} [quality=0.72] Compression quality (default 0.72)
 * @param {number} [maxBytes=120000] Target max binary byte size (~120KB)
 * @returns {Promise<string>} dataURL
 */
export function compressImage(fileOrDataUrl, maxWidth = 1280, maxHeight = 900, quality = 0.72, maxBytes = 120000) {
  return new Promise((resolve, reject) => {
    const processImage = (src) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Check if browser supports image/webp export
        let dataUrl = canvas.toDataURL('image/webp', quality);
        let isWebp = typeof dataUrl === 'string' && dataUrl.startsWith('data:image/webp');
        if (!isWebp) {
          dataUrl = canvas.toDataURL('image/jpeg', Math.min(quality, 0.70));
        }

        // Approximate binary size: base64 payload is ~0.75 of string length after comma
        const commaIdx = dataUrl.indexOf(',');
        let estimatedBytes = commaIdx >= 0 ? Math.round((dataUrl.length - commaIdx) * 0.75) : dataUrl.length;

        // If still exceeds maxBytes, perform secondary pass with reduced dimensions and quality
        if (estimatedBytes > maxBytes && (width > 800 || quality > 0.45)) {
          const scale = Math.max(0.7, Math.sqrt(maxBytes / estimatedBytes));
          const secondWidth = Math.max(640, Math.round(width * scale));
          const secondHeight = Math.max(480, Math.round(height * scale));

          canvas.width = secondWidth;
          canvas.height = secondHeight;
          ctx.drawImage(img, 0, 0, secondWidth, secondHeight);

          const lowerQuality = Math.max(0.48, quality - 0.16);
          if (isWebp) {
            dataUrl = canvas.toDataURL('image/webp', lowerQuality);
          } else {
            dataUrl = canvas.toDataURL('image/jpeg', lowerQuality);
          }
        }

        resolve(dataUrl);
      };
      img.onerror = (e) => reject(e);
      img.src = src;
    };

    if (typeof fileOrDataUrl === 'string') {
      processImage(fileOrDataUrl);
    } else if (fileOrDataUrl instanceof File || fileOrDataUrl instanceof Blob) {
      const reader = new FileReader();
      reader.onload = (e) => processImage(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(fileOrDataUrl);
    } else {
      reject(new Error('Invalid image input'));
    }
  });
}

/**
 * Subscribe to open bug notifications via periodic polling.
 *
 * @param {Function} callback Called with { totalBugs, openBugs, criticalCount, allIssues }
 * @param {Function} [onError] Optional error handler
 * @param {number} [intervalMs=15000] Polling interval in ms
 * @returns {Function} Unsubscribe function
 */
export function subscribeToQaBugs(callback, onError, intervalMs = 15000) {
  let active = true;

  const poll = async () => {
    try {
      const issues = await getIssues();
      const openBugs = Array.isArray(issues) ? issues.filter(
        (i) => (i.category === 'Bug' || i.status === 'Open') && ['Open', 'In Progress', 'Ready for QA'].includes(i.status)
      ) : [];
      if (active && callback) {
        callback({
          totalBugs: openBugs.length,
          openBugs,
          criticalCount: openBugs.filter((b) => b.priority === 'Critical').length,
          allIssues: issues,
        });
      }
    } catch (err) {
      if (active && onError) onError(err);
    }
  };

  poll();
  const timer = setInterval(poll, intervalMs);
  return () => {
    active = false;
    clearInterval(timer);
  };
}

