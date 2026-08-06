'use client';

import React from 'react';
import { ArrowRight, Lock, ExternalLink } from 'lucide-react';

export default function VercelMigrationNotice() {
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0f172a',
      color: '#f8fafc',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    }}>
      <div style={{
        maxWidth: '540px',
        width: '100%',
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '16px',
        padding: '2.5rem',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        textAlign: 'center',
      }}>
        <div style={{
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          backgroundColor: 'rgba(0, 255, 255, 0.12)',
          border: '1px solid rgba(0, 255, 255, 0.3)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1.5rem',
          color: '#00FFFF',
        }}>
          <ExternalLink size={30} />
        </div>

        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '0.75rem', color: '#ffffff', letterSpacing: '-0.025em' }}>
          We Have Migrated!
        </h1>
        
        <p style={{ fontSize: '0.98rem', color: '#94a3b8', lineHeight: 1.6, marginBottom: '2rem' }}>
          The Lab Operation System has officially moved to our new dedicated portal. Please visit:
        </p>

        <a
          href="https://thelabindonesia.my.id/"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.6rem',
            width: '100%',
            backgroundColor: '#00FFFF',
            color: '#0f172a',
            fontWeight: 700,
            fontSize: '1.05rem',
            padding: '0.85rem 1.5rem',
            borderRadius: '10px',
            textDecoration: 'none',
            transition: 'all 0.2s ease',
            boxShadow: '0 0 25px rgba(0, 255, 255, 0.35)',
            marginBottom: '1.75rem',
          }}
        >
          Go to Official Portal (thelabindonesia.my.id)
          <ArrowRight size={18} />
        </a>

        <div style={{
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          border: '1px solid #334155',
          borderRadius: '10px',
          padding: '1.1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.85rem',
          textAlign: 'left',
        }}>
          <Lock size={22} style={{ color: '#00FFFF', flexShrink: 0 }} />
          <div style={{ fontSize: '0.88rem', color: '#cbd5e1', lineHeight: 1.45 }}>
            <strong style={{ color: '#ffffff' }}>Please contact the admin for login</strong>
            <br />
            Reach out to your system administrator to receive your credentials for the new portal.
          </div>
        </div>
      </div>
    </div>
  );
}
