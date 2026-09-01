'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSchedule, DEFAULT_SIDEBAR_ORDER, DEFAULT_SIDEBAR_SUB_ORDER } from '@/contexts/ScheduleContext';
import {
  Home, AlertTriangle, Calendar, Activity, Star, Video,
  Search, FileText, PenLine, Terminal, Settings, LogOut, User, BarChart3, ClipboardList, Users, Building2, PanelLeftClose, CalendarOff,
  TrendingUp, ChevronDown, ChevronRight, ShieldCheck, Bug,
  Sliders, ArrowUp, ArrowDown, RotateCcw, Check, GripVertical
} from 'lucide-react';
import { listenToMyTasks } from '@/services/taskService';
import { subscribeToQaBugs } from '@/services/qaTrackerService';
import { resolveUserRole, canAccessPage, isAdmin } from '@/utils/roles';

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
  { id: 'qa-tracker', icon: Bug, label: 'QA & Bug Tracker', roleKey: 'qa-tracker', globalKey: 'qa_tracker' },
  { id: 'admin', icon: Settings, label: 'Admin Settings', roleKey: 'admin', globalKey: 'admin' },
];

/**
 * New Operations pages that own their own nav entry. Anything not in this list
 * falls back to the Schedule view, so Schedule is the one that highlights.
 */
const NEW_OPS_PAGES = [
  'home', 'dashboard', 'operationals', 'students', 'student-subscriptions', 'report-cards', 'report-cards-list', 'report-cards-rubric', 'instructors',
  'crm', 'workload', 'leave', 'trial-availability', 'activity', 'users', 'api', 'qa-tracker',
  'progress-kinder', 'progress-junior', 'progress-coder',
];

const SCHEDULE_PAGES = [
  { id: 'schedule', label: 'Main' },
  { id: 'workload', label: 'Workload' },
  { id: 'leave', label: 'Leave Management' },
  { id: 'trial-availability', label: 'Trial Availability' },
];

const STUDENT_PAGES = [
  { id: 'students', label: 'Student Database' },
  { id: 'student-subscriptions', label: 'Subscription Management' },
];

/**
 * Report Cards and its pages.
 *
 * The parent is a destination: clicking it goes to Evaluate, which is the main screen.
 * Sub-sidebar pages include Evaluate, Report List, and Rubrics and Setup.
 */
const REPORT_CARD_PAGES = [
  { id: 'report-cards', label: 'Evaluate' },
  { id: 'report-cards-list', label: 'Report List' },
  { id: 'report-cards-rubric', label: 'Rubrics and Setup' },
];

const LIVE_PROGRESS_PAGES = [
  { id: 'progress-kinder', label: 'Kinder Progress' },
  { id: 'progress-junior', label: 'Junior Progress' },
  { id: 'progress-coder', label: 'Coder Progress' },
];

export const SUB_ITEM_DEFINITIONS = {
  schedule: SCHEDULE_PAGES,
  students: STUDENT_PAGES,
  'report-cards': REPORT_CARD_PAGES,
  'live-progress': LIVE_PROGRESS_PAGES,
};

export function getEffectiveSubItems(parentId, defaultList = [], subOrderMap = {}) {
  const customOrder = subOrderMap?.[parentId];
  if (!Array.isArray(customOrder) || customOrder.length === 0) {
    return defaultList;
  }
  const ordered = [];
  const map = new Map(defaultList.map((item) => [item.id, item]));

  for (const id of customOrder) {
    if (map.has(id)) {
      ordered.push(map.get(id));
      map.delete(id);
    }
  }
  for (const item of map.values()) {
    ordered.push(item);
  }
  return ordered;
}

