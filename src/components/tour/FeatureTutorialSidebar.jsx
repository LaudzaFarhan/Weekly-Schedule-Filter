'use client';

import { useState, useMemo } from 'react';
import {
  X, Search, Compass, PanelLeft, Calendar, BarChart3, Users, Activity,
  Star, FileText, TrendingUp, Sparkles, ChevronRight, Play, CheckCircle2,
  BookOpen, Clock, ShieldCheck, ArrowRight, User, Terminal, HelpCircle, Filter
} from 'lucide-react';
import AnimationTutorialModal from './AnimationTutorialModal';

/**
 * FEATURE_TUTORIALS
 * List of tutorials for all major features in the application.
 */
export const FEATURE_TUTORIALS = [
  {
    id: 'sidebar-space',
    title: 'Hide & Show Sidebar',
    category: 'Getting Started',
    icon: PanelLeft,
    badgeColor: '#3b82f6',
    estimatedTime: '1 min',
    pageId: 'schedule',
    description: 'Toggle the left navigation panel to maximize your screen space when viewing large schedule grids.',
    steps: [
      'Click the PanelLeft icon in the top left header bar.',
      'The sidebar collapses smoothly into mini-icon mode.',
      'Enjoy full-width view for Master Schedule and Workload heatmaps.',
      'Click the icon again anytime to expand the full navigation menu.'
    ]
  },
  {
    id: 'master-schedule',
    title: 'Master Schedule & Class Grid',
    category: 'Schedule',
    icon: Calendar,
    badgeColor: '#6366f1',
    estimatedTime: '2 min',
    pageId: 'schedule',
    description: 'View daily timetable grids, manage class slots, and add replacement/trial sessions.',
    steps: [
      'Select your target Branch and Day from the top filter bar.',
      'Click any class slot to view student lists, teacher assignments, and course levels.',
      'Use the + Add Class button to book new regular, replacement, or trial classes.',
      'Filter view by Regular, Trial, or Replacement session types.'
    ]
  },
  {
    id: 'unallocated-students',
    title: 'Unallocated Students & Recommended Day',
    category: 'Schedule',
    icon: Sparkles,
    badgeColor: '#10b981',
    estimatedTime: '2 min',
    pageId: 'schedule',
    description: 'Identify students needing class slots and use AI recommendations to place them.',
    steps: [
      'Open the Unallocated Students panel on the Master Schedule page.',
      'Students with unassigned schedules or former teachers remain listed here.',
      'Click on a student to calculate the best recommended class days for their branch.',
      'Click "Allocate" to instantly assign them to an active instructor slot.'
    ]
  },
  {
    id: 'slot-checker',
    title: 'Slot Checker & Availability',
    category: 'Schedule',
    icon: Compass,
    badgeColor: '#f59e0b',
    estimatedTime: '2 min',
    pageId: 'availability',
    description: 'Check real-time class capacity and open seats for incoming parent inquiries.',
    steps: [
      'Select the Branch, Program (Kinder/Junior/Coder), and Level.',
      'View available time slots with live seat counts (e.g. 3/6 filled).',
      'Quickly copy open slots to paste directly into parent WhatsApp messages.',
      'Reserve spots for trial leads before final confirmation.'
    ]
  },
  {
    id: 'workload',
    title: 'Instructor Workload & Hours',
    category: 'Staffing',
    icon: BarChart3,
    badgeColor: '#ec4899',
    estimatedTime: '2 min',
    pageId: 'workload',
    description: 'Monitor weekly teaching hours, load heatmaps, and official branch registry alignment.',
    steps: [
      'Filter Workload by Branch to view active teaching staff.',
      'Only instructors registered in the Instructors Registry appear in the workload view.',
      'Check color-coded heatmaps for underloaded or overloaded teachers.',
      'Review total weekly teaching hours and unique student counts per teacher.'
    ]
  },
  {
    id: 'instructors-registry',
    title: 'Instructors Registry & Profiles',
    category: 'Staffing',
    icon: User,
    badgeColor: '#8b5cf6',
    estimatedTime: '2 min',
    pageId: 'profiles',
    description: 'Manage instructor profiles, teaching capabilities, home branches, and aliases.',
    steps: [
      'Navigate to Instructor Profiles to view all teaching staff.',
      'Set home branch allocations, employment types (Full-Time / Part-Time), and contact details.',
      'Add verified aliases so schedule imports automatically map teacher nicknames.',
      'Deactivate former teachers to ensure clean workload reporting.'
    ]
  },
  {
    id: 'leave-management',
    title: 'Leave Management & Coverage',
    category: 'Staffing',
    icon: Activity,
    badgeColor: '#ef4444',
    estimatedTime: '2 min',
    pageId: 'leave',
    description: 'Submit and approve instructor leave requests with substitute cover assignments.',
    steps: [
      'Log leave requests for single or multi-day absences.',
      'View conflicting scheduled classes during the leave period.',
      'Assign substitute cover instructors to prevent unstaffed classes.',
      'Track historical leave records and remaining balances.'
    ]
  },
  {
    id: 'student-database',
    title: 'Student Database & Subscriptions',
    category: 'Students',
    icon: Users,
    badgeColor: '#06b6d4',
    estimatedTime: '2 min',
    pageId: 'students',
    description: 'Manage registered students, parent contact info, levels, and active subscriptions.',
    steps: [
      'Browse and search registered students across all branches.',
      'View student level enrollment (KF1, K1, JF2, J1, Coder).',
      'Check active subscription statuses, payment history, and renewal due dates.',
      'Edit parent WhatsApp contact info for automated notifications.'
    ]
  },
  {
    id: 'crm-leads',
    title: 'CRM Leads & Trial Pipeline',
    category: 'Leads & CRM',
    icon: Filter,
    badgeColor: '#f97316',
    estimatedTime: '2 min',
    pageId: 'crm',
    description: 'Track incoming parent inquiry leads, trial stages, and follow-up schedules.',
    steps: [
      'View leads organized by pipeline stages (New Lead, Contacted, Trial Scheduled, Enrolled).',
      'Use "Input Trial Leads" to quickly add new prospective families.',
      'Set follow-up reminders and log parent communication notes.',
      'Convert successful trial leads directly into registered students.'
    ]
  },
  {
    id: 'trial-priority',
    title: 'Trial Priority Allocation',
    category: 'Leads & CRM',
    icon: Star,
    badgeColor: '#eab308',
    estimatedTime: '1 min',
    pageId: 'trial-priority',
    description: 'Prioritize upcoming trial class bookings across branches for optimal conversion.',
    steps: [
      'Review pending trial class requests sorted by priority level.',
      'Check instructor availability for trial sessions.',
      'Confirm trial slot bookings and notify branch operational leads.',
      'Track trial conversion rates by branch.'
    ]
  },
  {
    id: 'report-cards',
    title: 'Report Cards & Student Rubrics',
    category: 'Reports',
    icon: FileText,
    badgeColor: '#14b8a6',
    estimatedTime: '2 min',
    pageId: 'report-cards',
    description: 'Evaluate student term performance, manage scoring rubrics, and print report cards.',
    steps: [
      'Select student term evaluations in the Report Cards module.',
      'Grade learning objectives using standard level rubrics.',
      'Add personalized instructor feedback and project highlights.',
      'Export and print formatted PDF report cards for parents.'
    ]
  },
  {
    id: 'live-progress',
    title: 'Live Progress Tracker (Kinder/Junior/Coder)',
    category: 'Reports',
    icon: TrendingUp,
    badgeColor: '#3b82f6',
    estimatedTime: '2 min',
    pageId: 'progress-kinder',
    description: 'Monitor real-time student module completion and lesson progress per term.',
    steps: [
      'Select Kinder, Junior, or Coder Live Progress view.',
      'View lesson-by-lesson progress matrices for all active students.',
      'Mark lesson completions as classes finish each week.',
      'Identify students needing extra catch-up sessions.'
    ]
  }
];

