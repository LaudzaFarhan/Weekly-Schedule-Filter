'use client';

import React, { useState, useEffect } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { useToast } from '../components/ui/Toast';
import { DAY_NAMES, getWorkingDaysForBranch } from '../utils/constants';
import { MapPin, Save, Building2 } from 'lucide-react';

/**
 * Resolve a branch's operational days: prefer the explicit `workingDays`
 * saved on the branch, otherwise fall back to the legacy per-branch default.
 */
export function resolveBranchWorkingDays(branch) {
  if (branch && Array.isArray(branch.workingDays)) return branch.workingDays;
  const name = branch?.name === 'All Branches' ? 'default' : branch?.name;
  return getWorkingDaysForBranch(name);
}

export default function NewOperationalsPage() {
  const { branches, updateBranches } = useSchedule();
  const { showToast } = useToast();

  // Editable draft: branchId -> Set(dayName)
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Sync the draft from context branches. When there are no unsaved edits we
  // fully re-sync (so a cloud-config load after mount is reflected); when the
  // user has pending edits we keep those and only add any new branches.
  useEffect(() => {
    setDraft((prev) => {
      const next = {};
      for (const b of branches) {
        next[b.id] = dirty && prev[b.id] ? prev[b.id] : new Set(resolveBranchWorkingDays(b));
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches]);

  const toggleDay = (branchId, day) => {
    setDirty(true);
    setDraft((prev) => {
      const set = new Set(prev[branchId] || []);
      if (set.has(day)) set.delete(day);
      else set.add(day);
      return { ...prev, [branchId]: set };
    });
  };

  const setAll = (branchId, on) => {
    setDirty(true);
    setDraft((prev) => ({ ...prev, [branchId]: new Set(on ? DAY_NAMES : []) }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = branches.map((b) => ({
        ...b,
        workingDays: DAY_NAMES.filter((d) => draft[b.id]?.has(d)),
      }));
      // Await the durable (Google Sheets) write before confirming, so a quick
      // refresh can't cancel an in-flight save and lose the change.
      const res = await updateBranches(updated);
      if (res && res.configured === false) {
        showToast({
          title: 'Saved on this device only',
          message: res.error
            ? `Cloud sync failed: ${res.error}`
            : 'Cloud config is not connected, so this will not sync to other devices or the deployment.',
          variant: 'warning',
          duration: 7000,
        });
      } else {
        showToast({ title: 'Operational settings saved', variant: 'success' });
      }
      setDirty(false);
    } catch (err) {
      console.error('Failed to save operationals:', err);
      showToast({ title: 'Failed to save', message: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="dashboard-view active">
      <div className="panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Building2 size={20} /> Operationals
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Set which branches are open and can be assigned classes on each day. These days drive the Quick Add branch list on the Schedule page.
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '10px', padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
          >
            <Save size={16} /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

        <div className="panel-body table-wrapper">
          {branches.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
              No branches configured. Add branches in Admin Settings first.
            </div>
          ) : (
            <table id="schedule-table">
              <thead>
                <tr>
                  <th style={{ minWidth: '180px' }}>Branch</th>
                  {DAY_NAMES.map((d) => (
                    <th key={d} style={{ textAlign: 'center', width: '70px' }}>{d.slice(0, 3)}</th>
                  ))}
                  <th style={{ textAlign: 'center', width: '120px' }}>Quick set</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => {
                  const set = draft[b.id] || new Set();
                  const openCount = DAY_NAMES.filter((d) => set.has(d)).length;
                  return (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <MapPin size={14} style={{ color: 'var(--text-muted)' }} />
                          <span>
                            {b.name}
                            <span style={{ display: 'block', fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                              {openCount === 0 ? 'Closed all week' : `Open ${openCount} day${openCount === 1 ? '' : 's'}`}
                            </span>
                          </span>
                        </span>
                      </td>
                      {DAY_NAMES.map((d) => {
                        const on = set.has(d);
                        return (
                          <td key={d} style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => toggleDay(b.id, d)}
                              title={`${b.name} — ${d}: ${on ? 'Open' : 'Closed'}`}
                              style={{
                                width: '30px',
                                height: '30px',
                                borderRadius: '7px',
                                cursor: 'pointer',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                border: on ? '1.5px solid var(--primary-blue)' : '1px solid var(--border-color)',
                                background: on ? 'var(--primary-blue)' : 'transparent',
                                color: on ? 'white' : 'var(--text-muted)',
                                transition: 'all 0.15s',
                              }}
                            >
                              {on ? '✓' : ''}
                            </button>
                          </td>
                        );
                      })}
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: '0.3rem' }}>
                          <button
                            type="button"
                            onClick={() => setAll(b.id, true)}
                            className="btn"
                            style={{ fontSize: '0.68rem', padding: '0.25rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => setAll(b.id, false)}
                            className="btn"
                            style={{ fontSize: '0.68rem', padding: '0.25rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}
                          >
                            None
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
