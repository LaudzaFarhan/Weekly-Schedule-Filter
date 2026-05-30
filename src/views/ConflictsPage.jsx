'use client';

import { useState, useMemo } from 'react';
import { useSchedule } from '../contexts/ScheduleContext';
import { DAY_NAMES } from '../utils/constants';
import Badge from '../components/ui/Badge';
import Pagination from '../components/ui/Pagination';
import { CheckCircle, AlertTriangle, Users, BookOpen, ChevronDown, ChevronUp } from 'lucide-react';

const PAGE_SIZE = 5;
const LESSON_PAGE_SIZE = 8;

/* ─── Helpers ────────────────────────────────────────────── */

/** Check if a program code is a Coder lesson (exempt from overload) */
function isCoderLesson(program) {
  if (!program) return false;
  const p = program.toLowerCase().trim();
  return p.startsWith('coder') || p === 'c' || /^cb?\d/i.test(program);
}

/** Check if a program code is a Trial lesson */
function isTrialLesson(program) {
  if (!program) return false;
  return program.toLowerCase().includes('trial');
}

/** Parse lesson number from a lesson detail string like "K1.10" → 10, "JF2.5" → 5 */
function parseLessonNumber(detail) {
  if (!detail) return null;
  const m = detail.match(/\.(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

/** Check if a lesson detail is exempt (lesson 9 = Project, lesson 10 = Quiz) */
function isProjectOrQuiz(detail) {
  const num = parseLessonNumber(detail);
  return num === 9 || num === 10;
}

/** Get a human-readable category for a lesson code */
function getLessonCategory(program) {
  if (!program) return 'Unknown';
  const p = program.trim();
  if (isTrialLesson(p)) return 'Trial';
  if (isCoderLesson(p)) return 'Coder';
  if (/^KF/i.test(p)) return 'Kinder Foundation';
  if (/^K\d/i.test(p)) return 'Kinder Core';
  if (/^JF/i.test(p)) return 'Junior Foundation';
  if (/^J\d/i.test(p)) return 'Junior Core';
  return 'Other';
}

/** Color for lesson category badges */
function getCategoryColor(category) {
  switch (category) {
    case 'Kinder Foundation': return { bg: '#fef3c7', color: '#d97706' };
    case 'Kinder Core': return { bg: '#ffedd5', color: '#ea580c' };
    case 'Junior Foundation': return { bg: '#dbeafe', color: '#2563eb' };
    case 'Junior Core': return { bg: '#c7d2fe', color: '#4f46e5' };
    case 'Coder': return { bg: '#d1fae5', color: '#059669' };
    case 'Trial': return { bg: '#fce7f3', color: '#db2777' };
    default: return { bg: '#f1f5f9', color: '#64748b' };
  }
}

/**
 * Split a text into plain segments and clickable links. Detects:
 *   • Full URLs:        https://meet.google.com/abc-defg-hij
 *   • Schemeless URLs:  meet.google.com/abc-defg-hij, www.example.com
 *
 * Returns an array of { type: 'text' | 'link', value, href }.
 *
 * Used so chip text like "Puri, GS meet.google.com/eqi-nvfn-grj" renders
 * the meet link as a clickable anchor without losing the rest of the text.
 */
function linkifyText(text) {
  if (!text) return [];
  // Allow: optional scheme, then host with at least one dot, then path.
  // Stops at whitespace and common trailing punctuation.
  const URL_RE = /(https?:\/\/[^\s<>")]+|(?:www\.|meet\.|docs\.|drive\.|zoom\.us\/|forms\.gle\/)[^\s<>")]+)/gi;
  const parts = [];
  let lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, m.index) });
    }
    let raw = m[0];
    // Strip common trailing punctuation that's almost certainly not part of the URL.
    let trailing = '';
    while (/[),.;:!?]$/.test(raw)) {
      trailing = raw.slice(-1) + trailing;
      raw = raw.slice(0, -1);
    }
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    parts.push({ type: 'link', value: raw, href });
    if (trailing) parts.push({ type: 'text', value: trailing });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return parts;
}

