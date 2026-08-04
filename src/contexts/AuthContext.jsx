'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../services/firebase';
import { logActivity } from '../services/activityService';

const AuthContext = createContext(null);

/**
 * Two identity sources, on purpose.
 *
 * New Operations accounts live in PostgreSQL (`internal_users`) and are separate
 * from the Firebase accounts Old Operations has always used — the same person can
 * exist in one, the other, or both, and one does not imply the other.
 *
 * Both are supported at once rather than swapping one for the other. Cutting over
 * in a single step would lock out everybody who has a Firebase account and no
 * PostgreSQL one, which right now is everybody. Login tries PostgreSQL first and
 * falls back to Firebase, so instructor accounts work the moment they are created
 * and nothing that worked yesterday stops working.
 *
 * `user` is normalised to one shape so nothing downstream has to care which
 * source it came from. `user.source` is there for the cases that genuinely do.
 */

/** A PostgreSQL account, in the shape the rest of the app expects of `user`. */
function normalisePgUser(payload) {
  if (!payload?.user) return null;
  const { user } = payload;
  return {
    // Prefixed so it can never collide with a Firebase uid, and so a stray
    // comparison against one fails loudly rather than matching by accident.
    uid: `pg:${user.id}`,
    email: user.email,
    displayName: user.displayName || user.username,
    username: user.username,
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    source: 'postgres',
  };
}

export function AuthProvider({ children }) {
  const [pgUser, setPgUser] = useState(null);
  const [firebaseUser, setFirebaseUser] = useState(null);
  // Both sources have to report before the app can decide there is nobody signed
  // in, or a valid session would flash the login screen on every page load.
  const [pgChecked, setPgChecked] = useState(false);
  const [firebaseChecked, setFirebaseChecked] = useState(false);

  /** Ask the server whether this browser still holds a session cookie. */
  const refreshPgSession = useCallback(async () => {
    try {
      const res = await fetch('/api/new/auth/session');
      if (!res.ok) {
        setPgUser(null);
        return null;
      }
      const next = normalisePgUser(await res.json());
      setPgUser(next);
      return next;
    } catch {
      // Offline, or the API is down. Treated as "no PostgreSQL session" so
      // Firebase can still get somebody in.
      setPgUser(null);
      return null;
    } finally {
      setPgChecked(true);
    }
  }, []);

  useEffect(() => { refreshPgSession(); }, [refreshPgSession]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setFirebaseUser(nextUser);
      setFirebaseChecked(true);
    });
    return unsubscribe;
  }, []);

  // A PostgreSQL session wins when both exist: it is the newer system and the one
  // that carries a role, and it is what the user most recently signed in with.
  const user = pgUser || firebaseUser;
  const loading = !pgChecked || !firebaseChecked;

  useEffect(() => {
    const handleUnload = () => {
      if (user?.email) {
        // Fire-and-forget log on unload. Might not always complete before browser kills tab.
        logActivity(user.email, 'closed the tab');
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [user]);

  /**
   * Sign in.
   *
   * PostgreSQL first because that is where new accounts are made, and because a
   * username like `felix.wijaya` is not a Firebase email and would only ever fail
   * there. A 401 falls through to Firebase; anything else — a 503 for a missing
   * credential key, a 403 for a suspended account — is reported as-is, since
   * retrying against Firebase would replace a precise message with a vague one.
   */
  const login = useCallback(async (identifier, password) => {
    const trimmedId = identifier.trim();

    let pgResponse = null;
    try {
      pgResponse = await fetch('/api/new/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: trimmedId, password }),
      });
    } catch {
      // Network failure reaching our own API. Fall through to Firebase rather
      // than blocking a login that might still work.
      pgResponse = null;
    }

    if (pgResponse?.ok) {
      const next = normalisePgUser(await pgResponse.json());
      setPgUser(next);
      setPgChecked(true);
      logActivity(next?.email || trimmedId, 'logged in');
      return { user: next };
    }

    if (pgResponse && pgResponse.status !== 401) {
      const body = await pgResponse.json().catch(() => ({}));
      const error = new Error(body.message || body.error || 'Sign-in failed.');
      error.code = 'pg/rejected';
      throw error;
    }

    // Firebase's own path: a bare username is expanded to the local domain it has
    // always used.
    let email = trimmedId.toLowerCase();
    if (!email.includes('@')) email = `${trimmedId}@schedule.local`;
    const res = await signInWithEmailAndPassword(auth, email, password);
    logActivity(res.user.email, 'logged in');
    return res;
  }, []);

  /** Sign out of both, since only one is active but either may be. */
  const logout = useCallback(async () => {
    if (user?.email) logActivity(user.email, 'logged out');

    if (pgUser) {
      try {
        await fetch('/api/new/auth/session', { method: 'DELETE' });
      } catch {
        // The cookie may already be gone. Clearing local state below is what
        // actually signs them out of this tab.
      }
      setPgUser(null);
    }

    // Always attempted: signing out of a Firebase session that is not there is a
    // no-op, and leaving one behind would sign them straight back in.
    try {
      await signOut(auth);
    } catch {
      /* no Firebase session */
    }
  }, [user, pgUser]);

  const value = useMemo(
    () => ({ user, loading, login, logout, refreshPgSession, isPostgresUser: Boolean(pgUser) }),
    [user, loading, login, logout, refreshPgSession, pgUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