const NAV_ITEM_DEFINITIONS = {
  dashboard: {
    id: 'dashboard',
    label: 'Dashboard',
    icon: Home,
    checkAccess: (canAccess) => canAccess('dashboard'),
    render: ({ currentPage, onNavigate }) => (
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
    ),
  },
  schedule: {
    id: 'schedule',
    label: 'Schedule',
    icon: Calendar,
    checkAccess: (canAccess) => (canAccess('schedule') || canAccess('workload') || canAccess('leave') || canAccess('trial-availability')),
    render: ({ currentPage, onNavigate, canAccess, schedulePagesActive, scheduleOpen, setScheduleOpen, sidebarSubOrder }) => {
      const orderedSubItems = getEffectiveSubItems('schedule', SCHEDULE_PAGES, sidebarSubOrder);
      return (
        <>
          <button
            data-tour="nav-schedule"
            className={`nav-item ${schedulePagesActive ? 'active' : ''}`}
            onClick={() => { setScheduleOpen(true); onNavigate('schedule'); }}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Calendar size={20} />
              Schedule
            </div>
            <span
              role="button"
              tabIndex={0}
              aria-label={scheduleOpen ? 'Collapse Schedule' : 'Expand Schedule'}
              aria-expanded={scheduleOpen}
              onClick={(e) => { e.stopPropagation(); setScheduleOpen((v) => !v); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault(); e.stopPropagation(); setScheduleOpen((v) => !v);
                }
              }}
              style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
            >
              {scheduleOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </span>
          </button>
          {scheduleOpen && orderedSubItems.filter(sub => canAccess(sub.id)).map((sub) => {
            const isSubActive = sub.id === 'schedule'
              ? (currentPage === 'schedule' || !NEW_OPS_PAGES.includes(currentPage))
              : currentPage === sub.id;
            return (
              <button
                key={sub.id}
                className={`nav-item nav-subitem ${isSubActive ? 'active' : ''}`}
                onClick={() => onNavigate(sub.id)}
                style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}
              >
                <span aria-hidden="true" className="nav-subitem-dash" />
                {sub.label}
              </button>
            );
          })}
        </>
      );
    },
  },
  operationals: {
    id: 'operationals',
    label: 'Operationals',
    icon: Building2,
    checkAccess: (canAccess) => canAccess('operationals'),
    render: ({ currentPage, onNavigate }) => (
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
    ),
  },
  students: {
    id: 'students',
    label: 'Students',
    icon: Users,
    checkAccess: (canAccess) => canAccess('students'),
    render: ({ currentPage, onNavigate, studentPagesActive, studentsOpen, setStudentsOpen, sidebarSubOrder }) => {
      const orderedSubItems = getEffectiveSubItems('students', STUDENT_PAGES, sidebarSubOrder);
      return (
        <>
          <button
            data-tour="nav-students"
            className={`nav-item ${studentPagesActive ? 'active' : ''}`}
            onClick={() => { setStudentsOpen(true); onNavigate('students'); }}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Users size={20} />
              Students
            </div>
            <span
              role="button"
              tabIndex={0}
              aria-label={studentsOpen ? 'Collapse Students' : 'Expand Students'}
              aria-expanded={studentsOpen}
              onClick={(e) => { e.stopPropagation(); setStudentsOpen((v) => !v); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault(); e.stopPropagation(); setStudentsOpen((v) => !v);
                }
              }}
              style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
            >
              {studentsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </span>
          </button>
          {studentsOpen && orderedSubItems.map((sub) => (
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
        </>
      );
    },
  },
  'report-cards': {
    id: 'report-cards',
    label: 'Report Cards',
    icon: ClipboardList,
    checkAccess: (canAccess) => canAccess('report-cards'),
    render: ({ currentPage, onNavigate, reportCardsActive, reportCardsOpen, setReportCardsOpen, sidebarSubOrder }) => {
      const orderedSubItems = getEffectiveSubItems('report-cards', REPORT_CARD_PAGES, sidebarSubOrder);
      return (
        <>
          <button
            className={`nav-item ${reportCardsActive ? 'active' : ''}`}
            onClick={() => { setReportCardsOpen(true); onNavigate('report-cards'); }}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <ClipboardList size={20} />
              Report Cards
            </div>
            <span
              role="button"
              tabIndex={0}
              aria-label={reportCardsOpen ? 'Collapse Report Cards' : 'Expand Report Cards'}
              aria-expanded={reportCardsOpen}
              onClick={(e) => { e.stopPropagation(); setReportCardsOpen((v) => !v); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault(); e.stopPropagation(); setReportCardsOpen((v) => !v);
                }
              }}
              style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
            >
              {reportCardsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </span>
          </button>
          {reportCardsOpen && orderedSubItems.map((sub) => (
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
        </>
      );
    },
  },
  instructors: {
    id: 'instructors',
    label: 'Instructors',
    icon: User,
    checkAccess: (canAccess) => canAccess('instructors'),
    render: ({ currentPage, onNavigate }) => (
      <button
        data-tour="nav-instructors"
        className={`nav-item ${currentPage === 'instructors' ? 'active' : ''}`}
        onClick={() => onNavigate('instructors')}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <User size={20} />
          Instructors
        </div>
      </button>
    ),
  },
  crm: {
    id: 'crm',
    label: 'CRM Pipeline',
    icon: Users,
    checkAccess: (canAccess) => canAccess('crm'),
    render: ({ currentPage, onNavigate }) => (
      <button
        data-tour="nav-crm"
        className={`nav-item ${currentPage === 'crm' ? 'active' : ''}`}
        onClick={() => onNavigate('crm')}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Users size={20} />
          CRM Pipeline
        </div>
      </button>
    ),
  },
  meetings: {
    id: 'meetings',
    label: 'Meetings',
    icon: Video,
    checkAccess: (canAccess) => canAccess('meetings'),
    render: ({ currentPage, onNavigate }) => (
      <button
        className={`nav-item ${currentPage === 'meetings' ? 'active' : ''}`}
        onClick={() => onNavigate('meetings')}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Video size={20} />
          Meetings
        </div>
      </button>
    ),
  },
  activity: {
    id: 'activity',
    label: 'Activity',
    icon: Activity,
    checkAccess: (canAccess) => canAccess('activity'),
    render: ({ currentPage, onNavigate }) => (
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
    ),
  },
  'live-progress': {
    id: 'live-progress',
    label: 'Live Progress',
    icon: TrendingUp,
    checkAccess: (canAccess) => canAccess('live-progress'),
    render: ({ currentPage, onNavigate, liveProgressActive, liveProgressOpen, setLiveProgressOpen, sidebarSubOrder }) => {
      const orderedSubItems = getEffectiveSubItems('live-progress', LIVE_PROGRESS_PAGES, sidebarSubOrder);
      return (
        <>
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
          {liveProgressOpen && orderedSubItems.map((sub) => (
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
        </>
      );
    },
  },
  users: {
    id: 'users',
    label: 'Users',
    icon: ShieldCheck,
    checkAccess: (canAccess) => canAccess('users'),
    render: ({ currentPage, onNavigate }) => (
      <button
        data-tour="nav-users"
        className={`nav-item ${currentPage === 'users' ? 'active' : ''}`}
        onClick={() => onNavigate('users')}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <ShieldCheck size={20} />
          Users
        </div>
      </button>
    ),
  },
  api: {
    id: 'api',
    label: 'API',
    icon: Terminal,
    checkAccess: (canAccess) => canAccess('api'),
    render: ({ currentPage, onNavigate }) => (
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
    ),
  },
  'qa-tracker': {
    id: 'qa-tracker',
    label: 'QA Tracker',
    icon: Bug,
    checkAccess: (canAccess) => canAccess('qa-tracker'),
    render: ({ currentPage, onNavigate, openBugCount = 0 }) => (
      <button
        className={`nav-item ${currentPage === 'qa-tracker' ? 'active' : ''}`}
        onClick={() => onNavigate('qa-tracker')}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Bug size={20} />
          QA Tracker
        </div>
        {openBugCount > 0 && (
          <span
            style={{
              background: '#ef4444',
              color: '#ffffff',
              fontSize: '0.66rem',
              fontWeight: 700,
              padding: '0.1rem 0.45rem',
              borderRadius: '999px',
              lineHeight: 1.2,
              boxShadow: '0 0 8px rgba(239, 68, 68, 0.4)',
            }}
            title={`${openBugCount} unresolved bug${openBugCount === 1 ? '' : 's'} / QA issue${openBugCount === 1 ? '' : 's'}`}
          >
            {openBugCount}
          </span>
        )}
      </button>
    ),
  },
};

/**
 * `sunsetBadge` is the `badge` string from the sunset notice model — decoration
 * on the Old Operations tab, never a control. Anything that is not a non-empty
 * string renders no badge at all, so a failed config read or a missing model
 * leaves the tab exactly as it was rather than printing `undefined`.
 */
export default function Sidebar({ currentPage, onNavigate, onToggleSearch, opsMode = 'old', setOpsMode, onToggleSidebar, sidebarCollapsed, sunsetBadge }) {
  const { user, logout } = useAuth();
  const {
    roleToggles, users, featureToggles, rolePermissions, userPermissions,
    sidebarOrder, updateSidebarOrder,
    sidebarSubOrder, updateSidebarSubOrder,
  } = useSchedule();

  const handleLogout = async () => {
    await logout();
  };

  const userEmail = user?.email?.toLowerCase() || user?.username?.toLowerCase() || '';
  const userRole = resolveUserRole(users, userEmail, user);
  const isSuperAdmin = isAdmin(users, userEmail, user) || userRole === 'Admin';
  const canAccess = (pageId) => canAccessPage(userRole, pageId, rolePermissions, userPermissions, userEmail);

  const [pendingCount, setPendingCount] = useState(0);
  const [openBugCount, setOpenBugCount] = useState(0);

  useEffect(() => {
    const unsub = subscribeToQaBugs(
      ({ totalBugs }) => {
        setOpenBugCount(totalBugs);
      },
      () => {}
    );
    return () => unsub();
  }, []);

  const schedulePagesActive = SCHEDULE_PAGES.some((p) => p.id === currentPage) || !NEW_OPS_PAGES.includes(currentPage);
  const [scheduleOpen, setScheduleOpen] = useState(() => schedulePagesActive);

  const liveProgressActive = LIVE_PROGRESS_PAGES.some((p) => p.id === currentPage);
  const [liveProgressOpen, setLiveProgressOpen] = useState(() => liveProgressActive);

  const studentPagesActive = STUDENT_PAGES.some((p) => p.id === currentPage) || currentPage === 'students';
  const [studentsOpen, setStudentsOpen] = useState(() => studentPagesActive);

  const reportCardsActive = REPORT_CARD_PAGES.some((p) => p.id === currentPage);
  const [reportCardsOpen, setReportCardsOpen] = useState(() => reportCardsActive);

  // Reorder customization state for Admin
  const [isReordering, setIsReordering] = useState(false);
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [dragOverItemId, setDragOverItemId] = useState(null);
  const [draggedSubItem, setDraggedSubItem] = useState(null);
  const [dragOverSubItem, setDragOverSubItem] = useState(null);

  // Compute effective ordered items
  const effectiveOrder = useMemo(() => {
    const order = Array.isArray(sidebarOrder) && sidebarOrder.length > 0 ? sidebarOrder : DEFAULT_SIDEBAR_ORDER;
    const combined = [...order];
    for (const defId of DEFAULT_SIDEBAR_ORDER) {
      if (!combined.includes(defId)) combined.push(defId);
    }
    return combined.filter((id) => !!NAV_ITEM_DEFINITIONS[id]);
  }, [sidebarOrder]);

  const handleMoveItem = async (itemId, direction) => {
    const currentIndex = effectiveOrder.indexOf(itemId);
    if (currentIndex === -1) return;
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= effectiveOrder.length) return;

    const newOrder = [...effectiveOrder];
    const [moved] = newOrder.splice(currentIndex, 1);
    newOrder.splice(newIndex, 0, moved);
    if (updateSidebarOrder) {
      await updateSidebarOrder(newOrder);
    }
  };

  const handleMoveSubItem = async (parentId, subItemId, direction) => {
    const defaultList = SUB_ITEM_DEFINITIONS[parentId] || [];
    const currentSubItems = getEffectiveSubItems(parentId, defaultList, sidebarSubOrder);
    const currentIds = currentSubItems.map((s) => s.id);
    const currentIndex = currentIds.indexOf(subItemId);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= currentIds.length) return;

    const newIds = [...currentIds];
    const [moved] = newIds.splice(currentIndex, 1);
    newIds.splice(newIndex, 0, moved);

    const newSubOrder = {
      ...(sidebarSubOrder || {}),
      [parentId]: newIds,
    };
    if (updateSidebarSubOrder) {
      await updateSidebarSubOrder(newSubOrder);
    }
  };

  const handleDragStart = (e, itemId) => {
    if (!isSuperAdmin) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemId);
    setDraggedItemId(itemId);
  };

  const handleDragOver = (e, itemId) => {
    if (!isSuperAdmin) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverItemId !== itemId) {
      setDragOverItemId(itemId);
    }
  };

  const handleDrop = async (e, targetItemId) => {
    if (!isSuperAdmin) return;
    e.preventDefault();
    const sourceItemId = e.dataTransfer.getData('text/plain') || draggedItemId;
    setDraggedItemId(null);
    setDragOverItemId(null);

    if (!sourceItemId || sourceItemId === targetItemId) return;
    const sourceIndex = effectiveOrder.indexOf(sourceItemId);
    const targetIndex = effectiveOrder.indexOf(targetItemId);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const newOrder = [...effectiveOrder];
    const [moved] = newOrder.splice(sourceIndex, 1);
    newOrder.splice(targetIndex, 0, moved);
    if (updateSidebarOrder) {
      await updateSidebarOrder(newOrder);
    }
  };

  const handleSubDragStart = (e, parentId, subItemId) => {
    if (!isSuperAdmin) return;
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({ parentId, subItemId, type: 'sub' }));
    setDraggedSubItem({ parentId, subItemId });
  };

  const handleSubDragOver = (e, parentId, subItemId) => {
    if (!isSuperAdmin) return;
    e.stopPropagation();
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragOverSubItem || dragOverSubItem.parentId !== parentId || dragOverSubItem.subItemId !== subItemId) {
      setDragOverSubItem({ parentId, subItemId });
    }
  };

  const handleSubDrop = async (e, targetParentId, targetSubItemId) => {
    if (!isSuperAdmin) return;
    e.stopPropagation();
    e.preventDefault();

    let dragData = draggedSubItem;
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (raw) dragData = JSON.parse(raw);
    } catch {}

    setDraggedSubItem(null);
    setDragOverSubItem(null);

    if (!dragData || (dragData.type !== 'sub' && !dragData.parentId)) return;
    if (dragData.parentId !== targetParentId || dragData.subItemId === targetSubItemId) return;

    const defaultList = SUB_ITEM_DEFINITIONS[targetParentId] || [];
    const currentSubItems = getEffectiveSubItems(targetParentId, defaultList, sidebarSubOrder);
    const currentIds = currentSubItems.map((s) => s.id);
    const sourceIndex = currentIds.indexOf(dragData.subItemId);
    const targetIndex = currentIds.indexOf(targetSubItemId);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const newIds = [...currentIds];
    const [moved] = newIds.splice(sourceIndex, 1);
    newIds.splice(targetIndex, 0, moved);

    const newSubOrder = {
      ...(sidebarSubOrder || {}),
      [targetParentId]: newIds,
    };
    if (updateSidebarSubOrder) {
      await updateSidebarSubOrder(newSubOrder);
    }
  };

  const handleResetOrder = async () => {
    if (updateSidebarOrder) {
      await updateSidebarOrder(DEFAULT_SIDEBAR_ORDER);
    }
    if (updateSidebarSubOrder) {
      await updateSidebarSubOrder(DEFAULT_SIDEBAR_SUB_ORDER);
    }
  };

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

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-header-row">
          <div>
            <h2>The Lab Operation System</h2>
            <div className="version">SCHOOL OPERATIONS, LIVE</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            {isSuperAdmin && (
              <button
                className="sidebar-collapse-btn"
                onClick={() => setIsReordering((v) => !v)}
                title={isReordering ? 'Close Reorder Mode' : 'Customize Sidebar Menu Position'}
                aria-label="Customize Sidebar Menu Position"
                style={{
                  background: isReordering ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                  color: isReordering ? '#a5b4fc' : undefined,
                  border: isReordering ? '1px solid rgba(129, 140, 248, 0.4)' : '1px solid transparent',
                  padding: '4px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                <Sliders size={16} />
              </button>
            )}
            {onToggleSidebar && (
              <button
                data-tour="sidebar-toggle"
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
      </div>

      <nav data-tour="sidebar-nav" className="sidebar-nav">
        {isReordering ? (
          /* ─── Dedicated Admin Reordering Mode ─── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.25rem 0' }}>
            <div
              style={{
                margin: '0.25rem 0.5rem 0.5rem',
                padding: '0.5rem 0.65rem',
                borderRadius: '8px',
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(129, 140, 248, 0.3)',
                color: '#e0e7ff',
                fontSize: '0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.2rem',
              }}
            >
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Sliders size={14} /> Reorder Sidebar Menu
              </div>
              <div style={{ opacity: 0.8, fontSize: '0.7rem' }}>
                Move items with arrows or drag & drop. Persists for all users.
              </div>
            </div>

            {effectiveOrder.map((itemId, idx) => {
              const def = NAV_ITEM_DEFINITIONS[itemId];
              if (!def) return null;
              const IconComp = def.icon;
              const isFirst = idx === 0;
              const isLast = idx === effectiveOrder.length - 1;
              const isOver = dragOverItemId === itemId;
              const hasSubItems = Boolean(SUB_ITEM_DEFINITIONS[itemId]);
              const subItems = hasSubItems ? getEffectiveSubItems(itemId, SUB_ITEM_DEFINITIONS[itemId], sidebarSubOrder) : [];

              return (
                <div key={itemId} style={{ display: 'flex', flexDirection: 'column' }}>
                  <div
                    draggable
                    onDragStart={(e) => handleDragStart(e, itemId)}
                    onDragOver={(e) => handleDragOver(e, itemId)}
                    onDrop={(e) => handleDrop(e, itemId)}
                    onDragEnd={() => { setDraggedItemId(null); setDragOverItemId(null); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.45rem 0.65rem',
                      margin: '0.15rem 0.5rem',
                      borderRadius: '6px',
                      background: isOver ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.04)',
                      border: isOver ? '1px dashed #818cf8' : '1px solid rgba(255, 255, 255, 0.08)',
                      cursor: 'grab',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f1f5f9', fontSize: '0.85rem' }}>
                      <GripVertical size={14} style={{ opacity: 0.5, cursor: 'grab' }} />
                      <IconComp size={16} style={{ opacity: 0.85 }} />
                      <span style={{ fontWeight: 500 }}>{def.label}</span>
                      {hasSubItems && (
                        <span style={{ fontSize: '0.65rem', color: '#818cf8', opacity: 0.8, fontWeight: 400 }}>
                          ({subItems.length} sub)
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                      <button
                        type="button"
                        disabled={isFirst}
                        onClick={() => handleMoveItem(itemId, 'up')}
                        title="Move Up"
                        aria-label={`Move ${def.label} Up`}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: isFirst ? 'rgba(255,255,255,0.2)' : '#cbd5e1',
                          cursor: isFirst ? 'default' : 'pointer',
                          padding: '3px 4px',
                          borderRadius: '4px',
                          display: 'inline-flex',
                        }}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={isLast}
                        onClick={() => handleMoveItem(itemId, 'down')}
                        title="Move Down"
                        aria-label={`Move ${def.label} Down`}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: isLast ? 'rgba(255,255,255,0.2)' : '#cbd5e1',
                          cursor: isLast ? 'default' : 'pointer',
                          padding: '3px 4px',
                          borderRadius: '4px',
                          display: 'inline-flex',
                        }}
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Sub-sidebar nested reordering */}
                  {hasSubItems && (
                    <div
                      style={{
                        marginLeft: '1.5rem',
                        marginRight: '0.5rem',
                        marginTop: '0.1rem',
                        marginBottom: '0.35rem',
                        padding: '0.25rem 0.35rem',
                        borderRadius: '6px',
                        background: 'rgba(0, 0, 0, 0.25)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.2rem',
                      }}
                    >
                      <div style={{ fontSize: '0.64rem', color: '#94a3b8', padding: '0.1rem 0.3rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>Sub-sidebar items</span>
                        <span style={{ fontSize: '0.6rem', color: '#6366f1' }}>drag & drop / arrows</span>
                      </div>
                      {subItems.map((subItem, sIdx) => {
                        const isSubFirst = sIdx === 0;
                        const isSubLast = sIdx === subItems.length - 1;
                        const isSubOver = dragOverSubItem?.parentId === itemId && dragOverSubItem?.subItemId === subItem.id;
                        return (
                          <div
                            key={subItem.id}
                            draggable
                            onDragStart={(e) => handleSubDragStart(e, itemId, subItem.id)}
                            onDragOver={(e) => handleSubDragOver(e, itemId, subItem.id)}
                            onDrop={(e) => handleSubDrop(e, itemId, subItem.id)}
                            onDragEnd={() => { setDraggedSubItem(null); setDragOverSubItem(null); }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0.3rem 0.45rem',
                              borderRadius: '4px',
                              background: isSubOver ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.03)',
                              border: isSubOver ? '1px dashed #818cf8' : '1px solid rgba(255, 255, 255, 0.04)',
                              fontSize: '0.78rem',
                              color: '#e2e8f0',
                              cursor: 'grab',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                              <GripVertical size={12} style={{ opacity: 0.4 }} />
                              <span style={{ color: '#818cf8', fontSize: '0.7rem' }}>↳</span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subItem.label}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem', flexShrink: 0 }}>
                              <button
                                type="button"
                                disabled={isSubFirst}
                                onClick={(e) => { e.stopPropagation(); handleMoveSubItem(itemId, subItem.id, 'up'); }}
                                title={`Move ${subItem.label} Up`}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: isSubFirst ? 'rgba(255,255,255,0.2)' : '#cbd5e1',
                                  cursor: isSubFirst ? 'default' : 'pointer',
                                  padding: '2px 3px',
                                  borderRadius: '3px',
                                  display: 'inline-flex',
                                }}
                              >
                                <ArrowUp size={12} />
                              </button>
                              <button
                                type="button"
                                disabled={isSubLast}
                                onClick={(e) => { e.stopPropagation(); handleMoveSubItem(itemId, subItem.id, 'down'); }}
                                title={`Move ${subItem.label} Down`}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: isSubLast ? 'rgba(255,255,255,0.2)' : '#cbd5e1',
                                  cursor: isSubLast ? 'default' : 'pointer',
                                  padding: '2px 3px',
                                  borderRadius: '3px',
                                  display: 'inline-flex',
                                }}
                              >
                                <ArrowDown size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            <div
              style={{
                padding: '0.75rem 0.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
                marginTop: '0.5rem',
                borderTop: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <button
                type="button"
                className="btn"
                onClick={handleResetOrder}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#94a3b8',
                  fontSize: '0.75rem',
                  padding: '0.4rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                }}
              >
                <RotateCcw size={13} /> Reset Default Order
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setIsReordering(false)}
                style={{
                  background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  padding: '0.45rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                  boxShadow: '0 2px 8px rgba(79, 70, 229, 0.4)',
                }}
              >
                <Check size={14} /> Done Customizing
              </button>
            </div>
          </div>
        ) : (
          /* ─── Standard Ordered Navigation ─── */
          <>
            {effectiveOrder.map((itemId) => {
              const def = NAV_ITEM_DEFINITIONS[itemId];
              if (!def || !def.checkAccess(canAccess)) return null;
              const isOver = isSuperAdmin && dragOverItemId === itemId;

              return (
                <div
                  key={itemId}
                  draggable={isSuperAdmin}
                  onDragStart={(e) => handleDragStart(e, itemId)}
                  onDragOver={(e) => handleDragOver(e, itemId)}
                  onDrop={(e) => handleDrop(e, itemId)}
                  onDragEnd={() => { setDraggedItemId(null); setDragOverItemId(null); }}
                  style={{
                    position: 'relative',
                    transition: 'all 0.15s ease',
                    boxShadow: isOver ? '0 0 0 2px #6366f1' : 'none',
                    borderRadius: '6px',
                  }}
                >
                  {def.render({
                    currentPage,
                    onNavigate,
                    canAccess,
                    schedulePagesActive,
                    scheduleOpen,
                    setScheduleOpen,
                    studentPagesActive,
                    studentsOpen,
                    setStudentsOpen,
                    reportCardsActive,
                    reportCardsOpen,
                    setReportCardsOpen,
                    liveProgressActive,
                    liveProgressOpen,
                    setLiveProgressOpen,
                    openBugCount,
                    sidebarSubOrder,
                  })}
                </div>
              );
            })}
          </>
        )}

        <div style={{ flexGrow: 1 }} />
        <button className="nav-item logout-btn" onClick={handleLogout}>
          <LogOut size={20} />
          Logout
        </button>
      </nav>
    </aside>
  );
}
