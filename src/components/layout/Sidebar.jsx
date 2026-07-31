'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import {
  Home, AlertTriangle, Calendar, Activity, Star,
  Search, FileText, PenLine, Terminal, Settings, LogOut, User, BarChart3, ClipboardList, Users, Building2, PanelLeftClose, CalendarOff,
  TrendingUp, ChevronDown, ChevronRight
} from 'lucide-react';
import { listenToMyTasks } from '@/services/taskService';

/**
 * Each navItem maps to a sidebar `roleKey` (used in the Role Permissions
 * panel) and an optional `globalKey` (the global feature toggle in
 * Admin → Internal Feature Toggles). A page is hidden if either is OFF.
 */
const navItems = [
  { id: 'home', icon: Home, label: 'Home', roleKey: 'home', globalKey: 'home' },
  { id: 'conflicts', icon: AlertTriangle, label: 'Conflict Report', roleKey: 'conflicts', globalKey: 'conflicts' },
  { id: 'availability', icon: Calendar, label: 'Slot Checker', roleKey: 'availability', globalKey: 'availability' },
  { id: 'workload', icon: BarChart3, label: 'Workload', roleKey: 'workload', globalKey: 'workload' },
  { id: 'leave', icon: Activity, label: 'Leave Management', roleKey: 'leave', globalKey: 'leave' },
  // Trial Priority page combines two global toggles — show if either is on
  { id: 'trial-priority', icon: Star, label: 'Trial Priority', roleKey: 'trial_priority',
    globalCheck: (g) => g?.trial !== false || g?.trial_overview !== false },
  { id: 'finder', icon: Search, label: 'Free Finder', roleKey: 'finder', globalKey: 'finder' },
  { id: 'student-search', icon: Search, label: 'Student Search', roleKey: 'home', globalKey: 'home' },
  { id: 'schedule', icon: FileText, label: 'Master Schedule', roleKey: 'schedule', globalKey: 'schedule' },
  { id: 'trial-input', icon: PenLine, label: 'Input Trial Leads', roleKey: 'trial_input', globalKey: 'trial_input' },
  { id: 'tasks', icon: ClipboardList, label: 'To-Do List', roleKey: 'tasks', globalKey: 'tasks' },
  { id: 'crm', icon: Users, label: 'CRM Leads', roleKey: 'crm', globalKey: 'crm' },
  { id: 'profiles', icon: User, label: 'Instructor Profiles', roleKey: 'profiles', globalKey: 'profiles' },
  { id: 'api-docs', icon: Terminal, label: 'API Documentation', roleKey: 'api_docs', globalKey: 'api_docs' },
  { id: 'admin', icon: Settings, label: 'Admin Settings', roleKey: 'admin', globalKey: 'admin' },
];

/**
 * New Operations pages that own their own nav entry. Anything not in this list
 * falls back to the Schedule view, so Schedule is the one that highlights.
 */
const NEW_OPS_PAGES = [
  'home', 'dashboard', 'operationals', 'students', 'instructors',
  'crm', 'workload', 'leave', 'trial-availability', 'activity', 'api',
  'progress-kinder', 'progress-junior', 'progress-coder',
];

/**
 * Live Progress and its three category pages.
 *
 * The parent is a disclosure, not a destination — there is no combined view, so
 * pressing it expands rather than navigating somewhere that does not exist.
 */
const LIVE_PROGRESS_PAGES = [
  { id: 'progress-kinder', label: 'Kinder Progress' },
  { id: 'progress-junior', label: 'Junior Progress' },
  { id: 'progress-coder', label: 'Coder Progress' },
];

