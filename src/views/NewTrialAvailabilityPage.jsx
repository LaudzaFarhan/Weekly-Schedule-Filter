'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { subscribeToInternalClasses } from '../services/internalScheduleService';
import { subscribeToInternalInstructors } from '../services/internalInstructorService';
import { resolveBranchWorkingDays } from './NewOperationalsPage';
import { DAY_NAMES } from '../utils/constants';
import { doTimeSlotsOverlap } from '../utils/timeUtils';
import { Star, X } from 'lucide-react';

const FIXED_TRIAL_SLOTS = [
  '1.00 - 2.00 pm',
  '1.30 - 2.30 pm',
  '2.00 - 3.00 pm',
  '2.30 - 3.30 pm',
  '3.00 - 4.00 pm',
  '3.30 - 4.30 pm',
  '4.00 - 5.00 pm',
  '4.30 - 5.30 pm',
  '5.00 - 6.00 pm',
  '5.30 - 6.30 pm',
];

// Capability detection from a New Ops instructor level string
// ("Kinder and Junior" / "Junior and Coder").
const canKinder = (level) => /kinder/i.test(String(level || ''));
const canJunior = (level) => /junior/i.test(String(level || ''));
const canCoder = (level) => /coder/i.test(String(level || ''));

export default function NewTrialAvailabilityPage() {
  const { branches } = useSchedule();

  const [classes, setClasses] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [overviewBranch, setOverviewBranch] = useState('all');
  const [slotDetail, setSlotDetail] = useState(null); // { day, time, available, unavailable }

  useEffect(() => {
    const unsub = subscribeToInternalClasses(
      (data) => { setClasses(data); setLoading(false); },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToInternalInstructors((data) => setInstructors(data));
    return () => unsub();
  }, []);

  const branchList = [...new Set((branches || []).map((b) => b.name))].filter(Boolean);

  // Working days per instructor from the Operationals branch calendar.
  const workingDaysFor = (inst) => {
    const brs = inst?.branches || [];
    const days = new Set();
    if (brs.length === 0) {
      resolveBranchWorkingDays({ name: 'default' }).forEach((d) => days.add(d));
    } else {
      brs.forEach((bn) => {
        const branch = (branches || []).find((b) => b.name === bn) || { name: bn };
        resolveBranchWorkingDays(branch).forEach((d) => days.add(d));
      });
    }
    return days;
  };

  const overview = useMemo(() => {
    const activeInstructors = instructors.filter((i) => (i.status || 'Active') === 'Active');

    return FIXED_TRIAL_SLOTS.map((timeSlot) => {
      const row = { time: timeSlot };
      DAY_NAMES.forEach((day) => {
        const available = [];
        const unavailable = [];

        activeInstructors.forEach((inst) => {
          // Branch scope
          if (overviewBranch !== 'all' && !(inst.branches || []).includes(overviewBranch)) return;

          let reason = '';
          let isAvailable = true;
          const wd = workingDaysFor(inst);

          if (!wd.has(day)) {
            isAvailable = false;
            reason = 'Branch closed / not available';
          } else {
            const busy = classes.find(
              (c) => c.teacher === inst.name && c.day === day && doTimeSlotsOverlap(c.time, timeSlot)
            );
            if (busy) {
              isAvailable = false;
              const badge = busy.branchName ? `[${busy.branchName}] ` : '';
              reason = `Teaching ${badge}${busy.program || 'class'} (${busy.time})`;
            }
          }

          if (isAvailable) available.push(inst);
          else unavailable.push({ ...inst, reason });
        });

        row[day] = { available, unavailable };
      });
      return row;
    });
  }, [instructors, classes, overviewBranch, branches]);

  const hasData = instructors.length > 0;

  return (
    <section className="dashboard-view active">
      <div className="panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Star size={20} /> Trial Availability Overview
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Weekly overview of available trial slots — from New Operations instructors &amp; schedule.
            </p>
          </div>
          <select
            value={overviewBranch}
            onChange={(e) => setOverviewBranch(e.target.value)}
            style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'white', fontSize: '0.85rem', cursor: 'pointer' }}
          >
            <option value="all">All Branches</option>
            {branchList.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div className="panel-body">
          {/* Legend */}
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            <span style={chipStyle('#4f46e5', 'rgba(79,70,229,0.12)')}>K</span> Kinder
            <span style={chipStyle('#0891b2', 'rgba(8,145,178,0.12)')}>J</span> Junior
            <span style={chipStyle('#ea580c', 'rgba(249,115,22,0.12)')}>C</span> Coder
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="trial-overview-table" style={{ width: '100%', textAlign: 'center', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                  <th style={{ padding: 10, textAlign: 'left', fontSize: '0.78rem', color: 'var(--text-muted)' }}>Time</th>
                  {DAY_NAMES.map((d) => (
                    <th key={d} style={{ padding: 10, fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{d.slice(0, 3)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={DAY_NAMES.length + 1} style={{ padding: '2rem', color: 'var(--text-muted)' }}>Loading…</td></tr>
                ) : !hasData ? (
                  <tr><td colSpan={DAY_NAMES.length + 1} style={{ padding: '2rem', color: 'var(--text-muted)' }}>Add instructors under the Instructors tab to see availability.</td></tr>
                ) : (
                  overview.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: 10, textAlign: 'left', fontWeight: 500, whiteSpace: 'nowrap' }}>{row.time}</td>
                      {DAY_NAMES.map((day) => {
                        const avail = row[day].available;
                        if (avail.length === 0) {
                          return <td key={day} style={{ padding: 10, color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</td>;
                        }
                        const kinder = avail.filter((p) => canKinder(p.level)).length;
                        const junior = avail.filter((p) => canJunior(p.level)).length;
                        const coder = avail.filter((p) => canCoder(p.level)).length;
                        return (
                          <td key={day} style={{ padding: 8 }}>
                            <div
                              onClick={() => setSlotDetail({ day, time: row.time, ...row[day] })}
                              style={{ display: 'inline-flex', gap: '0.25rem', cursor: 'pointer' }}
                              title="Click for instructor details"
                            >
                              <span style={chipStyle('#4f46e5', 'rgba(79,70,229,0.12)')}>{kinder}</span>
                              <span style={chipStyle('#0891b2', 'rgba(8,145,178,0.12)')}>{junior}</span>
                              <span style={chipStyle('#ea580c', 'rgba(249,115,22,0.12)')}>{coder}</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Slot detail modal */}
      {slotDetail && (
        <div
          onClick={() => setSlotDetail(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--panel-bg, white)', borderRadius: '12px', maxWidth: '520px', width: '100%', maxHeight: '82vh', overflow: 'auto', border: '1px solid var(--border-color)' }}>
            <div style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{slotDetail.day} · {slotDetail.time}</h3>
              <button onClick={() => setSlotDetail(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><X size={18} /></button>
            </div>
            <div style={{ padding: '1rem 1.5rem' }}>
              <h4 style={{ color: '#059669', margin: '0 0 0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>Available ({slotDetail.available.length})</h4>
              {slotDetail.available.length > 0 ? (
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1.5rem' }}>
                  {slotDetail.available.map((p, i) => (
                    <li key={i} style={{ padding: '0.5rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{p.level}</span>
                    </li>
                  ))}
                </ul>
              ) : <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '1.5rem' }}>No instructors available.</p>}

              <h4 style={{ color: '#dc2626', margin: '0 0 0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>Unavailable ({slotDetail.unavailable.length})</h4>
              {slotDetail.unavailable.length > 0 ? (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {slotDetail.unavailable.map((p, i) => (
                    <li key={i} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 500 }}>{p.name}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{p.level}</span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--danger, #dc2626)' }}>{p.reason}</div>
                    </li>
                  ))}
                </ul>
              ) : <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>Everyone is available.</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function chipStyle(color, bg) {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    minWidth: '22px', height: '22px', borderRadius: '6px', fontSize: '0.72rem',
    fontWeight: 700, color, background: bg, padding: '0 0.35rem',
  };
}
