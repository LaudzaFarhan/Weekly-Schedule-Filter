'use client';

import { useState, useEffect, useCallback } from 'react';
import { withDefaults } from '../lib/programRules';

const API_PATH = '/api/new/schedule-rules';

/**
 * Slot-combination rules, read from PostgreSQL.
 *
 * Falls back to the built-in defaults if the fetch fails, so scheduling is
 * never blocked by a rules lookup problem.
 */
export function useScheduleRules() {
  const [rules, setRules] = useState(() => withDefaults(null));
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(API_PATH);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load rules');
      const data = await res.json();
      setRules(withDefaults(data.rules));
      setConfigured(!!data.configured);
      setError(null);
    } catch (err) {
      setError(err.message);
      setRules(withDefaults(null));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (next) => {
    const res = await fetch(API_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save rules');
    const data = await res.json();
    setRules(withDefaults(data.rules));
    setConfigured(true);
    return data;
  }, []);

  const reset = useCallback(async () => {
    const res = await fetch(API_PATH, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to reset rules');
    const data = await res.json();
    setRules(withDefaults(data.rules));
    setConfigured(false);
    return data;
  }, []);

  return { rules, configured, loading, error, save, reset, reload: load };
}

export default useScheduleRules;
