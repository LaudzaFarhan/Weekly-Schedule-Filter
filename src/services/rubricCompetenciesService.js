/**
 * API client service for Report Card Rubric Competencies
 * (PostgreSQL via /api/new/rubric-competencies)
 */

const API_PATH = '/api/new/rubric-competencies';

/**
 * Fetch rubric competencies for a specific program category or all categories.
 *
 * @param {{ category?: 'Kinder'|'Junior'|'Coder', includeInactive?: boolean }} [options]
 * @returns {Promise<{ categories: string[], competencies: Record<string, Object[]>, usingFallback: Record<string, boolean>, maxPerCategory: number }>}
 */
export async function getRubricCompetencies({ category, includeInactive } = {}) {
  try {
    const qs = new URLSearchParams();
    if (category) qs.set('category', category);
    if (includeInactive) qs.set('includeInactive', 'true');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';

    const res = await fetch(`${API_PATH}${suffix}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || errData.message || 'Failed to fetch rubric competencies');
    }
    return await res.json();
  } catch (error) {
    console.warn('[rubricCompetenciesService] Fetch rubric competencies failed:', error?.message || error);
    throw error;
  }
}

/**
 * Add a new competency to a category.
 *
 * @param {{ category: string, key: string, label: string, color?: string, descriptors?: Record<number|string, string> }} data
 */
export async function createRubricCompetency(data) {
  try {
    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.error || 'Failed to create competency');
    }
    return await res.json();
  } catch (error) {
    console.error('Error creating rubric competency:', error);
    throw error;
  }
}

/**
 * Update an existing competency by id, or bulk reorder competencies.
 *
 * @param {number|null} id
 * @param {{ label?: string, color?: string, sortOrder?: number, descriptors?: Record<number|string, string>, active?: boolean, order?: number[] }} data
 */
export async function updateRubricCompetency(id, data) {
  try {
    const payload = id ? { id, ...data } : data;
    const res = await fetch(API_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.error || 'Failed to update competency');
    }
    return await res.json();
  } catch (error) {
    console.error('Error updating rubric competency:', error);
    throw error;
  }
}

/**
 * Reorder competencies in bulk for a category.
 *
 * @param {number[]} ids
 */
export async function reorderRubricCompetencies(ids) {
  return updateRubricCompetency(null, { order: ids });
}

/**
 * Delete (retire or hard delete) a competency.
 *
 * @param {number} id
 * @param {{ hard?: boolean }} [options]
 */
export async function deleteRubricCompetency(id, { hard = false } = {}) {
  try {
    const suffix = hard ? `?id=${encodeURIComponent(id)}&hard=true` : `?id=${encodeURIComponent(id)}`;
    const res = await fetch(`${API_PATH}${suffix}`, { method: 'DELETE' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || errData.error || 'Failed to delete competency');
    }
    return await res.json();
  } catch (error) {
    console.error('Error deleting rubric competency:', error);
    throw error;
  }
}
