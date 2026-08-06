'use client';

import { useState, useEffect, useRef } from 'react';
import {
  X, Play, Pause, PanelLeft, Calendar, Users, Sparkles, ArrowRight,
  CheckCircle2, Lightbulb, Compass, ChevronRight, Filter, BookOpen, Clock, ShieldCheck,
} from 'lucide-react';

/**
 * AnimationTutorialModal
 *
 * Interactive Animated Tutorial covering:
 * 1. Hide & Show Sidebar
 * 2. Flow of Trial Class -> Check Trial Availability
 * 3. During Trial -> Parent Schedule Request -> Unallocated Students & Day Recommendation
 */
export default function AnimationTutorialModal({ isOpen, onClose, onToggleSidebar, onNavigate }) {
  const [activeTab, setActiveTab] = useState(0); // 0: Sidebar, 1: Trial Flow, 2: Recommendation Day
  const [isPlaying, setIsPlaying] = useState(true);
  const [animFrame, setAnimFrame] = useState(0);

  // Auto-advance frames for the active animation scene
  useEffect(() => {
    if (!isOpen || !isPlaying) return undefined;
    const interval = setInterval(() => {
      setAnimFrame((prev) => (prev + 1) % 4);
    }, 2800);
    return () => clearInterval(interval);
  }, [isOpen, isPlaying, activeTab]);

  // Reset frame when tab changes
  const handleTabChange = (idx) => {
    setActiveTab(idx);
    setAnimFrame(0);
    setIsPlaying(true);
  };

  if (!isOpen) return null;

  const TUTORIAL_TABS = [
    {
      id: 'sidebar',
      title: 'Hide & Show Sidebar',
      shortTitle: '1. Sidebar Toggle',
      icon: PanelLeft,
      badge: 'Screen Space',
      badgeColor: '#3b82f6',
    },
    {
      id: 'trial-flow',
      title: 'Flow of Trial Class',
      shortTitle: '2. Trial Availability',
      icon: Calendar,
      badge: 'Booking Flow',
      badgeColor: '#f59e0b',
    },
    {
      id: 'recommendation',
      title: 'Parent Request & Day Recommendation',
      shortTitle: '3. Recommended Day',
      icon: Sparkles,
      badge: 'Smart Placement',
      badgeColor: '#10b981',
    },
  ];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.72)', backdropFilter: 'blur(8px)',
        padding: '1rem',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-modal-title"
    >
      <div
        style={{
          width: '100%', maxWidth: '860px', maxHeight: '90vh',
          background: 'var(--card-bg, #ffffff)', borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'fadeInModal 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color, #e2e8f0)',
            background: 'linear-gradient(135deg, rgba(59,130,246,0.06) 0%, rgba(99,102,241,0.06) 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div
              style={{
                width: '36px', height: '36px', borderRadius: '10px',
                background: 'var(--primary-blue, #3b82f6)', color: '#ffffff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
              }}
            >
              <Compass size={20} />
            </div>
            <div>
              <h2
                id="tutorial-modal-title"
                style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main, #0f172a)', margin: 0, lineHeight: 1.2 }}
              >
                Animation Tutorial
              </h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted, #64748b)', margin: 0 }}>
                Interactive visual walkthrough for core operational workflows
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color, #cbd5e1)',
                background: 'var(--panel-bg, #ffffff)', color: 'var(--text-secondary, #334155)',
                fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer',
              }}
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              {isPlaying ? 'Pause' : 'Play'}
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.45rem', borderRadius: '8px', border: 'none',
                background: 'transparent', color: 'var(--text-muted, #64748b)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              aria-label="Close tutorial modal"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex', gap: '0.5rem', padding: '0.75rem 1.5rem',
            background: 'var(--panel-bg, #f8fafc)', borderBottom: '1px solid var(--border-color, #e2e8f0)',
            overflowX: 'auto',
          }}
        >
          {TUTORIAL_TABS.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = activeTab === idx;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(idx)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.55rem 0.95rem', borderRadius: '10px', fontSize: '0.82rem', fontWeight: 600,
                  cursor: 'pointer', border: '1px solid',
                  borderColor: isActive ? 'var(--primary-blue, #3b82f6)' : 'transparent',
                  background: isActive ? 'var(--card-bg, #ffffff)' : 'transparent',
                  color: isActive ? 'var(--primary-blue, #3b82f6)' : 'var(--text-secondary, #475569)',
                  boxShadow: isActive ? '0 2px 8px rgba(0, 0, 0, 0.06)' : 'none',
                  whiteSpace: 'nowrap', transition: 'all 0.15s ease-in-out',
                }}
              >
                <Icon size={16} style={{ color: isActive ? 'var(--primary-blue, #3b82f6)' : tab.badgeColor }} />
                {tab.shortTitle}
              </button>
            );
          })}
        </div>

        {/* Modal Body / Active Animation Scene */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
          {activeTab === 0 && (
            <SidebarTutorialScene
              animFrame={animFrame}
              onToggleSidebar={onToggleSidebar}
            />
          )}

          {activeTab === 1 && (
            <TrialFlowTutorialScene
              animFrame={animFrame}
              onNavigate={onNavigate}
            />
          )}

          {activeTab === 2 && (
            <RecommendationTutorialScene
              animFrame={animFrame}
              onNavigate={onNavigate}
            />
          )}
        </div>

        {/* Footer Bar */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color, #e2e8f0)',
            background: 'var(--panel-bg, #f8fafc)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {TUTORIAL_TABS.map((_, idx) => (
              <span
                key={idx}
                onClick={() => handleTabChange(idx)}
                style={{
                  width: activeTab === idx ? '24px' : '8px', height: '8px', borderRadius: '4px',
                  background: activeTab === idx ? 'var(--primary-blue, #3b82f6)' : 'var(--border-color, #cbd5e1)',
                  cursor: 'pointer', transition: 'all 0.2s ease-in-out',
                }}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.6rem' }}>
            {activeTab > 0 && (
              <button
                type="button"
                onClick={() => handleTabChange(activeTab - 1)}
                style={{
                  padding: '0.45rem 0.9rem', borderRadius: '8px', border: '1px solid var(--border-color, #cbd5e1)',
                  background: 'var(--card-bg, #ffffff)', color: 'var(--text-secondary, #334155)',
                  fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Previous
              </button>
            )}

            {activeTab < TUTORIAL_TABS.length - 1 ? (
              <button
                type="button"
                onClick={() => handleTabChange(activeTab + 1)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                  padding: '0.45rem 1rem', borderRadius: '8px', border: 'none',
                  background: 'var(--primary-blue, #3b82f6)', color: '#ffffff',
                  fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(59, 130, 246, 0.3)',
                }}
              >
                Next Tutorial <ArrowRight size={15} />
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                  padding: '0.45rem 1rem', borderRadius: '8px', border: 'none',
                  background: '#10b981', color: '#ffffff',
                  fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(16, 185, 129, 0.3)',
                }}
              >
                <CheckCircle2 size={15} /> Got it, thanks!
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* SCENE 1: HIDE & SHOW SIDEBAR                                              */
/* ========================================================================== */
function SidebarTutorialScene({ animFrame, onToggleSidebar }) {
  const isCollapsed = animFrame % 2 === 1;

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main, #0f172a)', margin: '0 0 0.35rem' }}>
          Hide & Show Navigation Sidebar
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #475569)', margin: 0 }}>
          Expand your workspace to fit all 7 weekday columns on the Schedule Grid by toggling the sidebar.
        </p>
      </div>

      {/* Animation Canvas */}
      <div
        style={{
          height: '240px', borderRadius: '12px', border: '1px solid var(--border-color, #cbd5e1)',
          background: '#0f172a', position: 'relative', overflow: 'hidden',
          display: 'flex', marginBottom: '1.25rem', boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.4)',
        }}
      >
        {/* Animated Sidebar */}
        <div
          style={{
            width: isCollapsed ? '50px' : '180px', height: '100%',
            background: '#1e293b', borderRight: '1px solid #334155',
            padding: '0.75rem 0.5rem', transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
            display: 'flex', flexDirection: 'column', gap: '0.5rem', flexShrink: 0,
          }}
        >
          {/* Header icon */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid #334155' }}>
            <div style={{ width: '20px', height: '20px', borderRadius: '4px', background: '#3b82f6' }} />
            {!isCollapsed && <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f8fafc' }}>THE LAB</span>}
          </div>
          {/* Nav Items */}
          {['Schedule', 'Students', 'Trial Checker', 'Workload'].map((item, i) => (
            <div
              key={item}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.4rem 0.5rem', borderRadius: '6px',
                background: i === 0 ? 'rgba(59,130,246,0.2)' : 'transparent',
                color: i === 0 ? '#60a5fa' : '#94a3b8',
                fontSize: '0.72rem', fontWeight: 600,
              }}
            >
              <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: i === 0 ? '#3b82f6' : '#64748b' }} />
              {!isCollapsed && <span>{item}</span>}
            </div>
          ))}
        </div>

        {/* Animated Main Content Area */}
        <div style={{ flex: 1, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {/* Top Navbar Simulation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0.6rem', background: '#1e293b', borderRadius: '6px' }}>
            <div
              style={{
                padding: '0.2rem 0.4rem', borderRadius: '4px', background: isCollapsed ? '#3b82f6' : '#334155',
                color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center',
                boxShadow: isCollapsed ? '0 0 10px rgba(59,130,246,0.6)' : 'none',
                transition: 'all 0.3s ease',
              }}
            >
              <PanelLeft size={14} />
            </div>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>
              {isCollapsed ? 'Sidebar Hidden (Full Screen Grid)' : 'Sidebar Expanded'}
            </span>
          </div>

          {/* Schedule Grid Simulation */}
          <div style={{ flex: 1, background: '#1e293b', borderRadius: '6px', padding: '0.5rem', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.3rem' }}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, idx) => (
              <div key={d} style={{ background: '#0f172a', borderRadius: '4px', padding: '0.3rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#94a3b8', textAlign: 'center' }}>{d}</span>
                <div style={{ height: '30px', borderRadius: '3px', background: idx % 3 === 0 ? 'rgba(253,224,71,0.2)' : idx % 3 === 1 ? 'rgba(56,189,248,0.2)' : 'rgba(30,58,138,0.8)', border: '1px solid rgba(255,255,255,0.1)' }} />
                <div style={{ height: '40px', borderRadius: '3px', background: idx % 2 === 0 ? 'rgba(56,189,248,0.2)' : 'rgba(253,224,71,0.2)', border: '1px solid rgba(255,255,255,0.1)' }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Steps List & Action */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
            <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(59,130,246,0.12)', color: '#3b82f6', fontSize: '0.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>1</span>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary, #334155)' }}>
              Click top-left <strong>Panel Toggle icon</strong> (<PanelLeft size={13} style={{ display: 'inline', verticalAlign: 'middle' }} />) to hide or show the sidebar.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
            <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(59,130,246,0.12)', color: '#3b82f6', fontSize: '0.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>2</span>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary, #334155)' }}>
              Use keyboard shortcut <kbd style={{ padding: '0.1rem 0.3rem', background: 'var(--panel-bg, #f1f5f9)', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.7rem' }}>Ctrl + B</kbd> or <kbd style={{ padding: '0.1rem 0.3rem', background: 'var(--panel-bg, #f1f5f9)', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.7rem' }}>Cmd + B</kbd> anytime.
            </span>
          </div>
        </div>

        <div style={{ background: 'var(--panel-bg, #f8fafc)', padding: '0.9rem', borderRadius: '10px', border: '1px solid var(--border-color, #e2e8f0)', textAlign: 'center' }}>
          <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main, #0f172a)', margin: '0 0 0.5rem' }}>
            Interactive Demo Action
          </p>
          <button
            type="button"
            onClick={onToggleSidebar}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.5rem 1rem', borderRadius: '8px', border: 'none',
              background: 'var(--primary-blue, #3b82f6)', color: '#ffffff',
              fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(59,130,246,0.3)',
            }}
          >
            <PanelLeft size={15} /> Toggle Real Sidebar Now
          </button>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* SCENE 2: TRIAL CLASS FLOW -> CHECK AVAILABILITY                            */
/* ========================================================================== */
function TrialFlowTutorialScene({ animFrame, onNavigate }) {
  const activeStep = animFrame % 4;

  const STEPS = [
    { title: '1. Parent Requests Trial', desc: 'Parent inquires about a trial class for Kinder, Junior, or Coder level.' },
    { title: '2. Check Trial Availability', desc: 'Open Trial Checker to filter branch, day, and preferred time slot.' },
    { title: '3. Review Capacity', desc: 'Check instructor capabilities and maximum student capacity limits.' },
    { title: '4. Book Trial Class', desc: 'Confirm trial slot and assign student record into the weekly schedule.' },
  ];

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main, #0f172a)', margin: '0 0 0.35rem' }}>
          Trial Class Booking & Availability Checker
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #475569)', margin: 0 }}>
          Follow the 4-step workflow to check available trial slots and book incoming trial students cleanly.
        </p>
      </div>

      {/* Animation Stepper Canvas */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          borderRadius: '12px', padding: '1.25rem', marginBottom: '1.25rem',
          border: '1px solid #334155', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}
      >
        {/* Flow Diagram */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '1.25rem' }}>
          {STEPS.map((s, idx) => {
            const isActive = activeStep === idx;
            const isDone = activeStep > idx;
            return (
              <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem', position: 'relative' }}>
                <div
                  style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    background: isActive ? '#f59e0b' : isDone ? '#10b981' : '#334155',
                    color: '#ffffff', fontSize: '0.8rem', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: isActive ? '0 0 12px rgba(245, 158, 11, 0.6)' : 'none',
                    transition: 'all 0.3s ease',
                  }}
                >
                  {isDone ? <CheckCircle2 size={16} /> : idx + 1}
                </div>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: isActive ? '#fbbf24' : isDone ? '#34d399' : '#94a3b8', textAlign: 'center', lineHeight: 1.1 }}>
                  {s.title.split('. ')[1]}
                </span>
              </div>
            );
          })}
        </div>

        {/* Step Detail Animated Preview Card */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '1rem',
            border: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', alignItems: 'center', gap: '1rem',
          }}
        >
          <div
            style={{
              width: '44px', height: '44px', borderRadius: '10px',
              background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <Calendar size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fbbf24' }}>
              Step {activeStep + 1} of 4
            </span>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc', margin: '0.1rem 0 0.2rem' }}>
              {STEPS[activeStep].title}
            </h4>
            <p style={{ fontSize: '0.8rem', color: '#cbd5e1', margin: 0 }}>
              {STEPS[activeStep].desc}
            </p>
          </div>
        </div>
      </div>

      {/* Quick Action */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => onNavigate?.('trial-availability')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
            padding: '0.5rem 1.1rem', borderRadius: '8px', border: 'none',
            background: '#f59e0b', color: '#ffffff',
            fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)',
          }}
        >
          <Calendar size={15} /> Check Trial Availability Now <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* SCENE 3: PARENT REQUEST -> UNALLOCATED STUDENTS & DAY RECOMMENDATION       */
/* ========================================================================== */
function RecommendationTutorialScene({ animFrame, onNavigate }) {
  const currentStage = animFrame % 3;

  const STAGES = [
    {
      title: 'Stage 1: Parent Asks Schedule',
      subtitle: 'During or after trial, parent inquires: "What days are open for regular classes?"',
      icon: Users,
      highlight: 'Parent Inquiry',
      color: '#3b82f6',
    },
    {
      title: 'Stage 2: Check Unallocated Students Sidebar',
      subtitle: 'Open the right sidebar on Schedule Grid to view unscheduled students and their requested slots.',
      icon: Filter,
      highlight: 'Unallocated Students Sidebar',
      color: '#8b5cf6',
    },
    {
      title: 'Stage 3: Recommendation Day Engine',
      subtitle: 'System analyzes instructor availability and suggests the optimal Recommendation Day for the student.',
      icon: Sparkles,
      highlight: 'Recommendation Day Engine',
      color: '#10b981',
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main, #0f172a)', margin: '0 0 0.35rem' }}>
          Parent Schedule Request & Smart Recommendation Day
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #475569)', margin: 0 }}>
          How to quickly answer parents, check unallocated students, and find the recommended class day.
        </p>
      </div>

      {/* Interactive Animation Visualizer */}
      <div
        style={{
          background: '#0f172a', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.25rem',
          border: '1px solid #334155', position: 'relative', overflow: 'hidden',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
          {STAGES.map((st, idx) => {
            const Icon = st.icon;
            const isCurrent = currentStage === idx;
            return (
              <div
                key={idx}
                style={{
                  background: isCurrent ? 'rgba(30, 41, 59, 0.9)' : 'rgba(15, 23, 42, 0.6)',
                  borderRadius: '10px', padding: '0.85rem', border: '1px solid',
                  borderColor: isCurrent ? st.color : '#334155',
                  boxShadow: isCurrent ? `0 0 16px ${st.color}44` : 'none',
                  transition: 'all 0.3s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                  <Icon size={16} style={{ color: st.color }} />
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: isCurrent ? '#f8fafc' : '#94a3b8' }}>
                    {st.highlight}
                  </span>
                </div>
                <p style={{ fontSize: '0.68rem', color: '#cbd5e1', margin: 0, lineHeight: 1.3 }}>
                  {st.subtitle}
                </p>
              </div>
            );
          })}
        </div>

        {/* Live Recommendation Badge Demonstration */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(59, 130, 246, 0.15) 100%)',
            borderRadius: '8px', padding: '0.9rem 1.1rem', border: '1px solid rgba(16, 185, 129, 0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Sparkles size={20} style={{ color: '#10b981' }} />
            <div>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#34d399', textTransform: 'uppercase' }}>
                Recommendation Engine Output
              </span>
              <h5 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#ffffff', margin: '0.1rem 0 0' }}>
                Recommended Day: <span style={{ color: '#fef08a' }}>Wednesday 2:30 PM - 4:30 PM</span> (Instructor: Iqbal)
              </h5>
            </div>
          </div>
          <span style={{ padding: '0.3rem 0.7rem', borderRadius: '6px', background: '#10b981', color: '#ffffff', fontSize: '0.75rem', fontWeight: 700 }}>
            Optimal Fit
          </span>
        </div>
      </div>

      {/* Action to jump to Schedule Grid */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => onNavigate?.('schedule')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
            padding: '0.5rem 1.1rem', borderRadius: '8px', border: 'none',
            background: '#10b981', color: '#ffffff',
            fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
          }}
        >
          <Sparkles size={15} /> Open Schedule Grid & Unallocated List <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
