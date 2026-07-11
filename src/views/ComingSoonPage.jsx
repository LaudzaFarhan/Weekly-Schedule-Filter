'use client';

import React from 'react';
import { Rocket, Sparkles, Shield, Compass, ArrowRight } from 'lucide-react';

export default function ComingSoonPage() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 'calc(100vh - 120px)',
      padding: '2rem',
      color: 'var(--text-main)',
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Background blobs for visual richness */}
      <div style={{
        position: 'absolute',
        width: '300px',
        height: '300px',
        background: 'radial-gradient(circle, rgba(79, 70, 229, 0.12) 0%, rgba(79, 70, 229, 0) 70%)',
        top: '10%',
        left: '20%',
        zIndex: 0,
        pointerEvents: 'none'
      }} />
      <div style={{
        position: 'absolute',
        width: '300px',
        height: '300px',
        background: 'radial-gradient(circle, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0) 70%)',
        bottom: '15%',
        right: '20%',
        zIndex: 0,
        pointerEvents: 'none'
      }} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: '640px', width: '100%' }}>
        {/* Animated Icon Container */}
        <div style={{
          display: 'inline-flex',
          padding: '1.25rem',
          borderRadius: '24px',
          background: 'linear-gradient(135deg, rgba(79, 70, 229, 0.1), rgba(99, 102, 241, 0.05))',
          border: '1px solid rgba(79, 70, 229, 0.2)',
          boxShadow: '0 8px 32px rgba(79, 70, 229, 0.08)',
          marginBottom: '2rem',
          animation: 'float 4s ease-in-out infinite'
        }}>
          <Rocket size={48} style={{ color: 'var(--primary-blue)' }} />
        </div>

        {/* Title */}
        <h1 style={{
          fontFamily: "'Outfit', sans-serif",
          fontSize: '2.5rem',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          marginBottom: '1rem',
          background: 'linear-gradient(135deg, var(--text-main) 30%, #6366f1 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text'
        }}>
          New Operations Portal
        </h1>

        {/* Badge */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.4rem 0.8rem',
          borderRadius: '20px',
          background: 'var(--primary-blue-light)',
          color: 'var(--primary-blue)',
          fontSize: '0.8rem',
          fontWeight: 600,
          marginBottom: '1.5rem'
        }}>
          <Sparkles size={14} />
          COMING SOON
        </div>

        {/* Description */}
        <p style={{
          fontSize: '1.05rem',
          color: 'var(--text-secondary)',
          lineHeight: '1.6',
          marginBottom: '2.5rem',
          padding: '0 1rem'
        }}>
          We are currently designing a brand new operational hub for The Lab. This space will bring together AI-powered schedule optimization, unified client communication, automated instructor matching, and advanced performance analytics.
        </p>

        {/* Feature Cards Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '1.5rem',
          marginBottom: '3rem',
          textAlign: 'left'
        }}>
          <div style={{
            padding: '1.5rem',
            background: 'var(--panel-bg)',
            borderRadius: '16px',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--card-shadow)',
            transition: 'transform 0.2s, border-color 0.2s'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <Shield size={20} style={{ color: 'var(--success)' }} />
              <h4 style={{ fontWeight: 600, margin: 0 }}>Smart Allocations</h4>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.5' }}>
              Next-gen automated booking workflow driven by instructor capacities and skills.
            </p>
          </div>

          <div style={{
            padding: '1.5rem',
            background: 'var(--panel-bg)',
            borderRadius: '16px',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--card-shadow)',
            transition: 'transform 0.2s, border-color 0.2s'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <Compass size={20} style={{ color: 'var(--warning)' }} />
              <h4 style={{ fontWeight: 600, margin: 0 }}>Unified Workspace</h4>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.5' }}>
              An integrated environment merging schedules, CRM, chats, and task management.
            </p>
          </div>
        </div>

        {/* Footer/CTA */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          fontSize: '0.9rem',
          color: 'var(--text-muted)'
        }}>
          <span>Want to explore? Use the switcher above to go back to</span>
          <span style={{ fontWeight: 600, color: 'var(--primary-blue)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
            Old Operations
            <ArrowRight size={14} />
          </span>
        </div>
      </div>
      
      {/* Inline styles for animation keyframes */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
      `}} />
    </div>
  );
}
