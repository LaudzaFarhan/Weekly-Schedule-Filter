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
  RefreshCw, Search, ShieldCheck, Trash2, UserPlus, X,
} from 'lucide-react';
import { useToast } from '../components/ui/Toast';

const ROLES = ['Admin', 'SPA', 'EC', 'Instructor', 'Supervisor'];
const STATUSES = ['Active', 'Suspended'];

/** Role colours. Admin is the only one that needs to stand out in a long list. */
const ROLE_STYLE = {
  Admin: { color: '#b91c1c', bg: 'rgba(239,68,68,0.12)' },
  Supervisor: { color: '#a16207', bg: 'rgba(245,158,11,0.14)' },
  SPA: { color: '#0e7490', bg: 'rgba(8,145,178,0.12)' },
  EC: { color: '#6d28d9', bg: 'rgba(109,40,217,0.12)' },
  Instructor: { color: '#1d4ed8', bg: 'rgba(59,130,246,0.12)' },
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

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

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
      if (!term) return true;
      return [user.username, user.email, user.fullname, user.nickname]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(term));
    });
  }, [users, search, roleFilter]);

  const counts = useMemo(() => {
    const out = { total: users.length, instructors: 0, suspended: 0 };
    for (const user of users) {
      if (user.role === 'Instructor') out.instructors += 1;
      if (user.status !== 'Active') out.suspended += 1;
    }
    return out;
  }, [users]);

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
      showToast(err.message, 'error');
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
      showToast(`Password reset to "${body.password}"`, 'success');
      await load();
      setRevealed((prev) => ({ ...prev, [user.id]: body.password }));
    } catch (err) {
      showToast(err.message, 'error');
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
      showToast(
        status === 'Active'
          ? `${user.username} can sign in again`
          : `${user.username} is suspended and signed out everywhere`,
        'success'
      );
      await load();
    } catch (err) {
      showToast(err.message, 'error');
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
      await load();
    } catch (err) {
      showToast(err.message, 'error');
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
      showToast(`Deleted ${user.username}`, 'success');
      await load();
    } catch (err) {
      showToast(err.message, 'error');
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
      showToast(
        editing
          ? `Updated ${body.user.username}`
          : `Created ${body.user.username}${body.temporaryPassword ? ` — password "${body.temporaryPassword}"` : ''}`,
        'success'
      );
      setAdding(false);
      setEditingId(null);
      setDraft(emptyDraft());
      await load();
    } catch (err) {
      showToast(err.message, 'error');
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
      showToast(err.message, 'error');
    } finally {
      setProvisioning(false);
    }
  };

  const runProvision = async () => {
    setProvisioning(true);
    try {
      const res = await fetch('/api/new/users/provision', { method: 'POST' });
      if (!res.ok) throw await errorFrom(res);
      const body = await res.json();
      showToast(body.message, 'success');
      setProvisionPreview(null);
      await load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <div className="dashboard-view">
      <div className="panel" style={{ margin: '0 0 1.25rem' }}>
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Users</h2>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {counts.total} account{counts.total === 1 ? '' : 's'}
              {' · '}{counts.instructors} instructor{counts.instructors === 1 ? '' : 's'}
              {counts.suspended > 0 && ` · ${counts.suspended} suspended`}
              {' · separate from Old Operations'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
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
            <span>
              <strong>EMPLOYEE_CREDENTIAL_KEY is not set on this deployment.</strong> Passwords
              cannot be read, set or checked until it is, so nobody can sign in with these
              accounts. Generate one with <code>openssl rand -base64 32</code> and add it to
              the environment.
            </span>
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
      </div>

      {provisionPreview && (
        <div className="panel" style={{ margin: '0 0 1.25rem' }}>
          <div className="panel-header" style={{ display: 'block' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>
              Accounts for instructors
            </h3>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Usernames come from each instructor&apos;s name. Nothing has been created yet.
            </p>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: '0.8rem' }}>
            {provisionPreview.willCreate.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Every active instructor already has an account. Nothing to do.
              </p>
            ) : (
              <>
                <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.82rem', display: 'grid', gap: '0.2rem' }}>
                  {provisionPreview.willCreate.map((entry) => (
                    <li key={entry.instructorId}>
                      <strong>{entry.username}</strong>
                      <span style={{ color: 'var(--text-muted)' }}> — {entry.name}</span>
                    </li>
                  ))}
                </ul>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  All {provisionPreview.willCreate.length} start with the password{' '}
                  <code>{provisionPreview.defaultPassword}</code> and are asked to change it.
                </p>
              </>
            )}

            {provisionPreview.skipped.length > 0 && (
              <div style={{ fontSize: '0.78rem', color: '#b45309' }}>
                <strong>Skipped {provisionPreview.skipped.length}:</strong>
                <ul style={{ margin: '0.2rem 0 0', paddingLeft: '1.1rem' }}>
                  {provisionPreview.skipped.map((entry) => (
                    <li key={entry.instructorId}>{entry.name || '(no name)'} — {entry.reason}</li>
                  ))}
                </ul>
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
        </div>
      )}

      <div className="panel" style={{ margin: 0 }}>
        <div className="panel-header" style={{ gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
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
            <option value="all">All roles</option>
            {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </div>

        <div className="panel-body table-wrapper">
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '3rem', color: 'var(--text-secondary)' }}>
              <div className="loading-spinner" /> Loading accounts…
            </div>
          ) : errorStatus === 403 ? (
            /*
              Not an error to report — a signpost. The most likely reader of this
              is an Admin who is signed in with their Old Operations (Firebase)
              account and reasonably expects that to be enough. It is not, and
              saying "Forbidden" would leave them with nowhere to go.
            */
            <div style={{ padding: '2.5rem 1.5rem', maxWidth: '520px', margin: '0 auto', textAlign: 'center' }}>
              <ShieldCheck size={28} style={{ color: 'var(--text-muted)', marginBottom: '0.6rem' }} />
              <h3 style={{ margin: '0 0 0.45rem', fontSize: '1rem', fontWeight: 600 }}>
                Sign in with a New Operations account
              </h3>
              <p style={{ margin: '0 0 0.9rem', fontSize: '0.82rem', lineHeight: 1.55, color: 'var(--text-secondary)' }}>
                These accounts are separate from Old Operations. Being an Admin there does not
                make you one here, so this screen needs a New Operations sign-in with the Admin
                role. Sign out, then sign back in with your New Operations username.
              </p>
              <p style={{ margin: '0 0 1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                No account yet? Run{' '}
                <code style={{ fontSize: '0.72rem' }}>node scratch/create_admin.mjs admin &lt;password&gt;</code>{' '}
                once against the database to create the first Admin.
              </p>
              <button type="button" className="btn btn-sm" onClick={load}>
                I have signed in — check again
              </button>
            </div>
          ) : error ? (
            <div style={{ padding: '2rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{error}</p>
              <button type="button" className="btn btn-sm" onClick={load}>Try again</button>
            </div>
          ) : visible.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {users.length === 0
                ? 'No accounts yet. Use "Accounts for instructors" to create one for everybody at once.'
                : 'No account matches that search.'}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Username', 'Name', 'Role', 'Password', 'Status', ''].map((heading, i) => (
                    <th
                      key={heading || `actions-${i}`}
                      scope="col"
                      style={{
                        textAlign: heading === '' ? 'right' : 'left',
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
                  return (
                    <tr key={user.id} style={{ opacity: user.status === 'Active' ? 1 : 0.55 }}>
                      <td style={{ padding: '0.55rem 0.75rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.82rem', fontWeight: 600 }}>
                        {user.username}
                        {user.instructorId != null && (
                          <span
                            title="Generated from the instructor registry"
                            style={{ marginLeft: '0.35rem', fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 500 }}
                          >
                            ·  from registry
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
                            {/* Dots, not the real length: showing that would leak how
                                long the password is to anyone glancing at the screen. */}
                            {shown || (user.hasPassword ? '••••••••' : 'not set')}
                          </code>
                          {user.hasPassword && (
                            <button
                              type="button"
                              onClick={() => toggleReveal(user)}
                              disabled={busy}
                              title={shown ? 'Hide' : 'Show — this read is written to the activity log'}
                              aria-label={shown ? `Hide the password for ${user.username}` : `Show the password for ${user.username}`}
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
                          disabled={busy}
                          title={user.status === 'Active' ? 'Suspend this account' : 'Let this account sign in again'}
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
                        {user.mustChangePassword && user.status === 'Active' && (
                          <span
                            title="Will be asked to choose a new password on next sign-in"
                            style={{ marginLeft: '0.35rem', fontSize: '0.6rem', color: 'var(--text-muted)' }}
                          >
                            must change
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem', borderBottom: '1px solid var(--border-color)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', gap: '0.15rem' }}>
                          <button
                            type="button"
                            onClick={() => resetPassword(user)}
                            disabled={busy}
                            title="Reset the password to the shared default for this role"
                            aria-label={`Reset the password for ${user.username}`}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-blue)', padding: '0.2rem', lineHeight: 0 }}
                          >
                            <KeyRound size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(user)}
                            disabled={busy}
                            title="Edit this account"
                            aria-label={`Edit ${user.username}`}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '0.2rem', lineHeight: 0 }}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(user)}
                            disabled={busy}
                            title="Delete this account"
                            aria-label={`Delete ${user.username}`}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '0.2rem', lineHeight: 0 }}
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

        <div style={{
          padding: '0.7rem 1.5rem', borderTop: '1px solid var(--border-color)',
          display: 'flex', gap: '0.4rem', alignItems: 'flex-start',
          fontSize: '0.72rem', color: 'var(--text-muted)',
        }}>
          <ShieldCheck size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Passwords are stored encrypted rather than hashed, so one can be read back for
            somebody who has forgotten theirs. Every read is written to the activity log with
            your name against it. Suspending an account or changing its password ends its
            sessions immediately.
          </span>
        </div>
      </div>
    </div>
  );
}
