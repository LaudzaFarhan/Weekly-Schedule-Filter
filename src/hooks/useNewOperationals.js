'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { subscribeToOperationals } from '../services/newOperationalsService';
import { DAY_NAMES } from '../utils/constants';

/**
 * Single source of truth for New Operations branch rules, read from PostgreSQL.
 *
 * `applyLocal` lets a caller that has just saved a rule show it immediately
 * instead of waiting for the next poll.
 *
 * Every New Ops page that needs to know when a branch is open, what hours it
 * runs, or what its class slot plan looks like should use this — never the
 * Google Sheets branch config, which belongs to Old Operations.
 *
 * Returns:
 *   rules          raw rows from /api/new/operationals
 *   loading        true until the first fetch resolves
 *   error          message when the fetch failed
 *   isEmpty        no rules configured yet
 *   branchNames    branches that have at least one rule
 *   openDaysFor    (branch) => day names the branch is open
 *   hoursFor       (branch, day) => { start, end } | null
 *   slotsFor       (branch, day) => slot array
 *   ruleFor        (branch, day) => the raw row | null
 */
export function useNewOperationals() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Merge a just-saved branch/day rule into the local copy.
   *
   * Without this, a caller that writes a rule waits for the next poll before
   * seeing it, which reads as a lag of several seconds after adding a slot.
   */
  const applyLocal = useCallback((row) => {
    if (!row?.branchName || !row?.day) return;
    setRules((prev) => {
      const i = prev.findIndex((r) => r.branchName === row.branchName && r.day === row.day);
      if (i === -1) return [...prev, row];
      const next = [...prev];
      next[i] = { ...next[i], ...row };
      return next;
    });
  }, []);

  useEffect(() => {
    const unsub = subscribeToOperationals(
      (data) => { setRules(data || []); setError(null); setLoading(false); },
      (err) => { setError(err?.message || 'Unable to load operational rules.'); setLoading(false); }
    );
    return () => unsub();
  }, []);

  // branch -> day -> rule, for constant-time lookups.
  const index = useMemo(() => {
    const map = new Map();
    for (const r of rules) {
      if (!map.has(r.branchName)) map.set(r.branchName, new Map());
      map.get(r.branchName).set(r.day, r);
    }
    return map;
  }, [rules]);

  const ruleFor = useCallback(
    (branch, day) => index.get(branch)?.get(day) || null,
    [index]
  );

  const openDaysFor = useCallback(
    (branch) => DAY_NAMES.filter((d) => index.get(branch)?.get(d)?.isOpen),
    [index]
  );

  const hoursFor = useCallback((branch, day) => {
    const r = index.get(branch)?.get(day);
    if (!r || !r.openTime || !r.closeTime) return null;
    return { start: r.openTime, end: r.closeTime };
  }, [index]);

  const slotsFor = useCallback((branch, day) => {
    const r = index.get(branch)?.get(day);
    return Array.isArray(r?.slots) ? r.slots : [];
  }, [index]);

  const branchNames = useMemo(
    () => [...new Set(rules.map((r) => r.branchName))].filter(Boolean).sort(),
    [rules]
  );

  return {
    rules,
    loading,
    error,
    isEmpty: !loading && rules.length === 0,
    branchNames,
    ruleFor,
    openDaysFor,
    hoursFor,
    slotsFor,
    applyLocal,
  };
}

export default useNewOperationals;