/**
 * Render text with embedded URLs converted to clickable anchors. Stops the
 * click from bubbling so the surrounding "expand card" toggle doesn't fire
 * when the user just wants to open the meet link.
 */
function LinkifiedText({ text, color }) {
  const segments = linkifyText(text);
  if (segments.length === 0) return null;
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'link' ? (
          <a
            key={i}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              color: color || 'var(--primary-blue)',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
              wordBreak: 'break-all',
            }}
          >
            {seg.value}
          </a>
        ) : (
          <span key={i}>{seg.value}</span>
        )
      )}
    </>
  );
}

/* ─── Main Page ──────────────────────────────────────────── */

export default function ConflictsPage() {
  const { conflicts, enabledBranches, overallClasses } = useSchedule();
  const [page, setPage] = useState(1);
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterDay, setFilterDay] = useState('all');

  const filteredConflicts = useMemo(() => {
    let result = conflicts;
    if (filterBranch !== 'all') {
      result = result.filter(c => c.branches.includes(filterBranch));
    }
    if (filterDay !== 'all') {
      result = result.filter(c => c.day === filterDay);
    }
    return result;
  }, [conflicts, filterBranch, filterDay]);

  const totalPages = Math.ceil(filteredConflicts.length / PAGE_SIZE);
  const paged = filteredConflicts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const branchOptions = ['all', ...(enabledBranches || []).map(b => b.name)];

  const handlePrev = () => {
    const idx = branchOptions.indexOf(filterBranch);
    const prevIdx = idx <= 0 ? branchOptions.length - 1 : idx - 1;
    setFilterBranch(branchOptions[prevIdx]);
    setPage(1);
  };

  const handleNext = () => {
    const idx = branchOptions.indexOf(filterBranch);
    const nextIdx = idx >= branchOptions.length - 1 ? 0 : idx + 1;
    setFilterBranch(branchOptions[nextIdx]);
    setPage(1);
  };

  return (
    <section className="dashboard-view active">
      {/* Existing Conflict Report */}
      <div className="panel conflicts-panel">
        <div className="panel-header">
          <h2>Conflict Report</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-secondary, #f1f5f9)', borderRadius: '8px', padding: '0.35rem 0.6rem' }}>
              <button
                onClick={handlePrev}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '0.1rem 0.4rem', color: 'var(--primary, #3b82f6)', fontWeight: 600 }}
              >
                ‹
              </button>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: '110px', textAlign: 'center' }}>
                {filterBranch === 'all' ? 'All Branches' : filterBranch}
              </span>
              <button
                onClick={handleNext}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '0.1rem 0.4rem', color: 'var(--primary, #3b82f6)', fontWeight: 600 }}
              >
                ›
              </button>
            </div>
            <Badge variant="danger">{filteredConflicts.length} Detected</Badge>
          </div>
        </div>
        <div className="panel-body">
          {/* Day filter tabs */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <button
              onClick={() => { setFilterDay('all'); setPage(1); }}
              style={{
                padding: '0.3rem 0.7rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer',
                border: filterDay === 'all' ? '1.5px solid var(--primary, #3b82f6)' : '1px solid var(--border-color)',
                background: filterDay === 'all' ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
                fontWeight: filterDay === 'all' ? 600 : 400,
                color: filterDay === 'all' ? 'var(--primary, #3b82f6)' : 'var(--text-secondary)'
              }}
            >
              All Days
            </button>
            {DAY_NAMES.map(day => (
              <button
                key={day}
                onClick={() => { setFilterDay(day); setPage(1); }}
                style={{
                  padding: '0.3rem 0.7rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer',
                  border: filterDay === day ? '1.5px solid var(--primary, #3b82f6)' : '1px solid var(--border-color)',
                  background: filterDay === day ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
                  fontWeight: filterDay === day ? 600 : 400,
                  color: filterDay === day ? 'var(--primary, #3b82f6)' : 'var(--text-secondary)'
                }}
              >
                {day}
              </button>
            ))}
          </div>

          <div className="list-container">
            {filteredConflicts.length === 0 ? (
              <div className="empty-state">
                <CheckCircle size={40} />
                <p>No conflicts detected{filterBranch !== 'all' ? ` for ${filterBranch}` : ''}.</p>
                <span className="subtext">Sync the schedule to run analysis.</span>
              </div>
            ) : (
              paged.map((c, i) => (
                <div key={i} className="conflict-card">
                  <div className="conflict-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <strong>{c.teacher}</strong>
                      {c.branches.length > 0 && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          ({c.branches.join(', ')})
                        </span>
                      )}
                    </div>
                    <Badge variant="danger">{c.day}</Badge>
                  </div>
                  <div className="conflict-detail">
                    <span className="conflict-slot">
                      {c.slot1}
                      {c.branch1 && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '4px' }}>[{c.branch1}]</span>}
                    </span>
                    <span className="conflict-vs">⚡ overlaps with</span>
                    <span className="conflict-slot">
                      {c.slot2}
                      {c.branch2 && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '4px' }}>[{c.branch2}]</span>}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>

      {/* Lesson Load Analysis */}
      <LessonLoadPanel
        overallClasses={overallClasses}
        enabledBranches={enabledBranches}
      />
    </section>
  );
}

