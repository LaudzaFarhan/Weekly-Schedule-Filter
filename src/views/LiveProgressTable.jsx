'use client';

/**
 * Live Progress for one category.
 *
 * One row per enrolled student, built by joining the live schedule (who teaches
 * them, when, on what program) with the progress stored per student per level
 * (attendance, videos sent, whether they will carry on).
 *
 * The three sidebar pages are this component with a different `category`.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useToast } from '../components/ui/Toast';
import { subscribeToInternalClasses } from '../services/internalScheduleService';
import {
  subscribeToLiveProgress, saveLiveProgress,
} from '../services/newLiveProgressService';
import { useSchedule } from '../contexts/ScheduleContext';
import Pagination from '../components/ui/Pagination';
import {
  parseProgram, levelsForCategory, LESSONS_PER_LEVEL, CONTINUATION_OPTIONS,
  normaliseCoderLevel, lessonsForCategory,
} from '../lib/programRules';
import { isoOf } from '../lib/instructorAvailability';
import {
  Search, X, User, MapPin, Clock, Calendar, GraduationCap, Check, Video,
  StickyNote, AlertTriangle, TrendingUp,
} from 'lucide-react';

const PAGE_SIZE = 5;

/** Colour per continuation answer, so a table of them can be read at a glance. */
const CONTINUATION_TINT = {
  Continue: { color: '#047857', bg: 'rgba(5,150,105,0.12)' },
  Uncertain: { color: '#b45309', bg: 'rgba(245,158,11,0.14)' },
  Break: { color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' },
  'Not Decide Yet': { color: 'var(--text-muted)', bg: 'var(--bg-color)' },
  'Not Continue': { color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
};

/** Stable identity for a progress record: one student, one level. */
const keyOf = (studentName, programCode) =>
  `${String(studentName || '').trim().toLowerCase()}||${String(programCode || '').trim().toLowerCase()}`;

export default function LiveProgressTable({ category }) {
  const { showToast } = useToast();
  const { enabledBranches, branches } = useSchedule();

  const maxLessons = useMemo(() => lessonsForCategory(category), [category]);
  const lessons = useMemo(() => Array.from({ length: maxLessons }, (_, i) => i + 1), [maxLessons]);

  const [classes, setClasses] = useState([]);
  const [progress, setProgress] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterContinuation, setFilterContinuation] = useState('all');
  const [page, setPage] = useState(1);

  // The attendance cell being edited: { rowKey, lesson }.
  const [editing, setEditing] = useState(null);
  const [draftDate, setDraftDate] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);

  const levels = useMemo(() => levelsForCategory(category), [category]);
  const branchList = useMemo(
    () => [...new Set([
      ...(enabledBranches || []).map((b) => b.name),
      ...(branches || []).map((b) => b.name),
    ])].filter(Boolean),
    [enabledBranches, branches]
  );

  useEffect(() => {
    const unsub = subscribeToInternalClasses(
      (data) => { setClasses(data || []); setLoading(false); },
      // Without this the spinner would run forever on a failed fetch, since
      // `loading` is only cleared by a successful response.
      (err) => { setLoadError(err.message); setLoading(false); }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeToLiveProgress(
      (data) => { setProgress(data || []); setLoadError(null); },
      (err) => setLoadError(err.message),
      { category }
    );
    return () => unsub();
  }, [category]);

  // Latest stored progress, readable from a handler without it being a
  // dependency — see `persist`.
  const progressRef = useRef([]);
  useEffect(() => { progressRef.current = progress; }, [progress]);

  /** Stored progress by student+level, for joining onto the schedule rows. */
  const progressByKey = useMemo(() => {
    const map = new Map();
    for (const p of progress) map.set(keyOf(p.studentName, p.programCode), p);
    return map;
  }, [progress]);

  /**
   * One row per enrolled student in this category.
   *
   * A class row already is one student, so no grouping is needed — but the
   * `student` field can hold several comma-separated names on older rows, so it
   * is split defensively.
   */
  const rows = useMemo(() => {
    const out = [];
    for (const c of classes) {
      const parsed = parseProgram(c.program);
      if (parsed.category !== category) continue;

      const names = String(c.student || '')
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean);
      if (names.length === 0) continue;

      // Coder levels are stored whole, so fold a legacy numbered one onto its
      // stage; Kinder and Junior use the bare code without the lesson number.
      const levelCode = category === 'Coder'
        ? normaliseCoderLevel(parsed.code)
        : parsed.code;

      for (const name of names) {
        const stored = progressByKey.get(keyOf(name, levelCode));
        out.push({
          rowKey: keyOf(name, levelCode),
          classId: c.id,
          studentName: name,
          instructor: c.teacher || '—',
          day: c.day || '—',
          time: c.time || '—',
          branchName: c.branchName || '—',
          program: c.program || '—',
          levelCode,
          lesson: parsed.lesson,
          classType: c.classType || 'Regular',
          progressId: stored?.id ?? null,
          attendance: stored?.attendance || {},
          videos: stored?.videos || {},
          continuation: stored?.continuation || CONTINUATION_OPTIONS[0],
          continuationNote: stored?.continuationNote || '',
        });
      }
    }
    // A student can legitimately appear twice — two levels, or a replacement in
    // another class — so rows are deduplicated on student + level + class.
    const seen = new Set();
    return out.filter((r) => {
      const id = `${r.rowKey}||${r.classId}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [classes, category, progressByKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterBranch !== 'all' && r.branchName !== filterBranch) return false;
      if (filterLevel !== 'all' && r.levelCode !== filterLevel) return false;
      if (filterContinuation !== 'all' && r.continuation !== filterContinuation) return false;
      if (q) {
        const hit = [r.studentName, r.instructor, r.program, r.day, r.branchName]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, search, filterBranch, filterLevel, filterContinuation]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => a.studentName.localeCompare(b.studentName)),
    [filtered]
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // Clamped where it is derived: the schedule polls, so the list can shrink
  // under the current page rather than the user having navigated off the end.
  const safePage = Math.min(Math.max(1, page), totalPages);
  const paged = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /** Attendance ticks recorded across the visible rows, for the header summary. */
  const attended = useMemo(
    () => sorted.reduce((n, r) => n + Object.keys(r.attendance).length, 0),
    [sorted]
  );

  /**
   * Persist a change, sending the whole record because the endpoint upserts.
   *
   * `mutate` receives the freshest stored values rather than the row captured at
   * render, and returns only the fields it changes. This matters: ticking two
   * lessons in quick succession used to send the second one built on the first
   * render's attendance map, which silently dropped the first tick — it looked
   * as though the tick had not saved.
   */
  const persist = async (row, mutate) => {
    const latest = progressRef.current.find(
      (p) => keyOf(p.studentName, p.programCode) === row.rowKey
    );
    const base = {
      attendance: { ...(latest?.attendance ?? row.attendance) },
      videos: { ...(latest?.videos ?? row.videos) },
      continuation: latest?.continuation ?? row.continuation,
      continuationNote: latest?.continuationNote ?? row.continuationNote,
    };
    const record = {
      studentName: row.studentName,
      programCode: row.levelCode,
      category,
      ...base,
      ...mutate(base),
    };

    setSaving(true);
    // Show it at once rather than waiting for the ten-second poll, and keep the
    // optimistic copy in the ref too so a change landing before the next poll
    // still builds on it.
    setProgress((prev) => [
      ...prev.filter((p) => keyOf(p.studentName, p.programCode) !== row.rowKey),
      { id: latest?.id ?? row.progressId, ...record },
    ]);
    try {
      const saved = await saveLiveProgress(record);
      // Adopt the server's row so the id is real and any normalisation sticks.
      setProgress((prev) => [
        ...prev.filter((p) => keyOf(p.studentName, p.programCode) !== row.rowKey),
        saved,
      ]);
    } catch (err) {
      showToast({ title: 'Could not save progress', message: err.message, variant: 'error' });
      // Drop the optimistic copy so the table stops showing a change that the
      // database rejected; the next poll restores the truth.
      setProgress((prev) => prev.filter(
        (p) => keyOf(p.studentName, p.programCode) !== row.rowKey
      ));
    } finally {
      setSaving(false);
    }
  };

  const openAttendance = (row, lesson) => {
    const entry = row.attendance[lesson];
    setEditing({ rowKey: row.rowKey, classId: row.classId, lesson });
    setDraftDate(entry?.date || isoOf(new Date()));
    setDraftNote(entry?.note || '');
  };

  const closeAttendance = () => { setEditing(null); setDraftDate(''); setDraftNote(''); };

  const saveAttendance = async (row, lesson, { clear = false } = {}) => {
    // Close first: the save is optimistic, so the tick is already correct and
    // holding the dialog open until the round trip finishes just feels slow.
    closeAttendance();
    await persist(row, (base) => {
      const attendance = { ...base.attendance };
      if (clear) delete attendance[lesson];
      else attendance[lesson] = { date: draftDate || null, note: draftNote };
      return { attendance };
    });
  };

  const toggleVideo = async (row, level) => {
    await persist(row, (base) => {
      const videos = { ...base.videos };
      if (videos[level]) delete videos[level];
      else videos[level] = true;
      return { videos };
    });
  };

  const setContinuation = async (row, value) => {
    await persist(row, () => ({ continuation: value }));
  };

  // Escape closes the attendance editor, matching the rest of the app.
  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeAttendance(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  const editorRef = useRef(null);
  useEffect(() => {
    if (!editing) return undefined;
    const onDown = (e) => {
      if (!editorRef.current?.contains(e.target)) closeAttendance();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [editing]);

  const editingRow = editing
    ? paged.find((r) => r.rowKey === editing.rowKey && r.classId === editing.classId)
    : null;

  return (
    <section className="dashboard-view active">
      <div className="panel full-schedule-panel">
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <TrendingUp size={18} /> {category} Progress
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Attendance, videos sent and continuation for every {category} student.
              Tick a lesson to record the date and a note.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            <span><strong style={{ color: 'var(--text-main)' }}>{sorted.length}</strong> student{sorted.length === 1 ? '' : 's'}</span>
            <span aria-hidden="true">·</span>
            <span><strong style={{ color: 'var(--text-main)' }}>{attended}</strong> lesson{attended === 1 ? '' : 's'} logged</span>
            {saving && <span style={{ color: 'var(--primary-blue)' }}>saving…</span>}
          </div>
        </div>

        {loadError && (
          <div style={{ padding: '0.7rem 1.5rem', fontSize: '0.78rem', color: 'var(--danger)', background: 'var(--danger-bg, rgba(239,68,68,0.08))' }}>
            Could not load progress: {loadError}
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap', background: 'var(--bg-color)' }}>
          <div className="input-group" style={{ margin: 0, flex: '1 1 200px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Search</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={16} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search student, instructor, program, day…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                style={{ paddingLeft: '2rem', width: '100%' }}
              />
            </div>
          </div>

          <div className="input-group" style={{ margin: 0, width: '150px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Level</label>
            <select value={filterLevel} onChange={(e) => { setFilterLevel(e.target.value); setPage(1); }} style={{ width: '100%' }}>
              <option value="all">All Levels</option>
              {levels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '150px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Branch</label>
            <select value={filterBranch} onChange={(e) => { setFilterBranch(e.target.value); setPage(1); }} style={{ width: '100%' }}>
              <option value="all">All Branches</option>
              {branchList.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div className="input-group" style={{ margin: 0, width: '160px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' }}>Continuation</label>
            <select value={filterContinuation} onChange={(e) => { setFilterContinuation(e.target.value); setPage(1); }} style={{ width: '100%' }}>
              <option value="all">All Answers</option>
              {CONTINUATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        <div className="panel-body table-wrapper" style={{ position: 'relative', overflowX: 'auto' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 0', color: 'var(--text-muted)' }}>
              <div className="loading-spinner" style={{ marginBottom: '1rem' }} />
              <p>Loading {category} progress…</p>
            </div>
          ) : (
            <table id="schedule-table" style={{ minWidth: '1180px' }}>
              <thead>
                <tr>
                  <th style={{ minWidth: '170px' }}>Student Name</th>
                  <th style={{ width: '140px' }}>Instructor</th>
                  <th style={{ width: '100px' }}>Day</th>
                  <th style={{ width: '130px' }}>Time</th>
                  <th style={{ width: '110px' }}>Program</th>
                  <th style={{ minWidth: category === 'Coder' ? '290px' : '250px' }}>Attendance 1–{maxLessons}</th>
                  <th style={{ minWidth: '180px' }}>Video Sent</th>
                  <th style={{ width: '160px' }}>Continuation</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                      <AlertTriangle size={32} style={{ color: 'var(--warning)', marginBottom: '0.5rem' }} />
                      <div style={{ fontWeight: 600 }}>No {category} students scheduled</div>
                      <div style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
                        Allocate a {category} student to a class and they will appear here.
                      </div>
                    </td>
                  </tr>
                ) : paged.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-muted)' }}>
                      <div style={{ fontWeight: 600 }}>No student matches your filters.</div>
                    </td>
                  </tr>
                ) : (
                  paged.map((r) => {
                    const tint = CONTINUATION_TINT[r.continuation] || CONTINUATION_TINT['Not Decide Yet'];
                    return (
                      <tr key={`${r.rowKey}||${r.classId}`}>
                        <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <User size={14} style={{ color: 'var(--text-muted)' }} />
                            {r.studentName}
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400, marginTop: '0.15rem' }}>
                            <MapPin size={10} /> {r.branchName}
                            {r.classType !== 'Regular' && ` · ${r.classType}`}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>{r.instructor}</td>
                        <td style={{ fontSize: '0.85rem' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <Calendar size={12} style={{ color: 'var(--text-muted)' }} /> {r.day}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.82rem' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <Clock size={12} style={{ color: 'var(--text-muted)' }} /> {r.time}
                          </span>
                        </td>
                        <td>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                            background: 'var(--primary-blue-light, rgba(79,70,229,0.1))',
                            color: 'var(--primary-blue, #4f46e5)',
                            padding: '0.15rem 0.5rem', borderRadius: '6px',
                            fontSize: '0.74rem', fontWeight: 600, whiteSpace: 'nowrap',
                          }}>
                            <GraduationCap size={11} /> {r.program}
                          </span>
                        </td>

                        {/* Attendance ticks. The title carries the date and note,
                            so hovering answers "when, and what happened". */}
                        <td>
                          <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                            {lessons.map((n) => {
                              const entry = r.attendance[n];
                              const done = !!entry;
                              const isOpen = editing?.rowKey === r.rowKey &&
                                editing?.classId === r.classId && editing?.lesson === n;
                              const tip = done
                                ? `Lesson ${n} · ${entry.date || 'no date'}${entry.note ? `\n${entry.note}` : '\nNo note'}`
                                : `Lesson ${n} — not recorded. Click to tick it.`;
                              return (
                                <button
                                  key={n}
                                  type="button"
                                  onClick={() => openAttendance(r, n)}
                                  title={tip}
                                  aria-label={`Lesson ${n} for ${r.studentName}${done ? ', attended' : ', not recorded'}`}
                                  aria-pressed={done}
                                  style={{
                                    position: 'relative',
                                    width: '22px', height: '22px', borderRadius: '5px',
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    cursor: 'pointer', fontSize: '0.6rem', fontWeight: 700,
                                    border: `1px solid ${isOpen ? 'var(--primary-blue)' : done ? 'rgba(5,150,105,0.8)' : 'var(--border-color)'}`,
                                    background: done ? 'rgba(5,150,105,0.16)' : 'transparent',
                                    color: done ? '#047857' : 'var(--text-muted)',
                                    outline: isOpen ? '2px solid var(--primary-blue)' : 'none',
                                    outlineOffset: '1px',
                                  }}
                                >
                                  {done ? <Check size={12} strokeWidth={3} /> : n}
                                  {/* A note is easy to miss on a tick alone. */}
                                  {done && entry.note && (
                                    <span
                                      aria-hidden="true"
                                      style={{
                                        position: 'absolute', top: '-3px', right: '-3px',
                                        width: '6px', height: '6px', borderRadius: '99px',
                                        background: '#b45309',
                                      }}
                                    />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </td>

                        {/* Video sent, one chip per level in this category. */}
                        <td>
                          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                            {levels.map((lvl) => {
                              const sent = !!r.videos[lvl];
                              return (
                                <button
                                  key={lvl}
                                  type="button"
                                  onClick={() => toggleVideo(r, lvl)}
                                  title={sent
                                    ? `${lvl} video sent — click to unmark`
                                    : `${lvl} video not sent — click to mark as sent`}
                                  aria-pressed={sent}
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                                    padding: '0.12rem 0.35rem', borderRadius: '5px', cursor: 'pointer',
                                    fontSize: '0.66rem', fontWeight: 700, whiteSpace: 'nowrap',
                                    border: `1px solid ${sent ? 'rgba(8,145,178,0.8)' : 'var(--border-color)'}`,
                                    background: sent ? 'rgba(8,145,178,0.12)' : 'transparent',
                                    color: sent ? '#0891b2' : 'var(--text-muted)',
                                  }}
                                >
                                  {sent && <Video size={9} />}
                                  {lvl}
                                </button>
                              );
                            })}
                          </div>
                        </td>

                        <td>
                          <select
                            value={r.continuation}
                            onChange={(e) => setContinuation(r, e.target.value)}
                            aria-label={`Continuation for ${r.studentName}`}
                            className="modal-select-field field-compact"
                            style={{
                              width: '100%', fontSize: '0.75rem', fontWeight: 600,
                              color: tint.color, background: tint.bg,
                            }}
                          >
                            {CONTINUATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {!loading && totalPages > 1 && (
            <Pagination currentPage={safePage} totalPages={totalPages} onPageChange={setPage} />
          )}
        </div>
      </div>

      {/* Attendance editor. A small dialog rather than an inline field, because a
          date and a free-text note do not fit inside a 22px tick. */}
      {editing && editingRow && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
          }}
        >
          <div
            ref={editorRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Lesson ${editing.lesson} for ${editingRow.studentName}`}
            style={{
              background: 'var(--panel-bg)', border: '1px solid var(--border-color)',
              borderRadius: '16px', width: '100%', maxWidth: '400px', maxHeight: '92vh',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
              animation: 'modalAppear 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <div style={{ padding: '1.1rem 1.3rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                  Lesson {editing.lesson} of {maxLessons}
                </h3>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  {editingRow.studentName} · {editingRow.program} · {editingRow.instructor}
                </p>
              </div>
              <button
                type="button"
                onClick={closeAttendance}
                aria-label="Close"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem', lineHeight: 0 }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1rem 1.3rem', display: 'flex', flexDirection: 'column', gap: '0.8rem', overflowY: 'auto' }}>
              <div>
                <label className="modal-form-label" htmlFor="attendance-date">Date attended</label>
                <input
                  id="attendance-date"
                  type="date"
                  value={draftDate}
                  onChange={(e) => setDraftDate(e.target.value)}
                  className="modal-input-field"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label className="modal-form-label" htmlFor="attendance-note">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                    <StickyNote size={12} /> Note
                  </span>
                </label>
                <textarea
                  id="attendance-note"
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  placeholder="What happened in this lesson? Shown on hover."
                  className="modal-textarea-field"
                  style={{ width: '100%', minHeight: '90px' }}
                />
              </div>
            </div>

            <div style={{ padding: '0.9rem 1.3rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '0.5rem', justifyContent: 'space-between', background: 'var(--bg-color)' }}>
              <button
                type="button"
                disabled={saving || !editingRow.attendance[editing.lesson]}
                onClick={() => saveAttendance(editingRow, editing.lesson, { clear: true })}
                title="Remove this tick"
                className="btn"
                style={{
                  border: '1px solid var(--danger-border, rgba(239,68,68,0.4))', background: 'transparent',
                  color: 'var(--danger)', borderRadius: '8px', padding: '0.45rem 0.8rem', fontSize: '0.8rem',
                  cursor: editingRow.attendance[editing.lesson] ? 'pointer' : 'not-allowed',
                  opacity: editingRow.attendance[editing.lesson] ? 1 : 0.5,
                }}
              >
                Clear tick
              </button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={closeAttendance}
                  className="btn"
                  style={{ border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: '8px', padding: '0.45rem 0.8rem', fontSize: '0.8rem', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveAttendance(editingRow, editing.lesson)}
                  className="btn btn-primary"
                  style={{ borderRadius: '8px', padding: '0.45rem 1rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  <Check size={14} /> {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
