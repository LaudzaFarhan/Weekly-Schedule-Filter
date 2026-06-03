'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../services/firebase';
import { logActivity } from '../services/activityService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Track when a user closes the tab
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

  const login = async (username, password) => {
    let email = username;
    if (!email.includes('@')) {
      email = `${username}@schedule.local`;
    }
    const res = await signInWithEmailAndPassword(auth, email, password);
    logActivity(res.user.email, 'logged in');
    return res;
  };

  const logout = () => {
    if (user?.email) {
      logActivity(user.email, 'logged out');
    }
    return signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