/* ─── Lesson Load Panel ──────────────────────────────────── */

function LessonLoadPanel({ overallClasses, enabledBranches }) {
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterDay, setFilterDay] = useState('all');
  const [page, setPage] = useState(1);
  const [expandedCards, setExpandedCards] = useState(new Set());
  const [showOnlyOverloads, setShowOnlyOverloads] = useState(false);

  const branchOptions = ['all', ...(enabledBranches || []).map(b => b.name)];

  const handlePrev = () => {
    const idx = branchOptions.indexOf(filterBranch);
    setFilterBranch(branchOptions[idx <= 0 ? branchOptions.length - 1 : idx - 1]);
    setPage(1);
  };
  const handleNext = () => {
    const idx = branchOptions.indexOf(filterBranch);
    setFilterBranch(branchOptions[idx >= branchOptions.length - 1 ? 0 : idx + 1]);
    setPage(1);
  };

  const lessonLoadData = useMemo(() => {
    let classes = overallClasses || [];
    if (filterBranch !== 'all') classes = classes.filter(c => c.branchName === filterBranch);
    if (filterDay !== 'all') classes = classes.filter(c => c.day === filterDay);

    // Group by instructor + day + time
    const groups = {};
    classes.forEach(c => {
      if (!c.teacher || c.teacher === '-') return;
      const key = `${c.teacher}|${c.day}|${c.time}`;
      if (!groups[key]) {
        groups[key] = { teacher: c.teacher, day: c.day, time: c.time, branchName: c.branchName, students: [] };
      }
      groups[key].students.push({ name: c.student, program: c.program, fullProgram: c.fullProgram, lessonDetail: c.lessonDetail || '', remarks: c.remarks || '', notArranged: !!c.notArranged });
    });

    return Object.values(groups).map(g => {
      // Group by lessonDetail (e.g. K1.10) or fall back to program (e.g. K1)
      const lessonMap = {};
      g.students.forEach(s => {
        const code = s.lessonDetail || s.program || 'Unknown';
        if (!lessonMap[code]) {
          const baseProgram = s.program || code;
          lessonMap[code] = {
            code,
            baseProgram,
            category: getLessonCategory(baseProgram),
            fullProgram: s.fullProgram || '',
            students: [],
            isCoder: isCoderLesson(baseProgram),
            isTrial: isTrialLesson(baseProgram),
            isProjectQuiz: isProjectOrQuiz(code),
            lessonNumber: parseLessonNumber(code),
          };
        }
        lessonMap[code].students.push({ name: s.name, remarks: s.remarks, notArranged: s.notArranged });
      });

      // Annotate every lesson with attendance stats. A lesson with ALL
      // students marked izin (notArranged) doesn't actually need to be
      // taught, so it shouldn't count toward the overload threshold even
      // though the row exists in the schedule.
      Object.values(lessonMap).forEach((lesson) => {
        lesson.attendingStudents = lesson.students.filter((s) => !s.notArranged).length;
        lesson.izinStudents = lesson.students.filter((s) => s.notArranged).length;
        lesson.isAllIzin = lesson.students.length > 0 && lesson.attendingStudents === 0;
      });

      // Sort: lessons with attending students first (most students first),
      // then izin-only lessons at the bottom.
      const lessons = Object.values(lessonMap).sort((a, b) => {
        if (a.isAllIzin !== b.isAllIzin) return a.isAllIzin ? 1 : -1;
        return b.students.length - a.students.length;
      });

      // Non-exempt counts only lessons that:
      //   - aren't Coder / Trial / Project / Quiz, AND
      //   - have at least one student actually attending (non-izin).
      const nonExempt = lessons.filter(
        (l) => !l.isCoder && !l.isTrial && !l.isProjectQuiz && !l.isAllIzin
      );
      const distinctNonExempt = nonExempt.length;
      const attendingStudents = g.students.filter((s) => !s.notArranged).length;
      const izinStudents = g.students.filter((s) => s.notArranged).length;
      const isOverloaded = distinctNonExempt >= 3;

      return {
        ...g,
        lessons,
        distinctNonExempt,
        totalStudents: g.students.length,
        attendingStudents,
        izinStudents,
        isOverloaded,
      };
    })
    .filter(g => !showOnlyOverloads || g.isOverloaded)
    .sort((a, b) => {
      // Primary: chronological time (parse "10.00-11.30am" → minutes since midnight)
      const parseTime = (t) => {
        if (!t) return 0;
        const start = t.split('-')[0].trim().toLowerCase();
        const m = start.match(/^(\d{1,2})[.:](\d{2})\s*(am|pm)?$/);
        if (!m) return 0;
        let h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        const ampm = m[3] || (t.toLowerCase().includes('pm') ? 'pm' : 'am');
        if (ampm === 'pm' && h < 12) h += 12;
        if (ampm === 'am' && h === 12) h = 0;
        return h * 60 + min;
      };
      const timeCmp = parseTime(a.time) - parseTime(b.time);
      if (timeCmp !== 0) return timeCmp;
      // Secondary: instructor name alphabetically
      return a.teacher.localeCompare(b.teacher);
    });
  }, [overallClasses, filterBranch, filterDay, showOnlyOverloads]);

  const overloadCount = useMemo(() => lessonLoadData.filter(g => g.isOverloaded).length, [lessonLoadData]);
  const totalPages = Math.ceil(lessonLoadData.length / LESSON_PAGE_SIZE);
  const paged = lessonLoadData.slice((page - 1) * LESSON_PAGE_SIZE, page * LESSON_PAGE_SIZE);

  const toggleCard = (idx) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  return (
    <div className="panel" style={{ marginTop: '1.5rem' }}>
      <div className="panel-header">
        <div className="panel-header-left">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <BookOpen size={18} /> Lesson Load Analysis
          </h2>
          <span className="subtext">Instructor lesson assignments per time slot</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Branch carousel */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-secondary, #f1f5f9)', borderRadius: '8px', padding: '0.35rem 0.6rem' }}>
            <button onClick={handlePrev} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '0.1rem 0.4rem', color: 'var(--primary, #3b82f6)', fontWeight: 600 }}>‹</button>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: '110px', textAlign: 'center' }}>
              {filterBranch === 'all' ? 'All Branches' : filterBranch}
            </span>
            <button onClick={handleNext} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '0.1rem 0.4rem', color: 'var(--primary, #3b82f6)', fontWeight: 600 }}>›</button>
          </div>
          {overloadCount > 0 && <Badge variant="warning">{overloadCount} Overloaded</Badge>}
          <Badge variant="neutral">{lessonLoadData.length} Slots</Badge>
        </div>
      </div>
      <div className="panel-body">
        {/* Filters row */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {['all', ...DAY_NAMES].map(day => (
              <button
                key={day}
                onClick={() => { setFilterDay(day); setPage(1); }}
                style={{
                  padding: '0.3rem 0.7rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer',
                  border: filterDay === day ? '1.5px solid var(--primary, #3b82f6)' : '1px solid var(--border-color)',
                  background: filterDay === day ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
                  fontWeight: filterDay === day ? 600 : 400,
                  color: filterDay === day ? 'var(--primary, #3b82f6)' : 'var(--text-secondary)'
                }}
              >
                {day === 'all' ? 'All Days' : day}
              </button>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showOnlyOverloads}
              onChange={(e) => { setShowOnlyOverloads(e.target.checked); setPage(1); }}
              style={{ cursor: 'pointer' }}
            />
            Show overloads only
          </label>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1.25rem', padding: '0.65rem 1rem', background: 'var(--bg-color)', borderRadius: '8px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          <span><strong style={{ color: 'var(--success)' }}>●</strong> 1–2 lessons = OK</span>
          <span><strong style={{ color: 'var(--danger)' }}>●</strong> 3+ lessons = Lesson Overload</span>
          <span style={{ opacity: 0.7 }}>Coder & Trial = exempt</span>
          <span style={{ opacity: 0.7 }}>Lesson 9 (Project) & 10 (Quiz) = exempt</span>
          <span style={{ marginLeft: 'auto', opacity: 0.7 }}>All-izin lessons = exempt</span>
        </div>

        {/* Cards */}
        <div className="list-container">
          {(overallClasses || []).length === 0 ? (
            <div className="empty-state">
              <BookOpen size={40} />
              <p>Sync the schedule to analyze lesson loads.</p>
            </div>
          ) : lessonLoadData.length === 0 ? (
            <div className="empty-state">
              <CheckCircle size={40} />
              <p>No lesson slots found{filterBranch !== 'all' ? ` for ${filterBranch}` : ''}.</p>
            </div>
          ) : (
            paged.map((slot, i) => {
              const actualIdx = (page - 1) * LESSON_PAGE_SIZE + i;
              const isExpanded = expandedCards.has(actualIdx);
              return (
                <div
                  key={actualIdx}
                  className="lesson-load-card"
                  style={{
                    padding: '1rem 1.25rem',
                    borderRadius: '10px',
                    border: `1px solid ${slot.isOverloaded ? 'var(--danger-border)' : 'var(--border-color)'}`,
                    background: slot.isOverloaded ? 'var(--danger-bg)' : 'var(--panel-bg)',
                    transition: 'transform 0.2s',
                  }}
                >
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <strong style={{ fontSize: '0.95rem' }}>{slot.teacher}</strong>
                      {slot.branchName && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'var(--bg-color)', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>
                          {slot.branchName}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Badge variant={slot.isOverloaded ? 'danger' : 'success'}>
                        {slot.isOverloaded ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <AlertTriangle size={12} /> Lesson Overload
                          </span>
                        ) : 'OK'}
                      </Badge>
                      <Badge variant="neutral">{slot.day}</Badge>
                    </div>
                  </div>

                  {/* Time + student summary */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.6rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    <span>🕐 {slot.time}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }} title={slot.izinStudents > 0 ? `${slot.izinStudents} student${slot.izinStudents === 1 ? '' : 's'} izin (not attending)` : undefined}>
                      <Users size={13} /> {slot.attendingStudents} attending
                      {slot.izinStudents > 0 && (
                        <span style={{ color: 'var(--text-muted)' }}>
                          {' '}/ {slot.totalStudents} total · {slot.izinStudents} izin
                        </span>
                      )}
                    </span>
                    <span>{slot.distinctNonExempt} distinct lesson{slot.distinctNonExempt !== 1 ? 's' : ''} (non-exempt)</span>
                  </div>

                  {/* Lesson chips */}
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {slot.lessons.map((lesson, li) => {
                      const cat = getCategoryColor(lesson.category);
                      const isExempt = lesson.isCoder || lesson.isTrial || lesson.isProjectQuiz || lesson.isAllIzin;
                      const chipTitle = lesson.isAllIzin
                        ? `All ${lesson.students.length} student${lesson.students.length === 1 ? '' : 's'} izin — does not count toward overload.`
                        : (lesson.fullProgram ? `${lesson.category} — ${lesson.fullProgram}` : lesson.category);
                      return (
                        <span
                          key={li}
                          title={chipTitle}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                            padding: '0.25rem 0.65rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600,
                            background: cat.bg, color: cat.color,
                            border: isExempt ? '1px dashed' : 'none',
                            opacity: isExempt ? 0.65 : 1,
                            textDecoration: lesson.isAllIzin ? 'line-through' : 'none',
                          }}
                        >
                          {lesson.code}
                          {lesson.fullProgram && (
                            <span style={{ fontWeight: 400, fontSize: '0.7rem', opacity: 0.7 }}>
                              <LinkifiedText text={lesson.fullProgram} color={cat.color} />
                            </span>
                          )}
                          <span style={{ fontWeight: 400, opacity: 0.8 }}>
                            (
                            {lesson.attendingStudents} attending
                            {lesson.izinStudents > 0 && `, ${lesson.izinStudents} izin`}
                            )
                          </span>
                        </span>
                      );
                    })}
                  </div>

                  {/* Expandable student details */}
                  <button
                    onClick={() => toggleCard(actualIdx)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem',
                      color: 'var(--primary, #3b82f6)', fontWeight: 500, marginTop: '0.5rem',
                      display: 'flex', alignItems: 'center', gap: '0.3rem', padding: 0,
                    }}
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {isExpanded ? 'Hide' : 'Show'} student details
                  </button>

                  {isExpanded && (
                    <div style={{ marginTop: '0.6rem', padding: '0.75rem', background: 'white', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      {slot.lessons.map((lesson, li) => (
                        <div key={li} style={{ marginBottom: li < slot.lessons.length - 1 ? '0.6rem' : 0 }}>
                          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span>{lesson.code}</span>
                            {lesson.fullProgram && (
                              <span style={{ fontWeight: 400, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                (<LinkifiedText text={lesson.fullProgram} />)
                              </span>
                            )}
                            <span style={{ fontWeight: 400, fontSize: '0.72rem', color: 'var(--text-muted)' }}>— {lesson.category}</span>
                            {(lesson.isCoder || lesson.isTrial || lesson.isProjectQuiz || lesson.isAllIzin) && (
                              <span style={{ fontSize: '0.68rem', color: 'var(--warning)', fontWeight: 500, background: 'var(--warning-bg)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                {lesson.isProjectQuiz
                                  ? (lesson.lessonNumber === 9 ? 'Project' : 'Quiz')
                                  : lesson.isAllIzin
                                    ? 'all izin'
                                    : 'exempt'}
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                            {lesson.students.map((s, si) => (
                              <span key={si} style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', background: s.notArranged ? '#fef3c7' : 'var(--bg-color)', borderRadius: '4px', color: s.notArranged ? '#92400e' : 'var(--text-secondary)', border: s.notArranged ? '1px dashed #f59e0b' : 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                {s.name}
                                {s.notArranged && (
                                  <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#d97706', background: '#fde68a', padding: '0.05rem 0.3rem', borderRadius: '3px' }}>izin</span>
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </div>
  );
}