export const TUTORIAL_CATEGORIES = ['All', 'Getting Started', 'Schedule', 'Staffing', 'Students', 'Leads & CRM', 'Reports'];

/**
 * FeatureTutorialSidebar Component
 * Slide-out drawer sidebar containing interactive tutorials for all system features.
 */
export default function FeatureTutorialSidebar({ isOpen, onClose, onNavigate, onToggleSidebar }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [activeTutorial, setActiveTutorial] = useState(null); // Tutorial object for step-by-step modal
  const [activeStep, setActiveStep] = useState(0);

  // Filter tutorials by category & search query
  const filteredTutorials = useMemo(() => {
    return FEATURE_TUTORIALS.filter((item) => {
      const matchesCat = selectedCategory === 'All' || item.category === selectedCategory;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch = !q ||
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q);
      return matchesCat && matchesSearch;
    });
  }, [selectedCategory, searchQuery]);

  if (!isOpen) return null;

  const handleStartTutorial = (tut) => {
    setActiveTutorial(tut);
    setActiveStep(0);
  };

  const handleJumpToPage = (pageId) => {
    if (onNavigate && pageId) {
      onNavigate(pageId);
      onClose();
      if (activeTutorial) setActiveTutorial(null);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 9990,
          background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(4px)',
          transition: 'opacity 0.2s ease',
        }}
      />

      {/* Slide-out Sidebar Drawer */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '100%', maxWidth: '440px', zIndex: 9995,
          background: 'var(--card-bg, #ffffff)',
          borderLeft: '1px solid var(--border-color, #e2e8f0)',
          boxShadow: '-10px 0 30px rgba(0, 0, 0, 0.15)',
          display: 'flex', flexDirection: 'column',
          animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border-color, #e2e8f0)',
            background: 'linear-gradient(135deg, rgba(59,130,246,0.06) 0%, rgba(99,102,241,0.06) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div
              style={{
                width: '38px', height: '38px', borderRadius: '12px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
                color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
              }}
            >
              <Compass size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main, #0f172a)', margin: 0 }}>
                Feature Tutorials
              </h2>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-muted, #64748b)', margin: 0 }}>
                Step-by-step guides for all features ({FEATURE_TUTORIALS.length} available)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.4rem', borderRadius: '8px', border: 'none',
              background: 'transparent', color: 'var(--text-muted, #64748b)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Close tutorial sidebar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search Bar & Category Filter */}
        <div
          style={{
            padding: '1rem 1.25rem 0.75rem',
            borderBottom: '1px solid var(--border-color, #e2e8f0)',
            background: 'var(--panel-bg, #f8fafc)',
            display: 'flex', flexDirection: 'column', gap: '0.75rem',
          }}
        >
          {/* Search Input */}
          <div style={{ position: 'relative' }}>
            <Search
              size={16}
              style={{
                position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)',
                color: 'var(--text-muted, #94a3b8)',
              }}
            />
            <input
              type="text"
              placeholder="Search tutorials & features..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%', padding: '0.5rem 0.75rem 0.5rem 2.3rem',
                borderRadius: '10px', border: '1px solid var(--border-color, #cbd5e1)',
                background: 'var(--card-bg, #ffffff)', color: 'var(--text-main, #0f172a)',
                fontSize: '0.82rem', outline: 'none',
              }}
            />
          </div>

          {/* Category Chips */}
          <div
            style={{
              display: 'flex', gap: '0.4rem', overflowX: 'auto', paddingBottom: '0.25rem',
              scrollbarWidth: 'none',
            }}
          >
            {TUTORIAL_CATEGORIES.map((cat) => {
              const isSel = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    padding: '0.35rem 0.7rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600,
                    whiteSpace: 'nowrap', cursor: 'pointer', border: '1px solid',
                    borderColor: isSel ? 'var(--primary-blue, #3b82f6)' : 'var(--border-color, #e2e8f0)',
                    background: isSel ? 'var(--primary-blue, #3b82f6)' : 'var(--card-bg, #ffffff)',
                    color: isSel ? '#ffffff' : 'var(--text-secondary, #475569)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tutorials List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
          {filteredTutorials.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted, #64748b)' }}>
              <HelpCircle size={36} style={{ marginBottom: '0.75rem', opacity: 0.5 }} />
              <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>No tutorials found</p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem' }}>Try searching for a different keyword or category.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {filteredTutorials.map((tut) => {
                const Icon = tut.icon;
                return (
                  <div
                    key={tut.id}
                    style={{
                      padding: '1rem', borderRadius: '12px',
                      background: 'var(--card-bg, #ffffff)',
                      border: '1px solid var(--border-color, #e2e8f0)',
                      boxShadow: '0 2px 6px rgba(0, 0, 0, 0.03)',
                      transition: 'all 0.18s ease-in-out',
                      display: 'flex', flexDirection: 'column', gap: '0.6rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <div
                          style={{
                            width: '34px', height: '34px', borderRadius: '9px',
                            background: `${tut.badgeColor}15`, color: tut.badgeColor,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <Icon size={18} />
                        </div>
                        <div>
                          <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main, #0f172a)', margin: 0, lineHeight: 1.2 }}>
                            {tut.title}
                          </h3>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: tut.badgeColor }}>
                            {tut.category} · {tut.estimatedTime}
                          </span>
                        </div>
                      </div>
                    </div>

                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #475569)', margin: 0, lineHeight: 1.4 }}>
                      {tut.description}
                    </p>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.25rem' }}>
                      <button
                        type="button"
                        onClick={() => handleJumpToPage(tut.pageId)}
                        style={{
                          background: 'none', border: 'none', padding: 0,
                          color: 'var(--text-muted, #64748b)', fontSize: '0.75rem', fontWeight: 600,
                          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem',
                        }}
                      >
                        Open Page <ArrowRight size={12} />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStartTutorial(tut)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                          padding: '0.4rem 0.85rem', borderRadius: '8px',
                          background: 'var(--primary-blue, #3b82f6)', color: '#ffffff',
                          fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', border: 'none',
                          boxShadow: '0 2px 6px rgba(59, 130, 246, 0.25)',
                        }}
                      >
                        <Play size={13} fill="currentColor" /> Start Guide
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '0.9rem 1.25rem',
            borderTop: '1px solid var(--border-color, #e2e8f0)',
            background: 'var(--panel-bg, #f8fafc)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: '0.76rem', color: 'var(--text-muted, #64748b)',
          }}
        >
          <span>Need custom assistance?</span>
          <button
            type="button"
            onClick={() => handleStartTutorial(FEATURE_TUTORIALS[0])}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: 'var(--primary-blue, #3b82f6)', fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '0.25rem',
            }}
          >
            Launch Interactive Tour <Sparkles size={13} />
          </button>
        </div>
      </div>

      {/* Active Step-by-Step Interactive Guide Modal */}
      {activeTutorial && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(8px)',
            padding: '1rem',
          }}
        >
          <div
            style={{
              width: '100%', maxWidth: '580px',
              background: 'var(--card-bg, #ffffff)', borderRadius: '16px',
              border: '1px solid var(--border-color, #e2e8f0)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              animation: 'fadeInModal 0.2s ease',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid var(--border-color, #e2e8f0)',
                background: `${activeTutorial.badgeColor}0d`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div
                  style={{
                    width: '36px', height: '36px', borderRadius: '10px',
                    background: activeTutorial.badgeColor, color: '#ffffff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {(() => {
                    const Icon = activeTutorial.icon;
                    return <Icon size={20} />;
                  })()}
                </div>
                <div>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main, #0f172a)', margin: 0 }}>
                    {activeTutorial.title}
                  </h3>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted, #64748b)' }}>
                    Step {activeStep + 1} of {activeTutorial.steps.length}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveTutorial(null)}
                style={{
                  padding: '0.4rem', borderRadius: '8px', border: 'none',
                  background: 'transparent', color: 'var(--text-muted, #64748b)', cursor: 'pointer',
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body / Active Step */}
            <div style={{ padding: '1.75rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div
                style={{
                  padding: '1.25rem', borderRadius: '12px',
                  background: 'var(--panel-bg, #f8fafc)',
                  border: '1px solid var(--border-color, #e2e8f0)',
                  display: 'flex', gap: '1rem', alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    background: activeTutorial.badgeColor, color: '#ffffff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: '0.85rem', flexShrink: 0,
                  }}
                >
                  {activeStep + 1}
                </div>
                <div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main, #0f172a)', margin: '0 0 0.35rem' }}>
                    Instruction
                  </h4>
                  <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary, #334155)', margin: 0, lineHeight: 1.5 }}>
                    {activeTutorial.steps[activeStep]}
                  </p>
                </div>
              </div>

              {/* Step Progress Indicators */}
              <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                {activeTutorial.steps.map((_, idx) => (
                  <div
                    key={idx}
                    onClick={() => setActiveStep(idx)}
                    style={{
                      height: '6px', borderRadius: '3px', cursor: 'pointer',
                      width: activeStep === idx ? '28px' : '10px',
                      background: activeStep === idx ? activeTutorial.badgeColor : 'var(--border-color, #cbd5e1)',
                      transition: 'all 0.2s ease',
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color, #e2e8f0)',
                background: 'var(--panel-bg, #f8fafc)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <button
                type="button"
                onClick={() => handleJumpToPage(activeTutorial.pageId)}
                style={{
                  padding: '0.5rem 0.9rem', borderRadius: '8px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  background: 'var(--card-bg, #ffffff)', color: 'var(--text-main, #0f172a)',
                  fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.35rem',
                }}
              >
                Go to Feature Page <ArrowRight size={14} />
              </button>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {activeStep > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveStep(activeStep - 1)}
                    style={{
                      padding: '0.5rem 0.9rem', borderRadius: '8px',
                      border: '1px solid var(--border-color, #cbd5e1)',
                      background: 'var(--card-bg, #ffffff)', color: 'var(--text-secondary, #334155)',
                      fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    Previous
                  </button>
                )}

                {activeStep < activeTutorial.steps.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setActiveStep(activeStep + 1)}
                    style={{
                      padding: '0.5rem 1rem', borderRadius: '8px', border: 'none',
                      background: activeTutorial.badgeColor, color: '#ffffff',
                      fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                      boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
                    }}
                  >
                    Next Step
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveTutorial(null)}
                    style={{
                      padding: '0.5rem 1rem', borderRadius: '8px', border: 'none',
                      background: '#10b981', color: '#ffffff',
                      fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '0.35rem',
                    }}
                  >
                    Done <CheckCircle2 size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