export default function Sidebar({ currentPage, onNavigate, onToggleSearch, opsMode = 'old', setOpsMode, onToggleSidebar }) {
  const { user, logout } = useAuth();
  const { roleToggles, users, featureToggles } = useSchedule();

  const handleLogout = async () => {
    await logout();
  };

  const userEmail = user?.email?.toLowerCase() || '';
  const userRole = users?.[userEmail] || 'Instructor';
  const currentToggles = roleToggles?.[userRole] || roleToggles?.['Instructor'] || {};

  const [pendingCount, setPendingCount] = useState(0);

  const liveProgressActive = LIVE_PROGRESS_PAGES.some((p) => p.id === currentPage);
  /**
   * Whether the Live Progress group is expanded.
   *
   * Seeded from the page showing at mount, so a reload or a shared
   * /new/progress-junior link opens with the group already revealed rather than
   * hiding the active page. A lazy initialiser rather than an effect: correcting
   * this from an effect would both flash the wrong state on first paint and add
   * another set-state-in-effect error to this file.
   */
  const [liveProgressOpen, setLiveProgressOpen] = useState(() => liveProgressActive);

  // Determine the logged in user's instructor name for task queries
  const { instructorProfiles } = useSchedule();
  const myProfile = instructorProfiles?.find(p => 
    p.id === user?.email || 
    p.linkedEmail === user?.email || 
    (p.nickname && p.nickname.toLowerCase() === userEmail.split('@')[0])
  );
  const myTeacherName = myProfile?.fullname || myProfile?.nickname || userEmail.split('@')[0] || 'Unknown';

  useEffect(() => {
    if (!user) return;
    const unsubscribe = listenToMyTasks(myTeacherName, (tasks) => {
      const pending = tasks.filter(t => t.status === 'pending').length;
      setPendingCount(pending);
    });
    return () => unsubscribe();
  }, [user, myTeacherName]);

  const isItemVisible = (item) => {
    // Role-permission gate: missing key defaults to enabled
    if (item.roleKey && currentToggles[item.roleKey] === false) return false;

    // Global feature gate
    if (item.globalCheck) {
      if (!item.globalCheck(featureToggles)) return false;
    } else if (item.globalKey && featureToggles?.[item.globalKey] === false) {
      return false;
    }
    return true;
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-row">
          <div>
            <h2>The Lab Operation System</h2>
            <div className="version">SCHOOL OPERATIONS, LIVE</div>
          </div>
          {onToggleSidebar && (
            <button
              className="sidebar-collapse-btn"
              onClick={onToggleSidebar}
              title="Hide sidebar"
              aria-label="Hide sidebar"
            >
              <PanelLeftClose size={18} />
            </button>
          )}
        </div>
      </div>
      
      <div className={`operations-switcher ${opsMode === 'new' ? 'is-new' : 'is-old'}`}>
        <button 
          className={`switcher-tab ${opsMode === 'old' ? 'active' : ''}`}
          onClick={() => setOpsMode('old')}
          style={{ fontSize: '0.7rem' }}
        >
          Old Operations
        </button>
        <button 
          className={`switcher-tab ${opsMode === 'new' ? 'active' : ''}`}
          onClick={() => setOpsMode('new')}
          style={{ fontSize: '0.7rem' }}
        >
          New Operations
        </button>
      </div>

      <nav className="sidebar-nav">
        {opsMode === 'new' && (
          <>
            <button
              className={`nav-item ${currentPage === 'home' || currentPage === 'dashboard' ? 'active' : ''}`}
              onClick={() => onNavigate('home')}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Home size={20} />
                Dashboard
              </div>
            </button>
            <button
              className={`nav-item ${NEW_OPS_PAGES.includes(currentPage) ? '' : 'active'}`}
              onClick={() => onNavigate('schedule')}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Calendar size={20} />
                Schedule
              </div>
            </button>
            <button
              className={`nav-item ${currentPage === 'operationals' ? 'active' : ''}`}
              onClick={() => onNavigate('operationals')}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Building2 size={20} />
                Operationals
              </div>
            </button>
            <button
              className={`nav-item ${currentPage === 'students' ? 'active' : ''}`}
              onClick={() => onNavigate('students')}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Users size={20} />
                Students
              </div>
            </button>
            <button
              className={`nav-item ${currentPage === 'instructors' ? 'active' : ''}`}
              onClick={() => onNavigate('instructors')}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <User size={20} />
                Instructors
              </div>
            </button>
            <button
              className={`nav-item ${currentPage === 'crm' ? 'active' : ''}`}
              onClick={() => onNavigate('crm')}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Users size={20} />
                CRM Pipeline
              </div>
            </button>
            <button
              className={`nav-item ${currentPage === 'workload' ? 'active' : ''}`}
              onClick={() => onNavigate('workload')}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <BarChart3 size={20} />
                Workload
              </div>
            </button>
            <button
              className={`nav-item ${currentPage === 'leave' ? 'active' : ''}`}
              onClick={() => onNavigate('leave')}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <CalendarOff size={20} />
                Leave Management
              </div>
            </button>
            <button
              className={`nav-item ${currentPage === 'trial-availability' ? 'active' : ''}`}
              onClick={() => onNavigate('trial-availability')}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Star size={20} />
                Trial Availability
              </div>
            </button>
            <button
              className={`nav-item ${currentPage === 'activity' ? 'active' : ''}`}
              onClick={() => onNavigate('activity')}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Activity size={20} />
                Activity
              </div>
            </button>
            {/* Live Progress — a disclosure with one page per category. The
                parent expands rather than navigating, since there is no
                combined view behind it. */}
            <button
              className={`nav-item ${liveProgressActive ? 'active' : ''}`}
              onClick={() => setLiveProgressOpen((v) => !v)}
              aria-expanded={liveProgressOpen}
              title="Attendance, videos sent and continuation per category"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <TrendingUp size={20} />
                Live Progress
              </div>
              {liveProgressOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {liveProgressOpen && LIVE_PROGRESS_PAGES.map((sub) => (
              <button
                key={sub.id}
                className={`nav-item nav-subitem ${currentPage === sub.id ? 'active' : ''}`}
                onClick={() => onNavigate(sub.id)}
                style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}
              >
                <span aria-hidden="true" className="nav-subitem-dash" />
                {sub.label}
              </button>
            ))}
            <button
              className={`nav-item ${currentPage === 'api' ? 'active' : ''}`}
              onClick={() => onNavigate('api')}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Terminal size={20} />
                API
              </div>
            </button>
          </>
        )}
        {opsMode === 'old' && navItems.map((item) => {
          if (!isItemVisible(item)) return null;
          const { id, icon: Icon, label } = item;
          return (
            <button
              key={id}
              className={`nav-item ${currentPage === id ? 'active' : ''}`}
              onClick={() => {
                if (id === 'student-search') {
                  onToggleSearch();
                } else {
                  onNavigate(id);
                }
              }}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Icon size={20} />
                {label}
              </div>
              {id === 'tasks' && pendingCount > 0 && (
                <span style={{ 
                  background: 'var(--danger)', 
                  color: 'white', 
                  fontSize: '0.7rem', 
                  fontWeight: 'bold', 
                  padding: '2px 6px', 
                  borderRadius: '10px' 
                }}>
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
        <div style={{ flexGrow: 1 }} />
        <button className="nav-item logout-btn" onClick={handleLogout}>
          <LogOut size={20} />
          Logout
        </button>
      </nav>
    </aside>
  );
}
