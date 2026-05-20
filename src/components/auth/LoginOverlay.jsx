'use client';

import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Lock, User, Eye, EyeOff } from 'lucide-react';

export default function LoginOverlay() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('Please enter both username and password.');
      return;
    }

    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      if (
        err.code === 'auth/invalid-credential' ||
        err.code === 'auth/user-not-found' ||
        err.code === 'auth/wrong-password'
      ) {
        setError('Invalid username or password.');
      } else if (err.code === 'auth/invalid-api-key') {
        setError('Firebase is not configured correctly.');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-login-overlay">
      {/* Animated background blobs */}
      <div className="glass-bg-blob blob-1"></div>
      <div className="glass-bg-blob blob-2"></div>
      <div className="glass-bg-blob blob-3"></div>
      <div className="glass-bg-blob blob-4"></div>
      <div className="glass-bg-blob blob-5"></div>

      {/* Glass card */}
      <div className="glass-login-card">
        <div className="glass-login-header">
          <div className="glass-logo-icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="rgba(255,255,255,0.15)"/>
              <path d="M8 16L14 10L20 16L26 10" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 22L14 16L20 22L26 16" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2>Pulse</h2>
        </div>

        <h3 className="glass-login-title">Login</h3>

        <form onSubmit={handleSubmit} className="glass-login-form">
          <div className="glass-input-group">
            <label htmlFor="login-username">Email</label>
            <div className="glass-input-wrapper">
              <User size={16} className="glass-input-icon" />
              <input
                type="text"
                id="login-username"
                placeholder="username@gmail.com"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
          </div>

          <div className="glass-input-group">
            <label htmlFor="login-password">Password</label>
            <div className="glass-input-wrapper">
              <Lock size={16} className="glass-input-icon" />
              <input
                type={showPassword ? 'text' : 'password'}
                id="login-password"
                placeholder="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="glass-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="glass-forgot">
            <span>Forgot Password?</span>
          </div>

          {error && <div className="glass-login-error">{error}</div>}

          <button type="submit" className="glass-login-btn" disabled={loading}>
            {loading ? (
              <span className="glass-btn-loading">
                <span className="glass-spinner"></span>
                Authenticating...
              </span>
            ) : (
              'Sign in'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
