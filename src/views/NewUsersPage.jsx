'use client';

/**
 * New Operations — Users.
 *
 * Accounts here are separate from Old Operations: they live in `internal_users`
 * in PostgreSQL, not in Firebase, and one does not imply the other.
 *
 * The password column is the unusual part of this screen. Passwords are stored
 * encrypted rather than hashed precisely so an Admin can read one back for an
 * instructor who has forgotten theirs, which is the workflow this replaces —
 * previously that meant an Admin creating a whole new account. Each reveal is a
 * separate request to an audited endpoint, so the list itself never carries a
 * password and a screenshot of this page shows nothing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, Eye, EyeOff, KeyRound, Loader2, Pencil, Plus,
  RefreshCw, Search, ShieldCheck, Trash2, UserPlus, X, Lock, Unlock,
  Sliders, Shield, ChevronRight, CheckCircle2, XCircle, RotateCcw,
  Sparkles, Home, Calendar, Building2, Users as UsersIcon, ClipboardList,
  TrendingUp, User, BarChart3, CalendarOff, Star, Video, Activity, Terminal,
  BookOpen, Edit3, Settings, ExternalLink, Filter
} from 'lucide-react';
import { useToast } from '../components/ui/Toast';
import { useSchedule } from '../contexts/ScheduleContext';
import {
  APP_MODULES, SYSTEM_ROLES, ROLE_DESCRIPTIONS, DEFAULT_ROLE_PERMISSIONS,
  getEffectivePermissions, resolveUserRole, isAdmin
} from '../utils/roles';

const ROLES = SYSTEM_ROLES;
const STATUSES = ['Active', 'Suspended'];

/** Role colours. Admin is the only one that needs to stand out in a long list. */
const ROLE_STYLE = {
  Admin: { color: '#b91c1c', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
  Supervisor: { color: '#a16207', bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.3)' },
  SPA: { color: '#0e7490', bg: 'rgba(8,145,178,0.12)', border: 'rgba(8,145,178,0.3)' },
  EC: { color: '#6d28d9', bg: 'rgba(109,40,217,0.12)', border: 'rgba(109,40,217,0.3)' },
  Instructor: { color: '#1d4ed8', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)' },
};

const MODULE_CATEGORIES = [
  'Core & Operations',
  'Students & Progress',
  'Staff & Workload',
  'Enrollment & Leads',
  'Administration & System',
];

const MODULE_ICON_MAP = {
  dashboard: Home,
  schedule: Calendar,
  operationals: Building2,
  students: UsersIcon,
  'report-cards': ClipboardList,
  'live-progress': TrendingUp,
  instructors: User,
  workload: BarChart3,
  leave: CalendarOff,
  'trial-availability': Star,
  crm: UsersIcon,
  meetings: Video,
  activity: Activity,
  users: ShieldCheck,
  api: Terminal,
};

const emptyDraft = () => ({
  username: '', email: '', role: 'Instructor', fullname: '', phoneNumber: '', location: '',
});

/**
 * Turn a failed response into an Error that still knows its status.
 *
 * The status matters here: a 403 is not a fault to report, it is a signpost.
 * It means the caller is signed in with an Old Operations account, and the fix is
 * an action rather than a retry.
 */
async function errorFrom(res) {
  let message;
  try {
    const body = await res.json();
    message = body.message || body.error;
  } catch {
    message = null;
  }
  const error = new Error(message || `Request failed (${res.status})`);
  error.status = res.status;
  return error;
}

export default function NewUsersPage() {
  const { showToast } = useToast();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Kept alongside the message because a 403 needs a different screen, not a
  // different sentence: it is answered by signing in, never by retrying.
  const [errorStatus, setErrorStatus] = useState(null);
  const [keyConfigured, setKeyConfigured] = useState(true);
  /** Why the key is unusable: `{ reason: 'missing'|'invalid', message }` or null. */
  const [keyProblem, setKeyProblem] = useState(null);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [verificationFilter, setVerificationFilter] = useState('all'); // 'all' | 'verified' | 'pending'

  /** id -> revealed password. Cleared on reload so nothing lingers on screen. */
  const [revealed, setRevealed] = useState({});
  /** id of the row with a request in flight, so only that row shows a spinner. */
  const [busyId, setBusyId] = useState(null);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [provisionPreview, setProvisionPreview] = useState(null);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionVerifyImmediately, setProvisionVerifyImmediately] = useState(false);

  /**
   * The signed-in account's own id.
   *
   * Needed so the row belonging to whoever is looking does not offer them the
   * three actions that would lock them out of this screen. The API refuses those
   * anyway; this is so the button is not there to press in the first place, which
   * is a better answer than an error after the fact.
   */
  const [myId, setMyId] = useState(null);

  // RBAC Matrix & Access Control State
  const { rolePermissions, updateRolePermissions } = useSchedule();
  const [activeTab, setActiveTab] = useState('accounts'); // 'accounts' | 'roles' | 'inspector'
  const [selectedRole, setSelectedRole] = useState('Instructor');
  const [rolePermissionsDraft, setRolePermissionsDraft] = useState(() => rolePermissions || DEFAULT_ROLE_PERMISSIONS);
  const [savingPerms, setSavingPerms] = useState(false);
  const [inspectorUserId, setInspectorUserId] = useState('');
  const [inspectorSearch, setInspectorSearch] = useState('');
  const [matrixCategoryFilter, setMatrixCategoryFilter] = useState('all');

  useEffect(() => {
    if (rolePermissions && typeof rolePermissions === 'object' && Object.keys(rolePermissions).length > 0) {
      setRolePermissionsDraft((prev) => ({
        ...DEFAULT_ROLE_PERMISSIONS,
        ...rolePermissions,
      }));
    }
  }, [rolePermissions]);

  const togglePermission = (role, moduleId, permKey) => {
    if (role === 'Admin') return; // Admins always have full root access
    setRolePermissionsDraft((prev) => {
      const currentRolePerms = prev[role] || DEFAULT_ROLE_PERMISSIONS[role] || {};
      const currentModPerms = currentRolePerms[moduleId] || { view: true, read: true, write: false, admin: false };
      const nextVal = !currentModPerms[permKey];

      const updatedModPerms = { ...currentModPerms, [permKey]: nextVal };
      if (permKey === 'view' && !nextVal) {
        updatedModPerms.read = false;
        updatedModPerms.write = false;
      }
      if ((permKey === 'write' || permKey === 'read') && nextVal) {
        updatedModPerms.view = true;
      }

      return {
        ...prev,
        [role]: {
          ...currentRolePerms,
          [moduleId]: updatedModPerms,
        },
      };
    });
  };

  const applyPreset = (role, presetType) => {
    if (role === 'Admin') return;
    setRolePermissionsDraft((prev) => {
      const updated = { ...(prev[role] || {}) };

      APP_MODULES.forEach((mod) => {
        if (presetType === 'full') {
          updated[mod.id] = { view: true, read: true, write: true, admin: false };
        } else if (presetType === 'readonly') {
          updated[mod.id] = { view: true, read: true, write: false, admin: false };
        } else if (presetType === 'ops') {
          const isOpsMod = ['dashboard', 'schedule', 'operationals', 'students', 'live-progress', 'instructors', 'workload', 'leave', 'trial-availability'].includes(mod.id);
          updated[mod.id] = { view: isOpsMod, read: isOpsMod, write: isOpsMod, admin: false };
        } else if (presetType === 'ec') {
          const isEcMod = ['dashboard', 'students', 'crm', 'meetings', 'trial-availability', 'live-progress', 'report-cards'].includes(mod.id);
          updated[mod.id] = { view: isEcMod, read: isEcMod, write: isEcMod, admin: false };
        } else if (presetType === 'instructor') {
          const isInstructorMod = ['schedule', 'report-cards', 'live-progress', 'leave', 'meetings'].includes(mod.id);
          const isReadOnlyMod = ['dashboard', 'students', 'instructors', 'workload'].includes(mod.id);
          if (isInstructorMod) {
            updated[mod.id] = { view: true, read: true, write: true, admin: false };
          } else if (isReadOnlyMod) {
            updated[mod.id] = { view: true, read: true, write: false, admin: false };
          } else {
            updated[mod.id] = { view: false, read: false, write: false, admin: false };
          }
        } else if (presetType === 'reset') {
          updated[mod.id] = { ...(DEFAULT_ROLE_PERMISSIONS[role]?.[mod.id] || { view: true, read: true, write: false, admin: false }) };
        }
      });

      return {
        ...prev,
        [role]: updated,
      };
    });

    showToast({
      variant: 'info',
      title: 'Preset applied',
      message: `Applied ${presetType.toUpperCase()} preset to ${role}. Click "Save Role Permissions" to persist.`,
      duration: 4000,
    });
  };

  const handleSaveRolePermissions = async () => {
    setSavingPerms(true);
    try {
      if (updateRolePermissions) {
        await updateRolePermissions(rolePermissionsDraft);
      }
      const newRolePages = {};
      for (const r of SYSTEM_ROLES) {
        newRolePages[r] = APP_MODULES
          .filter((m) => (r === 'Admin' || rolePermissionsDraft[r]?.[m.id]?.view !== false))
          .map((m) => m.pageId);
      }
      await fetch('/api/new/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'rolePages', value: newRolePages }),
      }).catch(() => null);

      showToast({
        variant: 'success',
        title: 'Permissions saved',
        message: `Role permissions for ${selectedRole} and other roles have been successfully updated.`,
        duration: 5000,
      });
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Failed to save permissions',
        message: err?.message || 'Could not save role permissions.',
      });
    } finally {
      setSavingPerms(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/api/new/auth/session')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (!cancelled) setMyId(body?.user?.id ?? null); })
      // A failure here only means self-actions stay enabled and the API refuses
      // them instead. Not worth surfacing.
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /**
   * Report a failed action.
   *
   * A 403 gets the explanation rather than the API's one-line refusal, because
   * the cause is never something the caller did wrong on this screen — they are
   * signed in with an Old Operations account, and no amount of retrying the
   * action will help.
   */
  const reportError = useCallback((err, title) => {
    if (err?.status === 403) {
      showToast({
        variant: 'error',
        title: 'Not allowed with this sign-in',
        message:
          'These accounts are separate from Old Operations. Sign out, then sign back in '
          + 'with a New Operations account that has the Admin role.',
        duration: 10000,
      });
      return;
    }
    showToast({
      variant: 'error',
      title,
      message: err?.message || 'Something went wrong.',
      duration: 9000,
    });
  }, [showToast]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorStatus(null);
    try {
      const res = await fetch('/api/new/users');
      if (!res.ok) throw await errorFrom(res);
      const body = await res.json();
      setUsers(body.users || []);
      setKeyConfigured(body.credentialKeyConfigured !== false);
      setKeyProblem(body.credentialKey?.ok === false ? body.credentialKey : null);
      // Revealed passwords are dropped on every reload: leaving them visible
      // across a refresh would mean a page left open keeps showing credentials.
      setRevealed({});
    } catch (err) {
      setError(err.message);
      setErrorStatus(err.status ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== 'all' && user.role !== roleFilter) return false;
      if (verificationFilter === 'verified' && !user.isVerified && user.role !== 'Admin') return false;
      if (verificationFilter === 'pending' && (user.isVerified || user.role === 'Admin')) return false;
      if (!term) return true;
      return [user.username, user.email, user.fullname, user.nickname, user.phoneNumber, user.location]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(term));
    });
  }, [users, search, roleFilter, verificationFilter]);

  const counts = useMemo(() => {
    const out = { total: users.length, instructors: 0, suspended: 0, verified: 0, pending: 0 };
    for (const user of users) {
      if (user.role === 'Instructor') out.instructors += 1;
      if (user.status !== 'Active') out.suspended += 1;
      if (user.isVerified || user.role === 'Admin') out.verified += 1;
      else out.pending += 1;
    }
    return out;
  }, [users]);

  const toggleVerification = async (user) => {
    setBusyId(user.id);
    try {
      const nextVerified = !user.isVerified;
      const res = await fetch('/api/new/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, isVerified: nextVerified }),
      });
      if (!res.ok) throw await errorFrom(res);
      showToast({
        variant: 'success',
        title: nextVerified ? `${user.username} verified & approved` : `${user.username} unverified`,
        message: nextVerified
          ? 'This account has been verified and can now log in.'
          : 'This account is unverified and blocked from logging in until approved.',
      });
      await load();
    } catch (err) {
      reportError(err, 'Could not update verification status');
    } finally {
      setBusyId(null);
    }
  };

  const verifyAllPending = async () => {
    const pendingList = users.filter((u) => !u.isVerified && u.role !== 'Admin');
    if (pendingList.length === 0) return;
    const ok = window.confirm(
      `Verify and approve all ${pendingList.length} pending account(s)?\n\n`
      + 'They will immediately be allowed to sign into the system.'
    );
    if (!ok) return;

    setLoading(true);
    try {
      const res = await fetch('/api/new/users/verify', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allPending: true, isVerified: true }),
      });
      if (!res.ok) throw await errorFrom(res);
      const body = await res.json();
      showToast({
        variant: 'success',
        title: 'Accounts verified',
        message: body.message || `Successfully verified ${body.verifiedCount} account(s).`,
        duration: 8000,
      });
      await load();
    } catch (err) {
      reportError(err, 'Could not verify pending accounts');
    } finally {
      setLoading(false);
    }
  };

  const toggleReveal = async (user) => {
    if (revealed[user.id]) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[user.id];
        return next;
      });
      return;
    }
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/new/users/password?id=${user.id}`);
      if (!res.ok) throw await errorFrom(res);
      const body = await res.json();
      setRevealed((prev) => ({ ...prev, [user.id]: body.password }));
    } catch (err) {
      reportError(err, 'Could not read that password');
    } finally {
      setBusyId(null);
    }
  };

  const resetPassword = async (user) => {
    const expected = user.role === 'Instructor' ? 'instructor12345' : 'thelab12345';
    const ok = window.confirm(
      `Reset ${user.username}'s password to "${expected}"?\n\n`
      + 'They will be asked to change it next time they sign in, and any session '
      + 'they currently have will end.'
    );
    if (!ok) return;

    setBusyId(user.id);
    try {
      const res = await fetch('/api/new/users/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, reset: true }),
      });
      if (!res.ok) throw await errorFrom(res);
      const body = await res.json();
      // Shown straight away rather than making the Admin press the eye as well —
      // they just chose to set it, so there is nothing to protect them from.
      setRevealed((prev) => ({ ...prev, [user.id]: body.password }));
      showToast({
        variant: 'success',
        title: `Password reset for ${user.username}`,
        message: `It is now "${body.password}". They will be asked to change it on next sign-in.`,
        duration: 12000,
      });
      await load();
      setRevealed((prev) => ({ ...prev, [user.id]: body.password }));
    } catch (err) {
      reportError(err, 'Could not reset that password');
    } finally {
      setBusyId(null);
    }
  };

  const setStatus = async (user, status) => {
    setBusyId(user.id);
    try {
      const res = await fetch('/api/new/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, status }),
      });
      if (!res.ok) throw await errorFrom(res);
      showToast({
        variant: 'success',
        title: status === 'Active' ? `${user.username} re-enabled` : `${user.username} suspended`,
        message: status === 'Active'
          ? 'They can sign in again.'
          : 'They cannot sign in, and any session they had has ended.',
      });
      await load();
    } catch (err) {
      reportError(err, 'Could not change that account');
    } finally {
      setBusyId(null);
    }
  };

  const changeRole = async (user, role) => {
    setBusyId(user.id);
    try {
      const res = await fetch('/api/new/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, role }),
      });
      if (!res.ok) throw await errorFrom(res);
      showToast({ variant: 'success', title: `${user.username} is now ${role}` });
      await load();
    } catch (err) {
      reportError(err, 'Could not change that role');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (user) => {
    const ok = window.confirm(
      `Delete the account "${user.username}"?\n\n`
      + 'This cannot be undone. If you only want to stop them signing in, suspend '
      + 'the account instead — that keeps the record and can be reversed.'
    );
    if (!ok) return;

    setBusyId(user.id);
    try {
      const res = await fetch(`/api/new/users?id=${user.id}`, { method: 'DELETE' });
      if (!res.ok) throw await errorFrom(res);
      showToast({ variant: 'success', title: `Deleted the account ${user.username}` });
      await load();
    } catch (err) {
      reportError(err, 'Could not delete that account');
    } finally {
      setBusyId(null);
    }
  };

  const submitDraft = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const editing = editingId !== null;
      const res = await fetch('/api/new/users', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { ...draft, id: editingId } : draft),
      });
      if (!res.ok) throw await errorFrom(res);
      const body = await res.json();
      showToast({
        variant: 'success',
        title: editing ? `Updated ${body.user.username}` : `Created ${body.user.username}`,
        message: body.temporaryPassword
          ? `Password is "${body.temporaryPassword}". They must change it on first sign-in.`
          : undefined,
        // Long enough to write the password down, since it is only shown here.
        duration: body.temporaryPassword ? 14000 : 6000,
      });
      setAdding(false);
      setEditingId(null);
      setDraft(emptyDraft());
      await load();
    } catch (err) {
      reportError(err, editing ? 'Could not save that account' : 'Could not create that account');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (user) => {
    setEditingId(user.id);
    setAdding(true);
    setDraft({
      username: user.username,
      email: user.email,
      role: user.role,
      fullname: user.fullname || '',
      phoneNumber: user.phoneNumber || '',
      location: user.location || '',
    });
  };

  const previewProvision = async () => {
    setProvisioning(true);
    try {
      const res = await fetch('/api/new/users/provision');
      if (!res.ok) throw await errorFrom(res);
      setProvisionPreview(await res.json());
    } catch (err) {
      reportError(err, 'Could not check the instructor list');
    } finally {
      setProvisioning(false);
    }
  };

  const runProvision = async () => {
    setProvisioning(true);
    try {
      const res = await fetch('/api/new/users/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifyImmediately: provisionVerifyImmediately }),
      });
      if (!res.ok) throw await errorFrom(res);
      const body = await res.json();
      showToast({
        variant: 'success',
        title: `Created ${body.created.length} instructor account${body.created.length === 1 ? '' : 's'}`,
        message: body.message,
        duration: 14000,
      });
      setProvisionPreview(null);
      await load();
    } catch (err) {
      reportError(err, 'Could not create the instructor accounts');
    } finally {
      setProvisioning(false);
    }
  };

  const inspectedUser = useMemo(() => {
    if (!inspectorUserId && users.length > 0) return users[0];
    return users.find((u) => u.id === inspectorUserId || u.email === inspectorUserId || u.username === inspectorUserId) || users[0] || null;
  }, [users, inspectorUserId]);

  const inspectedPermissions = useMemo(() => {
    if (!inspectedUser) return {};
    const role = inspectedUser.role || 'Instructor';
    const out = {};
    APP_MODULES.forEach((mod) => {
      out[mod.id] = getEffectivePermissions(role, mod.id, rolePermissionsDraft);
    });
    return out;
  }, [inspectedUser, rolePermissionsDraft]);

  const filteredModulesForMatrix = useMemo(() => {
    return APP_MODULES.filter((m) => {
      if (matrixCategoryFilter !== 'all' && m.category !== matrixCategoryFilter) return false;
      return true;
    });
  }, [matrixCategoryFilter]);

  const filteredModulesForInspector = useMemo(() => {
    const term = inspectorSearch.trim().toLowerCase();
    return APP_MODULES.filter((m) => {
      if (!term) return true;
      return m.name.toLowerCase().includes(term) || m.description.toLowerCase().includes(term) || m.category.toLowerCase().includes(term);
    });
  }, [inspectorSearch]);

  const activeRolePerms = rolePermissionsDraft[selectedRole] || DEFAULT_ROLE_PERMISSIONS[selectedRole] || {};

  return (
    <div className="dashboard-view">
      {/* Top Main Navigation Tabs */}
      <div className="panel" style={{ margin: '0 0 1.25rem', overflow: 'hidden' }}>
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-color)', background: 'var(--bg-card)', padding: '0 1.25rem',
        }}>
          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setActiveTab('accounts')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                padding: '0.9rem 0.2rem', background: 'none', border: 'none',
                borderBottom: activeTab === 'accounts' ? '2.5px solid var(--primary-blue)' : '2.5px solid transparent',
                color: activeTab === 'accounts' ? 'var(--primary-blue)' : 'var(--text-secondary)',
                fontWeight: activeTab === 'accounts' ? 700 : 500, fontSize: '0.86rem', cursor: 'pointer',
              }}
            >
              <UsersIcon size={16} />
              <span>User Accounts</span>
              <span style={{
                fontSize: '0.68rem', padding: '0.1rem 0.45rem', borderRadius: '12px',
                background: activeTab === 'accounts' ? 'rgba(59,130,246,0.12)' : 'var(--bg-color)',
                color: activeTab === 'accounts' ? 'var(--primary-blue)' : 'var(--text-muted)',
                fontWeight: 700,
              }}>
                {counts.total}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('roles')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                padding: '0.9rem 0.2rem', background: 'none', border: 'none',
                borderBottom: activeTab === 'roles' ? '2.5px solid #4f46e5' : '2.5px solid transparent',
                color: activeTab === 'roles' ? '#4f46e5' : 'var(--text-secondary)',
                fontWeight: activeTab === 'roles' ? 700 : 500, fontSize: '0.86rem', cursor: 'pointer',
              }}
            >
              <ShieldCheck size={16} />
              <span>Role Access Control</span>
              <span style={{
                fontSize: '0.68rem', padding: '0.1rem 0.45rem', borderRadius: '12px',
                background: 'rgba(79,70,229,0.12)', color: '#4f46e5', fontWeight: 700,
              }}>
                RBAC Matrix
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('inspector')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                padding: '0.9rem 0.2rem', background: 'none', border: 'none',
                borderBottom: activeTab === 'inspector' ? '2.5px solid #059669' : '2.5px solid transparent',
                color: activeTab === 'inspector' ? '#059669' : 'var(--text-secondary)',
                fontWeight: activeTab === 'inspector' ? 700 : 500, fontSize: '0.86rem', cursor: 'pointer',
              }}
            >
              <KeyRound size={16} />
              <span>User Access Inspector</span>
              <span style={{
                fontSize: '0.68rem', padding: '0.1rem 0.45rem', borderRadius: '12px',
                background: 'rgba(5,150,105,0.12)', color: '#059669', fontWeight: 700,
              }}>
                Audit
              </span>
            </button>
          </div>

          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>
            System Security & Access Level Control
          </div>
        </div>

        {/* ========================================================================= */}
        {/* TAB 1: USER ACCOUNTS                                                      */}
        {/* ========================================================================= */}
        {activeTab === 'accounts' && (
          <div>
            <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0 }}>Active User Directory</h2>
                <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {counts.total} account{counts.total === 1 ? '' : 's'}
                  {' · '}{counts.instructors} instructor{counts.instructors === 1 ? '' : 's'}
                  {' · '}<span style={{ color: '#059669', fontWeight: 600 }}>{counts.verified} verified</span>
                  {counts.pending > 0 && (
                    <>
                      {' · '}
                      <span style={{ color: '#d97706', fontWeight: 600 }}>
                        {counts.pending} pending verification
                      </span>
                    </>
                  )}
                  {counts.suspended > 0 && ` · ${counts.suspended} suspended`}
                  {' · internal authentication database'}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {counts.pending > 0 && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={verifyAllPending}
                    disabled={loading}
                    title="Verify and approve all pending instructor accounts at once"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                      background: 'rgba(5,150,105,0.12)', color: '#059669',
                      border: '1px solid rgba(5,150,105,0.3)', fontWeight: 600,
                    }}
                  >
                    <CheckCircle2 size={14} /> Verify all pending ({counts.pending})
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={previewProvision}
                  disabled={provisioning}
                  title="Create a login for every instructor who does not have one yet"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  {provisioning ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />}
                  Accounts for instructors
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={load}
                  disabled={loading}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <RefreshCw size={14} className={loading ? 'spin' : ''} /> Reload
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => { setEditingId(null); setDraft(emptyDraft()); setAdding((v) => !v); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <Plus size={14} /> New account
                </button>
              </div>
            </div>

            {!keyConfigured && (
              <div style={{
                margin: '0 1.5rem 1rem', padding: '0.7rem 0.9rem', borderRadius: '10px',
                background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)',
                display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.78rem',
              }}>
                <AlertTriangle size={15} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
                {keyProblem?.reason === 'invalid' ? (
                  <span>
                    <strong>EMPLOYEE_CREDENTIAL_KEY is set, but it is not a valid key.</strong>{' '}
                    {keyProblem.message} Passwords cannot be read, set or checked, so nobody can sign
                    in with these accounts.
                  </span>
                ) : (
                  <span>
                    <strong>EMPLOYEE_CREDENTIAL_KEY is not set on this deployment.</strong> Passwords
                    cannot be read, set or checked until it is.
                  </span>
                )}
              </div>
            )}

            {adding && (
              <form onSubmit={submitDraft} className="panel-body" style={{ borderTop: '1px solid var(--border-color)', display: 'grid', gap: '0.75rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 160px' }}>
                    <label className="modal-form-label" htmlFor="user-username">Username</label>
                    <input
                      id="user-username"
                      className="modal-input-field"
                      style={{ width: '100%' }}
                      value={draft.username}
                      onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                      placeholder="felix.wijaya"
                      required
                    />
                  </div>
                  <div style={{ flex: '1 1 200px' }}>
                    <label className="modal-form-label" htmlFor="user-email">Email</label>
                    <input
                      id="user-email"
                      className="modal-input-field"
                      style={{ width: '100%' }}
                      value={draft.email}
                      onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                      placeholder="felix@thelab.id"
                      required
                    />
                  </div>
                  <div style={{ flex: '0 1 140px' }}>
                    <label className="modal-form-label" htmlFor="user-role">Role</label>
                    <select
                      id="user-role"
                      className="modal-select-field"
                      style={{ width: '100%' }}
                      value={draft.role}
                      onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                    >
                      {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 200px' }}>
                    <label className="modal-form-label" htmlFor="user-fullname">Full name</label>
                    <input
                      id="user-fullname"
                      className="modal-input-field"
                      style={{ width: '100%' }}
                      value={draft.fullname}
                      onChange={(e) => setDraft({ ...draft, fullname: e.target.value })}
                    />
                  </div>
                  <div style={{ flex: '1 1 140px' }}>
                    <label className="modal-form-label" htmlFor="user-phone">Phone</label>
                    <input
                      id="user-phone"
                      className="modal-input-field"
                      style={{ width: '100%' }}
                      value={draft.phoneNumber}
                      onChange={(e) => setDraft({ ...draft, phoneNumber: e.target.value })}
                    />
                  </div>
                  <div style={{ flex: '1 1 140px' }}>
                    <label className="modal-form-label" htmlFor="user-location">Location</label>
                    <input
                      id="user-location"
                      className="modal-input-field"
                      style={{ width: '100%' }}
                      value={draft.location}
                      onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                    {saving ? 'Saving…' : editingId !== null ? 'Save changes' : 'Create account'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => { setAdding(false); setEditingId(null); }}
                    style={{ background: 'transparent' }}
                  >
                    Cancel
                  </button>
                  {editingId === null && (
                    <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                      Starts with the shared password for that role, and must be changed on first sign-in.
                    </span>
                  )}
                </div>
              </form>
            )}

            {provisionPreview && (
              <div style={{ borderTop: '1px solid var(--border-color)', padding: '1rem 1.5rem', background: 'var(--bg-card)' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.4rem' }}>
                  Accounts for instructors
                </h3>
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Usernames and contact info are derived from the instructor directory.
                </p>
                {provisionPreview.willCreate.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    Every active instructor already has an account. Nothing to do.
                  </p>
                ) : (
                  <div style={{ display: 'grid', gap: '0.6rem', marginBottom: '0.9rem' }}>
                    <div style={{
                      maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--border-color)',
                      borderRadius: '8px', padding: '0.5rem 0.75rem', background: 'var(--panel-bg)',
                    }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textAlign: 'left' }}>
                            <th style={{ padding: '0.35rem 0.5rem' }}>Username</th>
                            <th style={{ padding: '0.35rem 0.5rem' }}>Instructor Name</th>
                            <th style={{ padding: '0.35rem 0.5rem' }}>Email</th>
                            <th style={{ padding: '0.35rem 0.5rem' }}>Branch</th>
                          </tr>
                        </thead>
                        <tbody>
                          {provisionPreview.willCreate.map((entry) => (
                            <tr key={entry.instructorId} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                              <td style={{ padding: '0.35rem 0.5rem', fontWeight: 600 }}>{entry.username}</td>
                              <td style={{ padding: '0.35rem 0.5rem' }}>{entry.name}</td>
                              <td style={{ padding: '0.35rem 0.5rem', color: 'var(--text-secondary)' }}>
                                {entry.email}
                              </td>
                              <td style={{ padding: '0.35rem 0.5rem', color: 'var(--text-muted)' }}>
                                {entry.location || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={provisionVerifyImmediately}
                        onChange={(e) => setProvisionVerifyImmediately(e.target.checked)}
                      />
                      <span>
                        <strong>Verify accounts immediately</strong> (otherwise accounts are created as <em>Pending Verification</em> for admin review)
                      </span>
                    </label>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={runProvision}
                    disabled={provisioning || provisionPreview.willCreate.length === 0}
                  >
                    {provisioning ? 'Creating…' : `Create ${provisionPreview.willCreate.length} account${provisionPreview.willCreate.length === 1 ? '' : 's'}`}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setProvisionPreview(null)}
                    style={{ background: 'transparent' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Filter Bar */}
            <div className="panel-header" style={{ gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border-color)' }}>
              <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: '320px' }}>
                <Search size={14} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  className="modal-input-field field-compact"
                  style={{ width: '100%', paddingLeft: '1.9rem' }}
                  placeholder="Search name, username or email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search accounts"
                />
              </div>
              <select
                className="modal-select-field field-compact"
                style={{ minWidth: '150px' }}
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                aria-label="Filter by role"
              >
                <option value="all">All roles ({users.length})</option>
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role} ({users.filter((u) => u.role === role).length})
                  </option>
                ))}
              </select>
              <select
                className="modal-select-field field-compact"
                style={{ minWidth: '175px' }}
                value={verificationFilter}
                onChange={(e) => setVerificationFilter(e.target.value)}
                aria-label="Filter by verification"
              >
                <option value="all">All Verification ({users.length})</option>
                <option value="verified">Verified ({counts.verified})</option>
                <option value="pending">Pending Approval ({counts.pending})</option>
              </select>
            </div>

            {/* User Table */}
            <div className="panel-body table-wrapper">
              {loading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '3rem', color: 'var(--text-secondary)' }}>
                  <div className="loading-spinner" /> Loading accounts…
                </div>
              ) : visible.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {users.length === 0 ? 'No accounts found.' : 'No account matches that search.'}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Username', 'Name', 'Role', 'Password', 'Status', 'Verification', 'Permissions', 'Actions'].map((heading, i) => (
                        <th
                          key={heading || `actions-${i}`}
                          scope="col"
                          style={{
                            textAlign: heading === 'Actions' ? 'right' : 'left',
                            padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--border-color)',
                            fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
                            textTransform: 'uppercase', color: 'var(--text-muted)', whiteSpace: 'nowrap',
                          }}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((user) => {
                      const roleStyle = ROLE_STYLE[user.role] || ROLE_STYLE.Instructor;
                      const busy = busyId === user.id;
                      const shown = revealed[user.id];
                      const isMe = myId != null && user.id === myId;
                      const isVerifiedAccount = user.isVerified || user.role === 'Admin';
                      return (
                        <tr key={user.id} style={{ opacity: user.status === 'Active' ? 1 : 0.55 }}>
                          <td style={{ padding: '0.55rem 0.75rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.82rem', fontWeight: 600 }}>
                            {user.username}
                            {isMe && (
                              <span style={{
                                marginLeft: '0.35rem', fontSize: '0.6rem', fontWeight: 700,
                                color: 'var(--primary-blue)', background: 'rgba(59,130,246,0.12)',
                                borderRadius: '5px', padding: '0.05rem 0.3rem',
                              }}>
                                you
                              </span>
                            )}
                            {user.instructorId != null && (
                              <span
                                title="Generated from the instructor registry"
                                style={{ marginLeft: '0.35rem', fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 500 }}
                              >
                                · registry
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '0.55rem 0.75rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {user.fullname || '—'}
                          </td>
                          <td style={{ padding: '0.55rem 0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                            <select
                              value={user.role}
                              onChange={(e) => changeRole(user, e.target.value)}
                              disabled={busy}
                              aria-label={`Role for ${user.username}`}
                              style={{
                                border: 'none', borderRadius: '6px', padding: '0.18rem 0.4rem',
                                fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                                color: roleStyle.color, background: roleStyle.bg,
                                fontFamily: 'inherit',
                              }}
                            >
                              {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: '0.55rem 0.75rem', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                              <code style={{
                                fontSize: '0.75rem', minWidth: '7.5rem', display: 'inline-block',
                                color: shown ? 'var(--text-main)' : 'var(--text-muted)',
                                letterSpacing: shown ? 0 : '0.12em',
                              }}>
                                {shown || (user.hasPassword ? '••••••••' : 'not set')}
                              </code>
                              {user.hasPassword && (
                                <button
                                  type="button"
                                  onClick={() => toggleReveal(user)}
                                  disabled={busy}
                                  title={shown ? 'Hide' : 'Show — this read is written to the activity log'}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, lineHeight: 0 }}
                                >
                                  {busy ? <Loader2 size={14} className="spin" /> : shown ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                              )}
                            </span>
                          </td>
                          <td style={{ padding: '0.55rem 0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                            <button
                              type="button"
                              onClick={() => setStatus(user, user.status === 'Active' ? 'Suspended' : 'Active')}
                              disabled={busy || isMe}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                border: 'none', borderRadius: '6px', padding: '0.18rem 0.45rem',
                                fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                                color: user.status === 'Active' ? '#047857' : '#b91c1c',
                                background: user.status === 'Active' ? 'rgba(5,150,105,0.12)' : 'rgba(239,68,68,0.12)',
                              }}
                            >
                              {user.status === 'Active' ? <Check size={11} /> : <X size={11} />}
                              {user.status}
                            </button>
                          </td>
                          <td style={{ padding: '0.55rem 0.75rem', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                            {isVerifiedAccount ? (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                    borderRadius: '99px', padding: '0.18rem 0.55rem',
                                    fontSize: '0.7rem', fontWeight: 700,
                                    color: '#047857', background: 'rgba(5,150,105,0.12)',
                                    border: '1px solid rgba(5,150,105,0.25)',
                                  }}
                                  title={user.verifiedBy ? `Verified by ${user.verifiedBy}${user.verifiedAt ? ` on ${new Date(user.verifiedAt).toLocaleDateString()}` : ''}` : 'Verified Administrator'}
                                >
                                  <CheckCircle2 size={11} /> Verified
                                </span>
                                {user.role !== 'Admin' && !isMe && (
                                  <button
                                    type="button"
                                    onClick={() => toggleVerification(user)}
                                    disabled={busy}
                                    title="Unverify this account (user cannot sign in until re-verified)"
                                    style={{
                                      background: 'none', border: 'none', cursor: 'pointer',
                                      fontSize: '0.68rem', color: 'var(--text-muted)', textDecoration: 'underline',
                                      padding: '0 0.2rem',
                                    }}
                                  >
                                    Unverify
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                    borderRadius: '99px', padding: '0.18rem 0.5rem',
                                    fontSize: '0.7rem', fontWeight: 700,
                                    color: '#b45309', background: 'rgba(245,158,11,0.14)',
                                    border: '1px solid rgba(245,158,11,0.3)',
                                  }}
                                  title="Account is pending verification by an Administrator"
                                >
                                  <AlertTriangle size={11} /> Pending
                                </span>
                                <button
                                  type="button"
                                  onClick={() => toggleVerification(user)}
                                  disabled={busy}
                                  className="btn btn-sm"
                                  style={{
                                    fontSize: '0.68rem', padding: '0.18rem 0.45rem', height: 'auto',
                                    display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                    borderRadius: '6px', background: '#059669', color: '#fff',
                                    borderColor: '#047857', fontWeight: 600,
                                  }}
                                  title="Verify and approve this account so user can log in"
                                >
                                  <ShieldCheck size={11} /> Verify
                                </button>
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '0.55rem 0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setInspectorUserId(user.id);
                                setActiveTab('inspector');
                              }}
                              className="btn btn-sm"
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                fontSize: '0.7rem', padding: '0.18rem 0.5rem', height: 'auto',
                                background: 'rgba(5,150,105,0.08)', color: '#059669', borderColor: 'rgba(5,150,105,0.25)',
                              }}
                              title="Inspect module access for this user"
                            >
                              <ShieldCheck size={12} />
                              <span>Inspect</span>
                            </button>
                          </td>
                          <td style={{ padding: '0.55rem 0.75rem', borderBottom: '1px solid var(--border-color)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <span style={{ display: 'inline-flex', gap: '0.15rem' }}>
                              <button
                                type="button"
                                onClick={() => resetPassword(user)}
                                disabled={busy || isMe}
                                title={isMe ? 'Resetting own password would sign out' : 'Reset password to role default'}
                                style={{
                                  background: 'none', border: 'none', padding: '0.2rem', lineHeight: 0,
                                  cursor: isMe ? 'not-allowed' : 'pointer',
                                  color: isMe ? 'var(--text-muted)' : 'var(--primary-blue)',
                                  opacity: isMe ? 0.4 : 1,
                                }}
                              >
                                <KeyRound size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => startEdit(user)}
                                disabled={busy}
                                title="Edit account details"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '0.2rem', lineHeight: 0 }}
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => remove(user)}
                                disabled={busy || isMe}
                                title={isMe ? 'Cannot delete own account' : 'Delete this account'}
                                style={{
                                  background: 'none', border: 'none', padding: '0.2rem', lineHeight: 0,
                                  cursor: isMe ? 'not-allowed' : 'pointer',
                                  color: isMe ? 'var(--text-muted)' : 'var(--danger)',
                                  opacity: isMe ? 0.4 : 1,
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: ROLE ACCESS CONTROL MATRIX (RBAC)                                  */}
        {/* ========================================================================= */}
        {activeTab === 'roles' && (
          <div style={{ display: 'grid', gap: '1.25rem', padding: '1.25rem' }}>
            {/* Role Switcher Cards */}
            <div>
              <label style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', display: 'block', marginBottom: '0.5rem' }}>
                Select Role to Configure Permissions
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.65rem' }}>
                {SYSTEM_ROLES.map((role) => {
                  const isSelected = selectedRole === role;
                  const roleStyle = ROLE_STYLE[role] || ROLE_STYLE.Instructor;
                  const roleUserCount = users.filter((u) => u.role === role).length;
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setSelectedRole(role)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem',
                        padding: '0.75rem 0.9rem', borderRadius: '10px',
                        background: isSelected ? roleStyle.bg : 'var(--bg-card)',
                        border: isSelected ? `2px solid ${roleStyle.color}` : '1px solid var(--border-color)',
                        cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.88rem', color: isSelected ? roleStyle.color : 'var(--text-main)' }}>
                          {role}
                        </span>
                        <span style={{
                          fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '10px',
                          background: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--bg-color)',
                          color: isSelected ? roleStyle.color : 'var(--text-muted)',
                        }}>
                          {roleUserCount} user{roleUserCount === 1 ? '' : 's'}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                        {role === 'Admin' ? 'Superuser root access' : ROLE_DESCRIPTIONS[role]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Role Header Banner & Presets */}
            <div style={{
              background: 'var(--bg-color)', borderRadius: '12px', padding: '1rem 1.2rem',
              border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.85rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div style={{
                    width: '34px', height: '34px', borderRadius: '8px',
                    background: ROLE_STYLE[selectedRole]?.bg || 'rgba(59,130,246,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: ROLE_STYLE[selectedRole]?.color || 'var(--primary-blue)',
                  }}>
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span>Permissions for {selectedRole}</span>
                      <span style={{
                        fontSize: '0.68rem', padding: '0.1rem 0.45rem', borderRadius: '6px',
                        background: ROLE_STYLE[selectedRole]?.bg, color: ROLE_STYLE[selectedRole]?.color,
                      }}>
                        {users.filter((u) => u.role === selectedRole).length} accounts
                      </span>
                    </h3>
                    <p style={{ margin: '0.1rem 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                      {selectedRole === 'Admin'
                        ? 'Admins inherently bypass restrictions and have unrestricted View, Read, and Write access across all modules.'
                        : 'Configure which modules this role can view in sidebar, read data from, and perform write/edit actions.'}
                    </p>
                  </div>
                </div>

                {selectedRole !== 'Admin' && (
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Quick Presets:</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => applyPreset(selectedRole, 'full')}
                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', height: 'auto' }}
                      title="Enable View, Read, Write on all modules"
                    >
                      <Sparkles size={12} /> Full Access
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => applyPreset(selectedRole, 'ops')}
                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', height: 'auto' }}
                    >
                      Operations Staff
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => applyPreset(selectedRole, 'ec')}
                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', height: 'auto' }}
                    >
                      Advisor / EC
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => applyPreset(selectedRole, 'instructor')}
                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', height: 'auto' }}
                    >
                      Instructor Standard
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => applyPreset(selectedRole, 'readonly')}
                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', height: 'auto' }}
                    >
                      Read Only
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => applyPreset(selectedRole, 'reset')}
                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', height: 'auto', color: 'var(--text-muted)' }}
                      title="Reset this role to default matrix"
                    >
                      <RotateCcw size={12} /> Reset
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Category Filter Pills */}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginRight: '0.25rem' }}>Filter Category:</span>
              <button
                type="button"
                onClick={() => setMatrixCategoryFilter('all')}
                style={{
                  border: 'none', borderRadius: '8px', padding: '0.25rem 0.6rem', fontSize: '0.74rem',
                  fontWeight: matrixCategoryFilter === 'all' ? 700 : 500, cursor: 'pointer',
                  background: matrixCategoryFilter === 'all' ? 'var(--primary-blue)' : 'var(--bg-color)',
                  color: matrixCategoryFilter === 'all' ? '#fff' : 'var(--text-secondary)',
                }}
              >
                All Modules ({APP_MODULES.length})
              </button>
              {MODULE_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setMatrixCategoryFilter(cat)}
                  style={{
                    border: 'none', borderRadius: '8px', padding: '0.25rem 0.6rem', fontSize: '0.74rem',
                    fontWeight: matrixCategoryFilter === cat ? 700 : 500, cursor: 'pointer',
                    background: matrixCategoryFilter === cat ? 'var(--primary-blue)' : 'var(--bg-color)',
                    color: matrixCategoryFilter === cat ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Modules Matrix Grid Table */}
            <div style={{
              border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden',
              background: 'var(--bg-card)',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-color)', borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Module / Feature Area
                    </th>
                    <th style={{ padding: '0.75rem 0.8rem', textAlign: 'center', width: '130px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      👁️ View Access
                    </th>
                    <th style={{ padding: '0.75rem 0.8rem', textAlign: 'center', width: '130px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      📖 Read Data
                    </th>
                    <th style={{ padding: '0.75rem 0.8rem', textAlign: 'center', width: '130px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      ✏️ Write / Modify
                    </th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right', width: '120px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Access Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredModulesForMatrix.map((mod) => {
                    const IconComponent = MODULE_ICON_MAP[mod.id] || Building2;
                    const isRootAdmin = selectedRole === 'Admin';
                    const modPerms = isRootAdmin
                      ? { view: true, read: true, write: true, admin: true }
                      : (activeRolePerms[mod.id] || { view: true, read: true, write: false, admin: false });

                    const isFull = modPerms.view && modPerms.read && modPerms.write;
                    const isReadOnly = modPerms.view && modPerms.read && !modPerms.write;
                    const isNoAccess = !modPerms.view && !modPerms.read && !modPerms.write;

                    return (
                      <tr key={mod.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background 0.1s ease' }}>
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                            <div style={{
                              width: '32px', height: '32px', borderRadius: '8px',
                              background: modPerms.view ? 'rgba(59,130,246,0.1)' : 'var(--bg-color)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: modPerms.view ? 'var(--primary-blue)' : 'var(--text-muted)',
                              flexShrink: 0, marginTop: '2px',
                            }}>
                              <IconComponent size={16} />
                            </div>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 700, fontSize: '0.84rem', color: 'var(--text-main)' }}>
                                  {mod.name}
                                </span>
                                <span style={{
                                  fontSize: '0.62rem', fontWeight: 600, padding: '0.08rem 0.35rem', borderRadius: '5px',
                                  background: 'var(--bg-color)', color: 'var(--text-muted)', border: '1px solid var(--border-color)',
                                }}>
                                  {mod.category}
                                </span>
                              </div>
                              <p style={{ margin: '0.15rem 0 0', fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                {mod.description}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* View Switch */}
                        <td style={{ padding: '0.85rem 0.8rem', textAlign: 'center' }}>
                          <button
                            type="button"
                            disabled={isRootAdmin}
                            onClick={() => togglePermission(selectedRole, mod.id, 'view')}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                              padding: '0.3rem 0.6rem', borderRadius: '8px', border: 'none',
                              fontSize: '0.72rem', fontWeight: 700, cursor: isRootAdmin ? 'default' : 'pointer',
                              background: modPerms.view ? 'rgba(5,150,105,0.12)' : 'var(--bg-color)',
                              color: modPerms.view ? '#047857' : 'var(--text-muted)',
                              opacity: isRootAdmin ? 0.85 : 1,
                            }}
                            title={modPerms.view ? 'Visible in sidebar & routable' : 'Hidden from sidebar'}
                          >
                            {modPerms.view ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                            {modPerms.view ? 'Enabled' : 'Hidden'}
                          </button>
                        </td>

                        {/* Read Switch */}
                        <td style={{ padding: '0.85rem 0.8rem', textAlign: 'center' }}>
                          <button
                            type="button"
                            disabled={isRootAdmin}
                            onClick={() => togglePermission(selectedRole, mod.id, 'read')}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                              padding: '0.3rem 0.6rem', borderRadius: '8px', border: 'none',
                              fontSize: '0.72rem', fontWeight: 700, cursor: isRootAdmin ? 'default' : 'pointer',
                              background: modPerms.read ? 'rgba(59,130,246,0.12)' : 'var(--bg-color)',
                              color: modPerms.read ? '#1d4ed8' : 'var(--text-muted)',
                              opacity: isRootAdmin ? 0.85 : 1,
                            }}
                            title={modPerms.read ? 'Can read records and tables' : 'Restricted read'}
                          >
                            {modPerms.read ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                            {modPerms.read ? 'Allowed' : 'Denied'}
                          </button>
                        </td>

                        {/* Write Switch */}
                        <td style={{ padding: '0.85rem 0.8rem', textAlign: 'center' }}>
                          <button
                            type="button"
                            disabled={isRootAdmin}
                            onClick={() => togglePermission(selectedRole, mod.id, 'write')}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                              padding: '0.3rem 0.6rem', borderRadius: '8px', border: 'none',
                              fontSize: '0.72rem', fontWeight: 700, cursor: isRootAdmin ? 'default' : 'pointer',
                              background: modPerms.write ? 'rgba(79,70,229,0.12)' : 'var(--bg-color)',
                              color: modPerms.write ? '#4f46e5' : 'var(--text-muted)',
                              opacity: isRootAdmin ? 0.85 : 1,
                            }}
                            title={modPerms.write ? 'Can create, edit and delete data' : 'Read-only access'}
                          >
                            {modPerms.write ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                            {modPerms.write ? 'Editable' : 'No Edit'}
                          </button>
                        </td>

                        {/* Summary Pill */}
                        <td style={{ padding: '0.85rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {isFull ? (
                            <span style={{
                              fontSize: '0.68rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '6px',
                              background: 'rgba(5,150,105,0.12)', color: '#047857',
                            }}>
                              Full Access
                            </span>
                          ) : isReadOnly ? (
                            <span style={{
                              fontSize: '0.68rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '6px',
                              background: 'rgba(59,130,246,0.12)', color: '#1d4ed8',
                            }}>
                              Read Only
                            </span>
                          ) : isNoAccess ? (
                            <span style={{
                              fontSize: '0.68rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '6px',
                              background: 'rgba(239,68,68,0.12)', color: '#b91c1c',
                            }}>
                              No Access
                            </span>
                          ) : (
                            <span style={{
                              fontSize: '0.68rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '6px',
                              background: 'rgba(245,158,11,0.14)', color: '#b45309',
                            }}>
                              Custom
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Bottom Save Action Bar */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem',
              padding: '1rem', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <ShieldCheck size={16} style={{ color: 'var(--primary-blue)' }} />
                <span>
                  Permissions update dynamically across user sessions and are verified on every page view.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setRolePermissionsDraft(rolePermissions || DEFAULT_ROLE_PERMISSIONS)}
                  disabled={savingPerms}
                >
                  <RotateCcw size={13} /> Reset Draft
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveRolePermissions}
                  disabled={savingPerms || selectedRole === 'Admin'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 1rem' }}
                >
                  {savingPerms ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                  <span>Save Role Permissions</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: USER ACCESS INSPECTOR                                              */}
        {/* ========================================================================= */}
        {activeTab === 'inspector' && (
          <div style={{ display: 'grid', gap: '1.25rem', padding: '1.25rem' }}>
            {/* Inspector Header & User Selector */}
            <div style={{
              background: 'var(--bg-color)', borderRadius: '12px', padding: '1.25rem',
              border: '1px solid var(--border-color)', display: 'grid', gap: '1rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <KeyRound size={18} style={{ color: '#059669' }} />
                    <span>User Access Inspector</span>
                  </h3>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    Inspect resolved View, Read, and Write access for any specific user in the system.
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <label htmlFor="inspector-user-select" style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Select User:
                  </label>
                  <select
                    id="inspector-user-select"
                    className="modal-select-field"
                    value={inspectedUser?.id || ''}
                    onChange={(e) => setInspectorUserId(e.target.value)}
                    style={{ minWidth: '220px', fontWeight: 600 }}
                  >
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullname || u.username} ({u.role}) — {u.email}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Inspected User Profile Banner */}
              {inspectedUser && (
                <div style={{
                  background: 'var(--bg-card)', borderRadius: '10px', padding: '1rem',
                  border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    <div style={{
                      width: '42px', height: '42px', borderRadius: '50%',
                      background: ROLE_STYLE[inspectedUser.role]?.bg || 'rgba(59,130,246,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 800, fontSize: '1rem', color: ROLE_STYLE[inspectedUser.role]?.color || 'var(--primary-blue)',
                    }}>
                      {(inspectedUser.fullname || inspectedUser.username || '?')[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                          {inspectedUser.fullname || inspectedUser.username}
                        </span>
                        <span style={{
                          fontSize: '0.68rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: '6px',
                          background: ROLE_STYLE[inspectedUser.role]?.bg, color: ROLE_STYLE[inspectedUser.role]?.color,
                        }}>
                          {inspectedUser.role}
                        </span>
                        <span style={{
                          fontSize: '0.68rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: '6px',
                          background: inspectedUser.status === 'Active' ? 'rgba(5,150,105,0.12)' : 'rgba(239,68,68,0.12)',
                          color: inspectedUser.status === 'Active' ? '#047857' : '#b91c1c',
                        }}>
                          {inspectedUser.status}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        <span><strong>Username:</strong> {inspectedUser.username}</span>
                        <span>·</span>
                        <span><strong>Email:</strong> {inspectedUser.email}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-muted)' }}>
                        Modules Accessible
                      </div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)' }}>
                        {APP_MODULES.filter((m) => inspectedPermissions[m.id]?.view).length} / {APP_MODULES.length}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-muted)' }}>
                        Write Permissions
                      </div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#4f46e5' }}>
                        {APP_MODULES.filter((m) => inspectedPermissions[m.id]?.write).length} modules
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Filter Search */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div style={{ position: 'relative', width: '280px' }}>
                <Search size={14} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  className="modal-input-field field-compact"
                  style={{ width: '100%', paddingLeft: '1.9rem' }}
                  placeholder="Filter modules in inspector..."
                  value={inspectorSearch}
                  onChange={(e) => setInspectorSearch(e.target.value)}
                />
              </div>

              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                Showing effective access rights for <strong>{inspectedUser?.username}</strong>
              </div>
            </div>

            {/* Matrix of Effective User Permissions */}
            <div style={{
              border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden',
              background: 'var(--bg-card)',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-color)', borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Module / Feature Area
                    </th>
                    <th style={{ padding: '0.75rem 0.8rem', textAlign: 'center', width: '120px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      👁️ View Access
                    </th>
                    <th style={{ padding: '0.75rem 0.8rem', textAlign: 'center', width: '120px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      📖 Read Data
                    </th>
                    <th style={{ padding: '0.75rem 0.8rem', textAlign: 'center', width: '120px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      ✏️ Write / Modify
                    </th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right', width: '140px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Permission Source
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredModulesForInspector.map((mod) => {
                    const IconComponent = MODULE_ICON_MAP[mod.id] || Building2;
                    const perms = inspectedPermissions[mod.id] || { view: false, read: false, write: false };
                    const isRoot = inspectedUser?.role === 'Admin';

                    return (
                      <tr key={mod.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                            <div style={{
                              width: '32px', height: '32px', borderRadius: '8px',
                              background: perms.view ? 'rgba(5,150,105,0.1)' : 'var(--bg-color)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: perms.view ? '#059669' : 'var(--text-muted)',
                              flexShrink: 0, marginTop: '2px',
                            }}>
                              <IconComponent size={16} />
                            </div>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span style={{ fontWeight: 700, fontSize: '0.84rem' }}>{mod.name}</span>
                                <span style={{
                                  fontSize: '0.62rem', fontWeight: 600, padding: '0.08rem 0.35rem', borderRadius: '5px',
                                  background: 'var(--bg-color)', color: 'var(--text-muted)', border: '1px solid var(--border-color)',
                                }}>
                                  {mod.category}
                                </span>
                              </div>
                              <p style={{ margin: '0.15rem 0 0', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                                {mod.description}
                              </p>
                            </div>
                          </div>
                        </td>

                        <td style={{ padding: '0.85rem 0.8rem', textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                            fontSize: '0.72rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '6px',
                            background: perms.view ? 'rgba(5,150,105,0.12)' : 'rgba(239,68,68,0.12)',
                            color: perms.view ? '#047857' : '#b91c1c',
                          }}>
                            {perms.view ? <Check size={12} /> : <X size={12} />}
                            {perms.view ? 'Allowed' : 'Restricted'}
                          </span>
                        </td>

                        <td style={{ padding: '0.85rem 0.8rem', textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                            fontSize: '0.72rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '6px',
                            background: perms.read ? 'rgba(59,130,246,0.12)' : 'rgba(239,68,68,0.12)',
                            color: perms.read ? '#1d4ed8' : '#b91c1c',
                          }}>
                            {perms.read ? <Check size={12} /> : <X size={12} />}
                            {perms.read ? 'Allowed' : 'Denied'}
                          </span>
                        </td>

                        <td style={{ padding: '0.85rem 0.8rem', textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                            fontSize: '0.72rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '6px',
                            background: perms.write ? 'rgba(79,70,229,0.12)' : 'var(--bg-color)',
                            color: perms.write ? '#4f46e5' : 'var(--text-muted)',
                          }}>
                            {perms.write ? <Check size={12} /> : <X size={12} />}
                            {perms.write ? 'Editable' : 'Read Only'}
                          </span>
                        </td>

                        <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontSize: '0.74rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {isRoot ? (
                            <span style={{ color: '#b91c1c', fontWeight: 700 }}>Root Admin</span>
                          ) : (
                            <span>Role ({inspectedUser?.role})</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
