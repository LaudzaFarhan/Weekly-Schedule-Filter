'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import {
  Home, AlertTriangle, Calendar, Activity, Star,
  Search, FileText, PenLine, Terminal, Settings, LogOut, User, BarChart3,
} from 'lucide-react';

/**
 * Each navItem maps to a sidebar `roleKey` (used in the Role Permissions
 * panel) and an optional `globalKey` (the global feature toggle in
 * Admin → Internal Feature Toggles). A page is hidden if either is OFF.
 */
const navItems = [
  { id: 'home', icon: Home, label: 'Home', roleKey: 'home' },
  { id: 'conflicts', icon: AlertTriangle, label: 'Conflict Report', roleKey: 'conflicts', globalKey: 'conflicts' },
  { id: 'availability', icon: Calendar, label: 'Slot Checker', roleKey: 'availability', globalKey: 'availability' },
  { id: 'workload', icon: BarChart3, label: 'Workload', roleKey: 'workload', globalKey: 'workload' },
  { id: 'leave', icon: Activity, label: 'Leave Management', roleKey: 'leave', globalKey: 'leave' },
  // Trial Priority page combines two global toggles — show if either is on
  { id: 'trial-priority', icon: Star, label: 'Trial Priority', roleKey: 'trial_priority',
    globalCheck: (g) => g?.trial !== false || g?.trial_overview !== false },
  { id: 'finder', icon: Search, label: 'Free Finder', roleKey: 'finder' },
  { id: 'schedule', icon: FileText, label: 'Master Schedule', roleKey: 'schedule' },
  { id: 'trial-input', icon: PenLine, label: 'Input Trial Leads', roleKey: 'trial_input' },
  { id: 'profiles', icon: User, label: 'Instructor Profiles', roleKey: 'profiles' },
  { id: 'api-docs', icon: Terminal, label: 'API Documentation', roleKey: 'api_docs' },
  { id: 'admin', icon: Settings, label: 'Admin Settings', roleKey: 'admin' },
];

export default function Sidebar({ currentPage, onNavigate }) {
  const { user, logout } = useAuth();
  const { roleToggles, users, featureToggles } = useSchedule();

  const handleLogout = async () => {
    await logout();
  };

  const userEmail = user?.email?.toLowerCase() || '';
  const userRole = users?.[userEmail] || 'Instructor';
  const currentToggles = roleToggles?.[userRole] || roleToggles?.['Instructor'] || {};

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
        <h2>Pulse</h2>
        <div className="version">SCHOOL OPERATIONS, LIVE</div>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => {
          if (!isItemVisible(item)) return null;
          const { id, icon: Icon, label } = item;
          return (
            <button
              key={id}
              className={`nav-item ${currentPage === id ? 'active' : ''}`}
              onClick={() => onNavigate(id)}
            >
              <Icon size={20} />
              {label}
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
