'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import {
  Home, AlertTriangle, Calendar, Activity, Star,
  Search, FileText, PenLine, Terminal, Settings, LogOut, User, BarChart3, ClipboardList, Users
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

export default function Sidebar({ currentPage, onNavigate, onToggleSearch }) {
  const { user, logout } = useAuth();
  const { roleToggles, users, featureToggles } = useSchedule();

  const handleLogout = async () => {
    await logout();
  };

  const userEmail = user?.email?.toLowerCase() || '';
  const userRole = users?.[userEmail] || 'Instructor';
  const currentToggles = roleToggles?.[userRole] || roleToggles?.['Instructor'] || {};

  const [pendingCount, setPendingCount] = useState(0);

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
