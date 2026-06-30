'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';
import { Search, X, User, Calendar, Clock, BookOpen, MapPin, Clipboard } from 'lucide-react';

export default function StudentSearchSidebar({ isOpen, onClose }) {
  const { overallClasses, enabledBranches } = useSchedule();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('all');
  const inputRef = useRef(null);

  // Auto-focus input when sidebar opens
  useEffect(() => {
    if (isOpen) {
      // Small timeout to allow slide transition to complete
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 200);
      return () => clearTimeout(timer);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Group classes by student
  const studentGroups = useMemo(() => {
    if (!overallClasses || overallClasses.length === 0) return [];

    const groups = {};

    overallClasses.forEach((c) => {
      if (!c.student) return;
      
      // We clean and normalize the student name for grouping keys
      // to handle trailing spaces or slight case mismatches
      const nameKey = c.student.trim().toLowerCase();
      if (!nameKey) return;

      if (!groups[nameKey]) {
        groups[nameKey] = {
          canonicalName: c.student.trim(),
          classes: [],
        };
      }

      // Update canonicalName to use the one with best casing (e.g. CamelCase preferred)
      const currentName = groups[nameKey].canonicalName;
      const newName = c.student.trim();
      const currentCapitalCount = (currentName.match(/[A-Z]/g) || []).length;
      const newCapitalCount = (newName.match(/[A-Z]/g) || []).length;
      if (newCapitalCount > currentCapitalCount) {
        groups[nameKey].canonicalName = newName;
      }

      groups[nameKey].classes.push(c);
    });

    return Object.values(groups);
  }, [overallClasses]);

  // Filter grouped students based on search query and selected branch
  const filteredStudents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    
    return studentGroups
      .map((student) => {
        // Filter classes for this student by branch first
        const branchFilteredClasses = student.classes.filter((c) => {
          if (selectedBranch !== 'all' && c.branchName !== selectedBranch) {
            return false;
          }
          return true;
        });

        if (branchFilteredClasses.length === 0) return null;

        // If there's a search query, check if student name matches
        if (query) {
          const nameMatches = student.canonicalName.toLowerCase().includes(query);
          
          // Also allow searching by teacher or program in this field as a helper
          const teacherMatches = branchFilteredClasses.some(
            (c) => c.teacher && c.teacher.toLowerCase().includes(query)
          );
          const programMatches = branchFilteredClasses.some(
            (c) => (c.program && c.program.toLowerCase().includes(query)) ||
                   (c.lessonDetail && c.lessonDetail.toLowerCase().includes(query))
          );

          if (!nameMatches && !teacherMatches && !programMatches) {
            return null;
          }
        }

        return {
          ...student,
          classes: branchFilteredClasses,
        };
      })
      .filter(Boolean)
      // Sort alphabetically by student name
      .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
  }, [studentGroups, searchQuery, selectedBranch]);

  // Limit display size when no search query is typed, to maintain snappy performance
  const displayLimit = searchQuery.trim() ? filteredStudents.length : 25;
  const displayedList = filteredStudents.slice(0, displayLimit);

  // Helper to color-code programs (Kinder, Junior, Coder)
  const getProgramBadgeClass = (programName) => {
    const name = (programName || '').toLowerCase();
    if (name.includes('kinder')) return 'badge-program-kinder';
    if (name.includes('junior')) return 'badge-program-junior';
    if (name.includes('coder')) return 'badge-program-coder';
    return 'badge-program-default';
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div className="search-sidebar-backdrop" onClick={onClose} />
      )}

      {/* Sidebar Drawer */}
      <aside className={`search-sidebar ${isOpen ? 'open' : ''}`}>
        <div className="search-sidebar-header">
          <div>
            <h3>Student Finder</h3>
            <span className="subtext">Who is the teacher & when is their class?</span>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close sidebar">
            <X size={20} />
          </button>
        </div>

        <div className="search-sidebar-controls">
          <div className="search-input-wrapper">
            <Search className="search-icon" size={16} />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search student name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="sidebar-search-input"
            />
            {searchQuery && (
              <button 
                className="clear-search-btn" 
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="filter-group">
            <label htmlFor="sidebar-branch-select">Branch</label>
            <select
              id="sidebar-branch-select"
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="sidebar-select"
            >
              <option value="all">All Branches</option>
              {enabledBranches?.map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="search-sidebar-results">
          {overallClasses.length === 0 ? (
            <div className="sidebar-empty-state">
              <Clipboard size={40} className="empty-icon" />
              <p>No schedule data found.</p>
              <span className="subtext">Please sync your branch schedules to load student listings.</span>
            </div>
          ) : displayedList.length === 0 ? (
            <div className="sidebar-empty-state">
              <Search size={40} className="empty-icon" />
              <p>No students match your search.</p>
              <span className="subtext">Try refining your keyword or checking the branch filter.</span>
            </div>
          ) : (
            <div className="student-cards-list">
              <div className="results-meta">
                Showing {displayedList.length} of {filteredStudents.length} student{filteredStudents.length !== 1 ? 's' : ''}
                {!searchQuery && filteredStudents.length > displayLimit && (
                  <span className="limit-notice"> (showing first {displayLimit})</span>
                )}
              </div>

              {displayedList.map((student) => (
                <div key={student.canonicalName} className="student-result-card">
                  <div className="student-card-header">
                    <div className="student-avatar">
                      <User size={16} />
                    </div>
                    <h4>{student.canonicalName}</h4>
                  </div>
                  
                  <div className="student-card-sessions">
                    {student.classes.map((cls, idx) => (
                      <div key={idx} className="session-item">
                        {/* Teacher/Instructor Highlight (Top Priority) */}
                        <div className="teacher-badge-highlight">
                          <span className="teacher-label">Teacher:</span>
                          <span className="teacher-name">{cls.teacher || '—'}</span>
                          {cls.notArranged && (
                            <span className="not-arranged-badge">izin</span>
                          )}
                        </div>

                        {/* Session Details */}
                        <div className="session-grid">
                          <div className="session-detail-row">
                            <Calendar size={13} className="detail-icon" />
                            <span>{cls.day}</span>
                          </div>
                          
                          <div className="session-detail-row">
                            <Clock size={13} className="detail-icon" />
                            <span>{cls.time}</span>
                          </div>

                          <div className="session-detail-row full-row">
                            <BookOpen size={13} className="detail-icon" />
                            <span className={`program-tag ${getProgramBadgeClass(cls.lessonDetail || cls.program)}`}>
                              {cls.lessonDetail || cls.program}
                            </span>
                          </div>

                          <div className="session-detail-row full-row">
                            <MapPin size={13} className="detail-icon" />
                            <span className="branch-tag">{cls.branchName || '—'}</span>
                          </div>
                        </div>

                        {cls.remarks && (
                          <div className="session-remarks">
                            <strong>Note:</strong> {cls.remarks}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
