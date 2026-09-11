'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { listenToLeads, logFollowUp } from '@/services/newCrmService';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import {
  BarChart3, TrendingUp, Users, Calendar, Filter,
  Layers, ArrowRight, ShieldAlert, CheckCircle2,
  RefreshCw, Search, ExternalLink, X, ChevronRight,
  ChevronDown, ChevronUp, Building2, GitCompare,
  PieChart, SlidersHorizontal, Info, AlertTriangle, ArrowUpRight, Check,
  Clock, History, MessageSquare, PhoneCall, Plus, User
} from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend
);

import {
  MONTH_NAMES,
  BRANCH_PALETTES,
  getBranchColors,
  classifyLead,
  getLeadFollowUps,
  formatMonthLabel,
  getLeadMonth,
  aggregateMonthlyData,
} from '@/utils/crmPerformance';

/**
 * Definition of the 4 KPI metric cards
 */
export const CARD_CONFIG = [
  {
    id: 'leads',
    title: '1. Leads (Customer Chats)',
    color: '#3b82f6',
    borderLeft: '4px solid #3b82f6',
    iconBg: 'rgba(59, 130, 246, 0.1)',
    iconColor: '#3b82f6',
    icon: Users,
    getValue: (totals) => totals.leads,
    badge: null,
    subtext: 'Total customers who chatted us',
  },
  {
    id: 'profiling',
    title: '2. Profiling (Profile)',
    color: '#8b5cf6',
    borderLeft: '4px solid #8b5cf6',
    iconBg: 'rgba(139, 92, 246, 0.1)',
    iconColor: '#8b5cf6',
    icon: CheckCircle2,
    getValue: (totals) => totals.profiling,
    badge: (totals) => ({
      text: `${totals.profilingRate}% of leads`,
      bg: 'rgba(139, 92, 246, 0.12)',
      color: '#7c3aed',
    }),
    subtext: 'Student name, parent name & age filled',
  },
  {
    id: 'scheduled',
    title: '3. Trial Scheduled',
    color: '#10b981',
    borderLeft: '4px solid #10b981',
    iconBg: 'rgba(16, 185, 129, 0.1)',
    iconColor: '#10b981',
    icon: Calendar,
    getValue: (totals) => totals.scheduled,
    badge: (totals) => ({
      text: `${totals.scheduledRate}% of profile`,
      bg: 'rgba(16, 185, 129, 0.12)',
      color: '#059669',
    }),
    subtext: 'Scheduled for trial & expect to come',
  },
  {
    id: 'junk',
    title: '4. Junk Leads (Spam)',
    color: '#ef4444',
    borderLeft: '4px solid #ef4444',
    iconBg: 'rgba(239, 68, 68, 0.1)',
    iconColor: '#ef4444',
    icon: ShieldAlert,
    getValue: (totals) => totals.junk,
    badge: (totals) => ({
      text: `${totals.junkRate}% spam rate`,
      bg: 'rgba(239, 68, 68, 0.12)',
      color: '#dc2626',
    }),
    subtext: 'Spam, invalid or fake inquiries',
  },
];



export default function NewCrmWeeklyPerformancePage({ onNavigate }) {
  const scheduleCtx = useSchedule() || {};
  const rawBranches = scheduleCtx.branches || [];

  const branchList = useMemo(() => {
    const list = (Array.isArray(rawBranches) ? rawBranches : []).map((b) => {
      if (typeof b === 'string') return { id: b, name: b };
      const name = String(b?.name || b?.id || '').trim();
      const id = String(b?.id || b?.name || name).trim();
      return { id, name };
    }).filter((b) => Boolean(b.name));

    if (list.length === 0) {
      return [
        { id: 'Bekasi', name: 'Bekasi' },
        { id: 'Bintaro', name: 'Bintaro' },
        { id: 'Kelapa Gading', name: 'Kelapa Gading' },
        { id: 'Pluit Village', name: 'Pluit Village' },
      ];
    }
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(rawBranches)]);

  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState('2026');
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [chartType, setChartType] = useState('bar'); // 'bar' | 'stacked' | 'line'
  const [activeDrilldownMonth, setActiveDrilldownMonth] = useState(null);
  const [drilldownMetricFilter, setDrilldownMetricFilter] = useState('all'); // 'all' | 'profiling' | 'scheduled' | 'junk'
  const [searchQuery, setSearchQuery] = useState('');

  // Follow-Up Journey states
  const authCtx = useAuth() || {};
  const currentUser = authCtx.currentUser || null;
  const { showToast } = useToast() || { showToast: () => {} };

  const [activeJourneyLead, setActiveJourneyLead] = useState(null);
  const [isSavingFollowUp, setIsSavingFollowUp] = useState(false);
  const [followUpFormData, setFollowUpFormData] = useState({
    performedBy: '',
    channel: 'WhatsApp',
    outcome: 'Need Follow Up',
    status: 'profiling',
    trialDate: '',
    notes: '',
  });

  const handleOpenJourney = (lead) => {
    setActiveJourneyLead(lead);
    const defaultStaff =
      currentUser?.displayName ||
      (currentUser?.email ? currentUser.email.split('@')[0] : '') ||
      'Staff';
    setFollowUpFormData({
      performedBy: defaultStaff,
      channel: 'WhatsApp',
      outcome: 'Need Follow Up',
      status: lead.status || 'profiling',
      trialDate: lead.trialDate || '',
      notes: '',
    });
  };

  const handleSaveFollowUp = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!activeJourneyLead) return;

    const staffName = (followUpFormData.performedBy || '').trim();
    if (!staffName) {
      showToast({ title: 'Please enter staff name', variant: 'error' });
      return;
    }

    setIsSavingFollowUp(true);
    try {
      const payload = {
        performedBy: staffName,
        userEmail: currentUser?.email || null,
        channel: followUpFormData.channel || 'WhatsApp',
        outcome: followUpFormData.outcome || 'Need Follow Up',
        status: followUpFormData.status || activeJourneyLead.status || 'profiling',
        trialDate: followUpFormData.status === 'trial_booked' ? followUpFormData.trialDate : undefined,
        notes: (followUpFormData.notes || '').trim(),
        date: new Date().toISOString(),
      };

      const updatedLead = await logFollowUp(activeJourneyLead.id, payload);

      const existingFus = getLeadFollowUps(activeJourneyLead);
      const newEntry = {
        id: `fu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        attempt: existingFus.length + 1,
        performedBy: payload.performedBy,
        userEmail: payload.userEmail,
        date: payload.date,
        channel: payload.channel,
        outcome: payload.outcome,
        status: payload.status,
        notes: payload.notes,
      };
      const updatedFus = [...existingFus, newEntry];

      // Optimistically update main leads list
      setLeads((prev) =>
        prev.map((l) => {
          if (l.id === activeJourneyLead.id) {
            return {
              ...l,
              ...updatedLead,
              status: payload.status,
              trialDate: payload.trialDate !== undefined ? payload.trialDate : l.trialDate,
              followUps: updatedFus,
              followUpCount: updatedFus.length,
              lastFollowUp: newEntry,
              classification: {
                ...(l.classification || classifyLead(l)),
                followUps: updatedFus,
                followUpCount: updatedFus.length,
                lastFollowUp: newEntry,
                needsFollowUp: payload.status !== 'trial_booked' && payload.status !== 'junk',
                isScheduled: payload.status === 'trial_booked' || Boolean(payload.trialDate),
              },
            };
          }
          return l;
        })
      );

      // Also update activeJourneyLead in state so journey timeline updates live
      setActiveJourneyLead((prev) => ({
        ...prev,
        ...updatedLead,
        status: payload.status,
        trialDate: payload.trialDate !== undefined ? payload.trialDate : prev.trialDate,
        followUps: updatedFus,
        classification: {
          ...(prev.classification || {}),
          followUps: updatedFus,
          followUpCount: updatedFus.length,
          lastFollowUp: newEntry,
          needsFollowUp: payload.status !== 'trial_booked' && payload.status !== 'junk',
          isScheduled: payload.status === 'trial_booked' || Boolean(payload.trialDate),
        },
      }));

      // Reset notes field
      setFollowUpFormData((prev) => ({ ...prev, notes: '' }));
      showToast({
        title: `Follow-up attempt #${updatedFus.length} recorded!`,
        variant: 'success',
      });
    } catch (err) {
      console.error('Failed to log follow-up:', err);
      showToast({
        title: 'Failed to record follow-up: ' + (err.message || 'Unknown error'),
        variant: 'error',
      });
    } finally {
      setIsSavingFollowUp(false);
    }
  };

  // Option for how many cards to show with a filter
  const [visibleCards, setVisibleCards] = useState(['leads', 'profiling', 'scheduled', 'junk']);
  const [cardsFilterPreset, setCardsFilterPreset] = useState('4'); // '4' | '3' | '2' | '1' | 'custom'

  const handleCardsPresetChange = (preset) => {
    setCardsFilterPreset(preset);
    if (preset === '4') {
      setVisibleCards(['leads', 'profiling', 'scheduled', 'junk']);
    } else if (preset === '3') {
      setVisibleCards(['leads', 'profiling', 'scheduled']);
    } else if (preset === '2') {
      setVisibleCards(['leads', 'profiling']);
    } else if (preset === '1') {
      setVisibleCards(['leads']);
    }
  };

  const toggleCard = (cardId) => {
    setVisibleCards((prev) => {
      let next;
      if (prev.includes(cardId)) {
        if (prev.length <= 1) return prev; // Keep at least one card
        next = prev.filter((id) => id !== cardId);
      } else {
        next = [...prev, cardId];
      }
      if (next.length === 4) setCardsFilterPreset('4');
      else if (next.length === 3 && !next.includes('junk')) setCardsFilterPreset('3');
      else if (next.length === 2 && next.includes('leads') && next.includes('profiling')) setCardsFilterPreset('2');
      else if (next.length === 1 && next[0] === 'leads') setCardsFilterPreset('1');
      else setCardsFilterPreset('custom');
      return next;
    });
  };

  // Subscribe to real-time CRM leads
  useEffect(() => {
    setLoading(true);
    const unsubscribe = listenToLeads((fetchedLeads) => {
      setLeads(Array.isArray(fetchedLeads) ? fetchedLeads : []);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Aggregated data
  const aggregated = useMemo(() => {
    return aggregateMonthlyData(leads, selectedYear, selectedBranch, branchList);
  }, [leads, selectedYear, selectedBranch, branchList]);

  // Cross-branch comparison states
  const [branchComparisonMode, setBranchComparisonMode] = useState('monthly-race'); // 'monthly-race' | 'snapshot' | 'share'
  const [branchComparisonMetric, setBranchComparisonMetric] = useState('leads'); // 'leads' | 'profiling' | 'scheduled' | 'junk'
  const [snapshotMonth, setSnapshotMonth] = useState('all'); // 'all' or '2026-08', etc.

  // Table comparison states
  const [tableComparisonView, setTableComparisonView] = useState('nested'); // 'nested' | 'matrix'
  const [matrixMetric, setMatrixMetric] = useState('all'); // 'all' | 'leads' | 'profiling' | 'scheduled' | 'junk'
  const [expandedMonths, setExpandedMonths] = useState(new Set());
  const [drilldownBranchFilter, setDrilldownBranchFilter] = useState('all');

  // Auto-expand months that have active lead data
  useEffect(() => {
    if (aggregated?.months) {
      const activeKeys = aggregated.months.filter((m) => m.leadsCount > 0).map((m) => m.monthKey);
      if (activeKeys.length > 0) {
        setExpandedMonths(new Set(activeKeys));
      }
    }
  }, [selectedYear, selectedBranch, leads.length]);

  const toggleMonthExpand = (monthKey) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) {
        next.delete(monthKey);
      } else {
        next.add(monthKey);
      }
      return next;
    });
  };

  const allMonthKeys = useMemo(() => (aggregated?.months || []).map((m) => m.monthKey), [aggregated]);
  const areAllExpanded = allMonthKeys.length > 0 && allMonthKeys.every((k) => expandedMonths.has(k));

  const toggleExpandAllMonths = () => {
    if (areAllExpanded) {
      setExpandedMonths(new Set());
    } else {
      setExpandedMonths(new Set(allMonthKeys));
    }
  };

  // Available years from lead records
  const availableYears = useMemo(() => {
    const years = new Set(['2026']);
    leads.forEach((l) => {
      const m = getLeadMonth(l);
      if (m) {
        const y = m.split('-')[0];
        if (y && y.length === 4) years.add(y);
      }
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [leads]);

  // Chart data derivation - dynamically filtered by visibleCards
  const chartData = useMemo(() => {
    const labels = aggregated.months.map((m) => m.monthLabel);

    const leadsData = aggregated.months.map((m) => m.leadsCount);
    const profilingData = aggregated.months.map((m) => m.profilingCount);
    const scheduledData = aggregated.months.map((m) => m.scheduledCount);
    const junkData = aggregated.months.map((m) => m.junkCount);

    if (chartType === 'line') {
      const allLineSets = [
        {
          id: 'leads',
          label: 'Total Leads (Customer Chats)',
          data: leadsData,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#3b82f6',
        },
        {
          id: 'profiling',
          label: 'Profiling (Student, Parent, Age)',
          data: profilingData,
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#8b5cf6',
        },
        {
          id: 'scheduled',
          label: 'Trial Scheduled (Expected to Come)',
          data: scheduledData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#10b981',
        },
        {
          id: 'junk',
          label: 'Junk Leads (Spam / Invalid)',
          data: junkData,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#ef4444',
        },
      ];
      return {
        labels,
        datasets: allLineSets.filter((s) => visibleCards.includes(s.id)),
      };
    }

    // Bar or Stacked Bar
    const isStacked = chartType === 'stacked';
    const allBarSets = [
      {
        id: 'leads',
        label: 'Total Leads',
        data: leadsData,
        backgroundColor: '#3b82f6',
        borderRadius: 6,
        stack: isStacked ? 'leadsStack' : undefined,
      },
      {
        id: 'profiling',
        label: 'Profiling',
        data: profilingData,
        backgroundColor: '#8b5cf6',
        borderRadius: 6,
        stack: isStacked ? 'leadsStack' : undefined,
      },
      {
        id: 'scheduled',
        label: 'Trial Scheduled',
        data: scheduledData,
        backgroundColor: '#10b981',
        borderRadius: 6,
        stack: isStacked ? 'leadsStack' : undefined,
      },
      {
        id: 'junk',
        label: 'Junk Leads',
        data: junkData,
        backgroundColor: '#ef4444',
        borderRadius: 6,
        stack: isStacked ? 'leadsStack' : undefined,
      },
    ];
    return {
      labels,
      datasets: allBarSets.filter((s) => visibleCards.includes(s.id)),
    };
  }, [aggregated, chartType, visibleCards]);

  const chartOptions = useMemo(() => {
    const isStacked = chartType === 'stacked';
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            boxHeight: 8,
            padding: 16,
            font: { family: "'Inter', sans-serif", size: 12, weight: '500' },
            color: 'var(--text-main, #334155)',
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleFont: { size: 13, weight: '700' },
          bodyFont: { size: 12 },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            footer: (tooltipItems) => {
              let total = 0;
              tooltipItems.forEach((item) => {
                total += item.parsed.y || 0;
              });
              return `Total Volume: ${total}`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: isStacked,
          grid: { display: false },
          ticks: {
            color: 'var(--text-secondary, #64748b)',
            font: { family: "'Inter', sans-serif", size: 11 },
          },
        },
        y: {
          stacked: isStacked,
          beginAtZero: true,
          grid: { color: 'rgba(148, 163, 184, 0.12)' },
          ticks: {
            precision: 0,
            color: 'var(--text-secondary, #64748b)',
            font: { family: "'Inter', sans-serif", size: 11 },
          },
        },
      },
    };
  }, [chartType]);

  // Branch monthly race chart data (Jan - Dec trajectory across all branches)
  const branchMonthlyRaceChartData = useMemo(() => {
    const labels = aggregated.months.map((m) => m.monthLabel);
    const branches = aggregated.availableBranches || [];

    const datasets = branches.map((br, idx) => {
      const pal = getBranchColors(br, idx);
      const data = aggregated.months.map((m) => {
        const item = m.branchBreakdown.find((b) => b.branchName.toLowerCase() === br.toLowerCase());
        if (!item) return 0;
        if (branchComparisonMetric === 'leads') return item.leadsCount;
        if (branchComparisonMetric === 'profiling') return item.profilingCount;
        if (branchComparisonMetric === 'scheduled') return item.scheduledCount;
        return item.junkCount;
      });

      return {
        label: br,
        data,
        borderColor: pal.solid,
        backgroundColor: pal.light,
        fill: false,
        tension: 0.35,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2.5,
      };
    });

    return { labels, datasets };
  }, [aggregated, branchComparisonMetric]);

  // Branch snapshot chart data (side-by-side grouped bar for selected month or full year)
  const branchSnapshotChartData = useMemo(() => {
    const branches = aggregated.availableBranches || [];
    const isAllYear = snapshotMonth === 'all';
    const targetMonth = isAllYear ? null : aggregated.months.find((m) => m.monthKey === snapshotMonth);

    const leadsData = branches.map((br) => {
      if (isAllYear) {
        return aggregated.branchTotals.find((b) => b.branchName.toLowerCase() === br.toLowerCase())?.leads || 0;
      }
      return targetMonth?.branchBreakdown.find((b) => b.branchName.toLowerCase() === br.toLowerCase())?.leadsCount || 0;
    });

    const profilingData = branches.map((br) => {
      if (isAllYear) {
        return aggregated.branchTotals.find((b) => b.branchName.toLowerCase() === br.toLowerCase())?.profiling || 0;
      }
      return targetMonth?.branchBreakdown.find((b) => b.branchName.toLowerCase() === br.toLowerCase())?.profilingCount || 0;
    });

    const scheduledData = branches.map((br) => {
      if (isAllYear) {
        return aggregated.branchTotals.find((b) => b.branchName.toLowerCase() === br.toLowerCase())?.scheduled || 0;
      }
      return targetMonth?.branchBreakdown.find((b) => b.branchName.toLowerCase() === br.toLowerCase())?.scheduledCount || 0;
    });

    const junkData = branches.map((br) => {
      if (isAllYear) {
        return aggregated.branchTotals.find((b) => b.branchName.toLowerCase() === br.toLowerCase())?.junk || 0;
      }
      return targetMonth?.branchBreakdown.find((b) => b.branchName.toLowerCase() === br.toLowerCase())?.junkCount || 0;
    });

    const allBarSets = [
      { id: 'leads', label: '1. Leads (Chats)', data: leadsData, backgroundColor: '#3b82f6', borderRadius: 6 },
      { id: 'profiling', label: '2. Profiling', data: profilingData, backgroundColor: '#8b5cf6', borderRadius: 6 },
      { id: 'scheduled', label: '3. Trial Scheduled', data: scheduledData, backgroundColor: '#10b981', borderRadius: 6 },
      { id: 'junk', label: '4. Junk Leads', data: junkData, backgroundColor: '#ef4444', borderRadius: 6 },
    ];

    return {
      labels: branches,
      datasets: allBarSets.filter((s) => visibleCards.includes(s.id)),
    };
  }, [aggregated, snapshotMonth, visibleCards]);

  // Branch share doughnut chart data
  const branchShareChartData = useMemo(() => {
    const branches = aggregated.availableBranches || [];
    const data = branches.map((br) => {
      return aggregated.branchTotals.find((b) => b.branchName.toLowerCase() === br.toLowerCase())?.leads || 0;
    });
    const backgroundColor = branches.map((br, i) => getBranchColors(br, i).solid);

    return {
      labels: branches,
      datasets: [
        {
          data,
          backgroundColor,
          borderWidth: 2,
          borderColor: '#ffffff',
        },
      ],
    };
  }, [aggregated]);

  // Branch conversion rates benchmark bar data
  const branchRatesChartData = useMemo(() => {
    const branches = aggregated.availableBranches || [];
    const profRates = branches.map((br) => {
      const item = aggregated.branchTotals.find((b) => b.branchName.toLowerCase() === br.toLowerCase());
      return item ? parseFloat(item.profilingRate) || 0 : 0;
    });
    const schedRates = branches.map((br) => {
      const item = aggregated.branchTotals.find((b) => b.branchName.toLowerCase() === br.toLowerCase());
      return item ? parseFloat(item.scheduledRate) || 0 : 0;
    });

    return {
      labels: branches,
      datasets: [
        {
          label: 'Profiling Rate (% of Leads)',
          data: profRates,
          backgroundColor: '#8b5cf6',
          borderRadius: 6,
        },
        {
          label: 'Trial Conv. Rate (% of Profiled)',
          data: schedRates,
          backgroundColor: '#10b981',
          borderRadius: 6,
        },
      ],
    };
  }, [aggregated]);

  const branchChartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            boxHeight: 8,
            padding: 14,
            font: { family: "'Inter', sans-serif", size: 12, weight: '500' },
            color: 'var(--text-main, #334155)',
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleFont: { size: 13, weight: '700' },
          bodyFont: { size: 12 },
          padding: 12,
          cornerRadius: 8,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: 'var(--text-secondary, #64748b)',
            font: { family: "'Inter', sans-serif", size: 11 },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(148, 163, 184, 0.12)' },
          ticks: {
            precision: 0,
            color: 'var(--text-secondary, #64748b)',
            font: { family: "'Inter', sans-serif", size: 11 },
          },
        },
      },
    };
  }, []);

  const branchRateChartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            boxHeight: 8,
            font: { family: "'Inter', sans-serif", size: 11, weight: '500' },
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y}%`,
          },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { callback: (v) => `${v}%` },
          grid: { color: 'rgba(148, 163, 184, 0.12)' },
        },
      },
    };
  }, []);

  const doughnutOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            boxHeight: 8,
            padding: 12,
            font: { family: "'Inter', sans-serif", size: 11 },
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.parsed} leads`,
          },
        },
      },
    };
  }, []);

  // Leads for the selected drilldown month
  const activeMonthData = useMemo(() => {
    if (!activeDrilldownMonth) return null;
    return aggregated.months.find((m) => m.monthKey === activeDrilldownMonth) || null;
  }, [activeDrilldownMonth, aggregated]);

  // Filtered leads inside drilldown modal
  const filteredDrilldownLeads = useMemo(() => {
    if (!activeMonthData) return [];
    let list = activeMonthData.allLeadsList || activeMonthData.leadsList || [];

    if (drilldownMetricFilter === 'profiling') {
      list = list.filter((l) => l.classification.isProfiled && !l.classification.isJunk);
    } else if (drilldownMetricFilter === 'scheduled') {
      list = list.filter((l) => l.classification.isScheduled && !l.classification.isJunk);
    } else if (drilldownMetricFilter === 'junk') {
      list = list.filter((l) => l.classification.isJunk);
    }

    if (drilldownBranchFilter !== 'all') {
      list = list.filter((l) => String(l.branch || '').toLowerCase() === drilldownBranchFilter.toLowerCase());
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((l) => {
        return (
          String(l.name || '').toLowerCase().includes(q) ||
          String(l.phone || '').toLowerCase().includes(q) ||
          String(l.branch || '').toLowerCase().includes(q) ||
          String(l.notes || '').toLowerCase().includes(q) ||
          String(l.message || '').toLowerCase().includes(q)
        );
      });
    }

    return list;
  }, [activeMonthData, drilldownMetricFilter, drilldownBranchFilter, searchQuery]);

  return (
    <section data-tour="crm-weekly-performance" className="dashboard-view active" style={{ padding: '1.5rem', maxWidth: '1440px', margin: '0 auto' }}>
      {/* Top Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: '1rem',
        marginBottom: '1.5rem',
      }}>
        <div>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            fontSize: '0.8rem',
            color: 'var(--text-muted, #64748b)',
            fontWeight: 500,
            marginBottom: '0.4rem',
          }}>
            <span>CRM Pipeline</span>
            <span>&rsaquo;</span>
            <span style={{ color: 'var(--primary-blue, #4f46e5)', fontWeight: 600 }}>Weekly Performance & Monthly Trends</span>
          </div>
          <h1 style={{
            fontSize: '1.75rem',
            fontWeight: 800,
            color: 'var(--text-main, #0f172a)',
            margin: '0 0 0.35rem 0',
            letterSpacing: '-0.02em',
          }}>
            CRM Monthly Trend Graphics
          </h1>
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary, #64748b)' }}>
            Track multi-month progression across Customer Leads, Profiling, Trial Bookings, and Spam Filtering.
          </p>
        </div>

        {/* Action button back to active pipeline board */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <button
            type="button"
            className="btn"
            onClick={() => onNavigate && onNavigate('crm')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.55rem 1rem',
              borderRadius: '8px',
              fontSize: '0.84rem',
              fontWeight: 600,
              background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)',
              transition: 'all 0.15s ease',
            }}
          >
            <span>Open Pipeline Board</span>
            <ArrowRight size={15} />
          </button>
        </div>
      </div>

      {/* Filter and Control Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.85rem',
        padding: '0.85rem 1.25rem',
        background: 'var(--panel-bg, #ffffff)',
        borderRadius: '12px',
        border: '1px solid var(--border-color, rgba(0,0,0,0.08))',
        boxShadow: 'var(--card-shadow, 0 2px 8px rgba(0,0,0,0.03))',
        marginBottom: '1.5rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
          {/* Year Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b' }}>Year:</span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              style={{
                fontSize: '0.84rem',
                padding: '0.35rem 0.65rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: 'var(--input-bg, #ffffff)',
                color: 'var(--text-main, #334155)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
              <option value="all">All Time</option>
            </select>
          </div>

          {/* Branch Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b' }}>Branch:</span>
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              style={{
                fontSize: '0.84rem',
                padding: '0.35rem 0.65rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: 'var(--input-bg, #ffffff)',
                color: 'var(--text-main, #334155)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <option value="all">All Branches</option>
              {branchList.map((b) => (
                <option key={b.id || b.name} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>

          <div style={{ height: '22px', width: '1px', background: '#e2e8f0', margin: '0 0.15rem' }} />

          {/* How many cards to show with a filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b' }}>Cards to show:</span>
            <select
              value={cardsFilterPreset}
              onChange={(e) => handleCardsPresetChange(e.target.value)}
              style={{
                fontSize: '0.84rem',
                padding: '0.35rem 0.65rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: 'var(--input-bg, #ffffff)',
                color: 'var(--text-main, #334155)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <option value="4">Show 4 Cards (All)</option>
              <option value="3">Show 3 Cards (Funnel)</option>
              <option value="2">Show 2 Cards (Acquisition)</option>
              <option value="1">Show 1 Card (Leads Only)</option>
              {cardsFilterPreset === 'custom' && (
                <option value="custom">Custom ({visibleCards.length} Cards)</option>
              )}
            </select>
          </div>

          {/* Quick interactive card filter chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
            {[
              { id: 'leads', label: '1. Leads', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
              { id: 'profiling', label: '2. Profiling', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)' },
              { id: 'scheduled', label: '3. Scheduled', color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' },
              { id: 'junk', label: '4. Junk', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)' },
            ].map((chip) => {
              const isChecked = visibleCards.includes(chip.id);
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => toggleCard(chip.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '0.22rem 0.55rem',
                    borderRadius: '16px',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    border: isChecked ? `1px solid ${chip.color}` : '1px solid #cbd5e1',
                    background: isChecked ? chip.bg : '#f8fafc',
                    color: isChecked ? chip.color : '#94a3b8',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  title={`Click to ${isChecked ? 'hide' : 'show'} ${chip.label}`}
                >
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: isChecked ? chip.color : '#cbd5e1',
                  }} />
                  {chip.label}
                  {isChecked && <Check size={11} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Chart View Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
          <button
            type="button"
            onClick={() => setChartType('bar')}
            style={{
              padding: '0.3rem 0.75rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              background: chartType === 'bar' ? '#ffffff' : 'transparent',
              color: chartType === 'bar' ? '#0f172a' : '#64748b',
              boxShadow: chartType === 'bar' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            Grouped Bar
          </button>
          <button
            type="button"
            onClick={() => setChartType('stacked')}
            style={{
              padding: '0.3rem 0.75rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              background: chartType === 'stacked' ? '#ffffff' : 'transparent',
              color: chartType === 'stacked' ? '#0f172a' : '#64748b',
              boxShadow: chartType === 'stacked' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            Stacked Funnel
          </button>
          <button
            type="button"
            onClick={() => setChartType('line')}
            style={{
              padding: '0.3rem 0.75rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              background: chartType === 'line' ? '#ffffff' : 'transparent',
              color: chartType === 'line' ? '#0f172a' : '#64748b',
              boxShadow: chartType === 'line' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            Smooth Trend
          </button>
        </div>
      </div>

      {/* KPI Cards Overview - Dynamically rendered based on visibleCards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${visibleCards.length === 1 ? '320px' : '220px'}, 1fr))`,
        gap: '1rem',
        marginBottom: '1.5rem',
        transition: 'all 0.2s ease',
      }}>
        {CARD_CONFIG.filter((cfg) => visibleCards.includes(cfg.id)).map((cfg) => {
          const IconComp = cfg.icon;
          const badgeInfo = cfg.badge ? cfg.badge(aggregated.totals) : null;
          return (
            <div
              key={cfg.id}
              data-testid={`kpi-card-${cfg.id}`}
              style={{
                background: 'var(--panel-bg, #ffffff)',
                borderRadius: '12px',
                padding: '1.15rem 1.25rem',
                border: '1px solid var(--border-color, rgba(0,0,0,0.08))',
                boxShadow: 'var(--card-shadow, 0 2px 8px rgba(0,0,0,0.03))',
                borderLeft: cfg.borderLeft,
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary, #64748b)' }}>
                  {cfg.title}
                </span>
                <div style={{ padding: '6px', borderRadius: '8px', background: cfg.iconBg, color: cfg.iconColor }}>
                  <IconComp size={16} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#1e293b', lineHeight: 1.1 }}>
                  {cfg.getValue(aggregated.totals)}
                </span>
                {badgeInfo && (
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: badgeInfo.bg,
                    color: badgeInfo.color,
                  }}>
                    {badgeInfo.text}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                {cfg.subtext}
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Monthly Graphic Canvas */}
      <div style={{
        background: 'var(--panel-bg, #ffffff)',
        borderRadius: '14px',
        padding: '1.5rem',
        border: '1px solid var(--border-color, rgba(0,0,0,0.08))',
        boxShadow: 'var(--card-shadow, 0 4px 16px rgba(0,0,0,0.04))',
        marginBottom: '1.75rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ margin: '0 0 0.2rem 0', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main, #0f172a)' }}>
              Monthly Lead Progression & Conversion
            </h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)' }}>
              Showing {visibleCards.length} active metric{visibleCards.length === 1 ? '' : 's'} across months &bull; Hover to inspect transitions
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.75rem', color: '#64748b' }}>
            {visibleCards.includes('leads') && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6' }} /> Leads
              </span>
            )}
            {visibleCards.includes('profiling') && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#8b5cf6' }} /> Profiling
              </span>
            )}
            {visibleCards.includes('scheduled') && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} /> Trial Scheduled
              </span>
            )}
            {visibleCards.includes('junk') && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} /> Junk Leads
              </span>
            )}
          </div>
        </div>

        <div style={{ height: '360px', width: '100%', position: 'relative' }}>
          {chartType === 'line' ? (
            <Line data={chartData} options={chartOptions} />
          ) : (
            <Bar data={chartData} options={chartOptions} />
          )}
        </div>
      </div>

      {/* Cross-Branch Performance & Monthly Comparisons Section */}
      <div style={{
        background: 'var(--panel-bg, #ffffff)',
        borderRadius: '14px',
        padding: '1.5rem',
        border: '1px solid var(--border-color, rgba(0,0,0,0.08))',
        boxShadow: 'var(--card-shadow, 0 4px 16px rgba(0,0,0,0.04))',
        marginBottom: '1.75rem',
      }}>
        {/* Header & Mode Switcher */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.25rem',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.2rem' }}>
              <GitCompare size={18} style={{ color: '#4f46e5' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main, #0f172a)' }}>
                Cross-Branch Performance &amp; Monthly Comparisons
              </h3>
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)' }}>
              Compare Leads, Profile, Scheduled Trial, and Junk across all available branches month-by-month
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
            <button
              type="button"
              onClick={() => setBranchComparisonMode('monthly-race')}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: branchComparisonMode === 'monthly-race' ? '#ffffff' : 'transparent',
                color: branchComparisonMode === 'monthly-race' ? '#0f172a' : '#64748b',
                boxShadow: branchComparisonMode === 'monthly-race' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Monthly Race by Branch
            </button>
            <button
              type="button"
              onClick={() => setBranchComparisonMode('snapshot')}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: branchComparisonMode === 'snapshot' ? '#ffffff' : 'transparent',
                color: branchComparisonMode === 'snapshot' ? '#0f172a' : '#64748b',
                boxShadow: branchComparisonMode === 'snapshot' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Month-by-Month Snapshot
            </button>
            <button
              type="button"
              onClick={() => setBranchComparisonMode('share')}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: branchComparisonMode === 'share' ? '#ffffff' : 'transparent',
                color: branchComparisonMode === 'share' ? '#0f172a' : '#64748b',
                boxShadow: branchComparisonMode === 'share' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Share &amp; Benchmarks
            </button>
          </div>
        </div>

        {/* Secondary Toolbar Controls based on mode */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          padding: '0.65rem 1rem',
          background: '#f8fafc',
          borderRadius: '8px',
          marginBottom: '1.25rem',
          border: '1px solid #e2e8f0',
        }}>
          {branchComparisonMode === 'monthly-race' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#475569' }}>Compare Metric:</span>
                {[
                  { id: 'leads', label: '1. Leads', color: '#3b82f6' },
                  { id: 'profiling', label: '2. Profile', color: '#8b5cf6' },
                  { id: 'scheduled', label: '3. Scheduled Trial', color: '#10b981' },
                  { id: 'junk', label: '4. Junk (Spam)', color: '#ef4444' },
                ].map((item) => {
                  const isActive = branchComparisonMetric === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setBranchComparisonMetric(item.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '0.22rem 0.6rem',
                        borderRadius: '16px',
                        fontSize: '0.74rem',
                        fontWeight: 600,
                        border: isActive ? `1px solid ${item.color}` : '1px solid #cbd5e1',
                        background: isActive ? '#ffffff' : 'transparent',
                        color: isActive ? item.color : '#64748b',
                        cursor: 'pointer',
                        boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.color }} />
                      {item.label}
                    </button>
                  );
                })}
              </div>

              {/* Branch Volume Legend Chips */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', fontSize: '0.74rem' }}>
                {aggregated.availableBranches.map((br, i) => {
                  const pal = getBranchColors(br, i);
                  const bTotal = aggregated.branchTotals.find((b) => b.branchName.toLowerCase() === br.toLowerCase());
                  const val = bTotal ? (branchComparisonMetric === 'leads' ? bTotal.leads : branchComparisonMetric === 'profiling' ? bTotal.profiling : branchComparisonMetric === 'scheduled' ? bTotal.scheduled : bTotal.junk) : 0;
                  return (
                    <span key={br} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#475569' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: pal.solid }} />
                      <strong>{br}:</strong> {val}
                    </span>
                  );
                })}
              </div>
            </>
          )}

          {branchComparisonMode === 'snapshot' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#475569' }}>Select Month:</span>
                <select
                  value={snapshotMonth}
                  onChange={(e) => setSnapshotMonth(e.target.value)}
                  style={{
                    fontSize: '0.8rem',
                    padding: '0.3rem 0.6rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#1e293b',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <option value="all">Full Year 2026 (Total)</option>
                  {aggregated.months.map((m) => (
                    <option key={m.monthKey} value={m.monthKey}>
                      {m.monthLabel} {m.leadsCount > 0 ? `(${m.leadsCount} leads)` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.74rem', color: '#64748b' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6' }} /> Leads
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#8b5cf6' }} /> Profile
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} /> Scheduled Trial
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} /> Junk
                </span>
              </div>
            </>
          )}

          {branchComparisonMode === 'share' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', width: '100%', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>
                Total Inbound Leads across all branches: <strong style={{ color: '#4f46e5' }}>{aggregated.allBranchesTotalLeads} leads</strong>
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {aggregated.branchTotals[0] && (
                  <span style={{
                    fontSize: '0.72rem',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: 'rgba(59, 130, 246, 0.12)',
                    color: '#2563eb',
                    fontWeight: 700,
                  }}>
                    Top Volume: {aggregated.branchTotals[0].branchName} ({aggregated.branchTotals[0].leads} leads)
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Dynamic Chart Canvas based on mode */}
        <div style={{ height: '340px', width: '100%', position: 'relative' }}>
          {branchComparisonMode === 'monthly-race' && (
            <Line data={branchMonthlyRaceChartData} options={branchChartOptions} />
          )}
          {branchComparisonMode === 'snapshot' && (
            <Bar data={branchSnapshotChartData} options={branchChartOptions} />
          )}
          {branchComparisonMode === 'share' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', height: '100%' }}>
              <div style={{ height: '320px', position: 'relative' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#475569', textAlign: 'center' }}>
                  Inbound Lead Volume Share (%)
                </h4>
                <div style={{ height: '280px', position: 'relative' }}>
                  <Doughnut data={branchShareChartData} options={doughnutOptions} />
                </div>
              </div>
              <div style={{ height: '320px', position: 'relative' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#475569', textAlign: 'center' }}>
                  Branch Conversion Benchmarks (%)
                </h4>
                <div style={{ height: '280px', position: 'relative' }}>
                  <Bar data={branchRatesChartData} options={branchRateChartOptions} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Monthly Breakdown Data Table */}
      <div style={{
        background: 'var(--panel-bg, #ffffff)',
        borderRadius: '14px',
        padding: '1.25rem',
        border: '1px solid var(--border-color, rgba(0,0,0,0.08))',
        boxShadow: 'var(--card-shadow, 0 4px 16px rgba(0,0,0,0.04))',
      }}>
        {/* Table Header & Controls */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.85rem',
          marginBottom: '1.25rem',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.2rem' }}>
              <Building2 size={18} style={{ color: '#4f46e5' }} />
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main, #0f172a)' }}>
                Monthly Performance Breakdown Table
              </h3>
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)' }}>
              Compare all available branches together for each month across Leads, Profile, Scheduled Trial, and Junk
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            {/* Expand / Collapse All Button */}
            {tableComparisonView === 'nested' && (
              <button
                type="button"
                onClick={toggleExpandAllMonths}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#1e293b',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                  transition: 'all 0.15s ease',
                }}
              >
                {areAllExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                <span>{areAllExpanded ? 'Collapse All Branches' : 'Expand All Branches'}</span>
              </button>
            )}

            {/* View Mode Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', background: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
              <button
                type="button"
                onClick={() => setTableComparisonView('nested')}
                style={{
                  padding: '0.3rem 0.75rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  background: tableComparisonView === 'nested' ? '#ffffff' : 'transparent',
                  color: tableComparisonView === 'nested' ? '#0f172a' : '#64748b',
                  boxShadow: tableComparisonView === 'nested' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                Branch Breakdown
              </button>
              <button
                type="button"
                onClick={() => setTableComparisonView('matrix')}
                style={{
                  padding: '0.3rem 0.75rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  background: tableComparisonView === 'matrix' ? '#ffffff' : 'transparent',
                  color: tableComparisonView === 'matrix' ? '#0f172a' : '#64748b',
                  boxShadow: tableComparisonView === 'matrix' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                Branch Matrix
              </button>
            </div>
          </div>
        </div>

        {/* Matrix Mode Toolbar */}
        {tableComparisonView === 'matrix' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.55rem 0.85rem',
            background: '#f8fafc',
            borderRadius: '8px',
            marginBottom: '1rem',
            border: '1px solid #e2e8f0',
            flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#475569' }}>Matrix Metric:</span>
            {[
              { id: 'all', label: 'All 4 Metrics' },
              { id: 'leads', label: '1. Leads' },
              { id: 'profiling', label: '2. Profile' },
              { id: 'scheduled', label: '3. Scheduled Trial' },
              { id: 'junk', label: '4. Junk Leads' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMatrixMetric(m.id)}
                style={{
                  padding: '0.22rem 0.6rem',
                  borderRadius: '6px',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  border: matrixMetric === m.id ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                  background: matrixMetric === m.id ? '#4f46e5' : '#ffffff',
                  color: matrixMetric === m.id ? '#ffffff' : '#64748b',
                  cursor: 'pointer',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {/* TABLE VIEW 1: NESTED MONTH & BRANCH BREAKDOWN */}
        {tableComparisonView === 'nested' && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
                  <th style={{ padding: '0.75rem 0.5rem', fontWeight: 600, width: '220px' }}>Month / Branch</th>
                  <th style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>1. Leads (Chats)</th>
                  <th style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>2. Profiling</th>
                  <th style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>Profiling Rate</th>
                  <th style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>3. Trial Scheduled</th>
                  <th style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>Trial Conv. %</th>
                  <th style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>4. Junk (Spam)</th>
                  <th style={{ padding: '0.75rem 0.5rem', fontWeight: 600, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {aggregated.months.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                      No leads recorded for the selected year.
                    </td>
                  </tr>
                ) : (
                  aggregated.months.map((m) => {
                    const profRate = m.leadsCount > 0 ? ((m.profilingCount / m.leadsCount) * 100).toFixed(1) : '0.0';
                    const trialRate = m.profilingCount > 0 ? ((m.scheduledCount / m.profilingCount) * 100).toFixed(1) : '0.0';
                    const hasData = m.leadsCount > 0;
                    const isExpanded = expandedMonths.has(m.monthKey);

                    return (
                      <React.Fragment key={m.monthKey}>
                        {/* Parent Month Row (Total) */}
                        <tr
                          onClick={() => toggleMonthExpand(m.monthKey)}
                          style={{
                            borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9',
                            background: isExpanded ? 'rgba(79, 70, 229, 0.04)' : (hasData ? '#ffffff' : 'rgba(241, 245, 249, 0.4)'),
                            cursor: 'pointer',
                            transition: 'background 0.15s ease',
                          }}
                        >
                          <td style={{ padding: '0.75rem 0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '20px',
                                height: '20px',
                                borderRadius: '4px',
                                background: isExpanded ? 'rgba(79, 70, 229, 0.12)' : '#f1f5f9',
                                color: isExpanded ? '#4f46e5' : '#64748b',
                                transition: 'all 0.15s ease',
                              }}>
                                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              </span>
                              <span style={{ fontWeight: 700, color: '#0f172a' }}>
                                {m.monthLabel}
                              </span>
                              <span style={{
                                fontSize: '0.68rem',
                                padding: '1px 6px',
                                borderRadius: '10px',
                                background: hasData ? 'rgba(79, 70, 229, 0.1)' : '#f1f5f9',
                                color: hasData ? '#4f46e5' : '#94a3b8',
                                fontWeight: 600,
                              }}>
                                Total &bull; {m.branchBreakdown.length} branches
                              </span>
                            </div>
                          </td>
                          <td style={{ padding: '0.75rem 0.5rem', fontWeight: 700, color: '#3b82f6' }}>
                            {m.leadsCount}
                          </td>
                          <td style={{ padding: '0.75rem 0.5rem', fontWeight: 700, color: '#8b5cf6' }}>
                            {m.profilingCount}
                          </td>
                          <td style={{ padding: '0.75rem 0.5rem' }}>
                            <span style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              background: hasData ? 'rgba(139, 92, 246, 0.12)' : '#f1f5f9',
                              color: hasData ? '#7c3aed' : '#94a3b8',
                            }}>
                              {profRate}%
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem 0.5rem', fontWeight: 700, color: '#10b981' }}>
                            {m.scheduledCount}
                          </td>
                          <td style={{ padding: '0.75rem 0.5rem' }}>
                            <span style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              background: hasData ? 'rgba(16, 185, 129, 0.12)' : '#f1f5f9',
                              color: hasData ? '#059669' : '#94a3b8',
                            }}>
                              {trialRate}%
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem 0.5rem', fontWeight: 700, color: '#ef4444' }}>
                            {m.junkCount}
                          </td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                            <button
                              type="button"
                              disabled={!hasData}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveDrilldownMonth(m.monthKey);
                                setDrilldownBranchFilter('all');
                                setDrilldownMetricFilter('all');
                                setSearchQuery('');
                              }}
                              style={{
                                padding: '0.35rem 0.75rem',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                borderRadius: '6px',
                                border: hasData ? '1px solid #cbd5e1' : '1px solid #e2e8f0',
                                background: hasData ? '#ffffff' : '#f8fafc',
                                color: hasData ? '#4f46e5' : '#cbd5e1',
                                cursor: hasData ? 'pointer' : 'default',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <span>Inspect Month</span>
                              <ChevronRight size={13} />
                            </button>
                          </td>
                        </tr>

                        {/* Child Rows for Each Branch inside this Month */}
                        {isExpanded && m.branchBreakdown.map((b, bIdx) => {
                          const pal = getBranchColors(b.branchName, bIdx);
                          const bHasData = b.leadsCount > 0;
                          return (
                            <tr
                              key={`${m.monthKey}-${b.branchName}`}
                              style={{
                                background: bIdx % 2 === 0 ? '#f8fafc' : '#f1f5f9',
                                borderBottom: bIdx === m.branchBreakdown.length - 1 ? '2px solid #e2e8f0' : '1px solid #eef2f6',
                                fontSize: '0.82rem',
                              }}
                            >
                              <td style={{ padding: '0.55rem 0.5rem 0.55rem 2.25rem' }}>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: pal.solid }} />
                                  <span style={{ fontWeight: 600, color: '#1e293b' }}>{b.branchName}</span>
                                </div>
                              </td>
                              <td style={{ padding: '0.55rem 0.5rem', fontWeight: 600, color: '#3b82f6' }}>
                                {b.leadsCount}
                              </td>
                              <td style={{ padding: '0.55rem 0.5rem', fontWeight: 600, color: '#8b5cf6' }}>
                                {b.profilingCount}
                              </td>
                              <td style={{ padding: '0.55rem 0.5rem' }}>
                                <span style={{
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                  background: bHasData ? 'rgba(139, 92, 246, 0.1)' : '#ffffff',
                                  color: bHasData ? '#7c3aed' : '#94a3b8',
                                }}>
                                  {b.profilingRate}%
                                </span>
                              </td>
                              <td style={{ padding: '0.55rem 0.5rem', fontWeight: 600, color: '#10b981' }}>
                                {b.scheduledCount}
                              </td>
                              <td style={{ padding: '0.55rem 0.5rem' }}>
                                <span style={{
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                  background: bHasData ? 'rgba(16, 185, 129, 0.1)' : '#ffffff',
                                  color: bHasData ? '#059669' : '#94a3b8',
                                }}>
                                  {b.scheduledRate}%
                                </span>
                              </td>
                              <td style={{ padding: '0.55rem 0.5rem', fontWeight: 600, color: '#ef4444' }}>
                                {b.junkCount}
                              </td>
                              <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right' }}>
                                <button
                                  type="button"
                                  disabled={!bHasData}
                                  onClick={() => {
                                    setActiveDrilldownMonth(m.monthKey);
                                    setDrilldownBranchFilter(b.branchName);
                                    setDrilldownMetricFilter('all');
                                    setSearchQuery('');
                                  }}
                                  style={{
                                    padding: '0.25rem 0.6rem',
                                    fontSize: '0.72rem',
                                    fontWeight: 600,
                                    borderRadius: '5px',
                                    border: bHasData ? `1px solid ${pal.border}` : '1px solid #cbd5e1',
                                    background: bHasData ? pal.light : '#ffffff',
                                    color: bHasData ? pal.border : '#cbd5e1',
                                    cursor: bHasData ? 'pointer' : 'default',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                >
                                  <span>Inspect ({b.branchName})</span>
                                  <ChevronRight size={11} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TABLE VIEW 2: CROSS-BRANCH COMPARISON MATRIX */}
        {tableComparisonView === 'matrix' && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
                  <th style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>Month</th>
                  {aggregated.availableBranches.map((br, i) => {
                    const pal = getBranchColors(br, i);
                    return (
                      <th key={br} style={{ padding: '0.75rem 0.5rem', fontWeight: 700, color: '#1e293b' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: pal.solid }} />
                          {br}
                        </div>
                      </th>
                    );
                  })}
                  <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700, color: '#4f46e5' }}>Total Month</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {aggregated.months.map((m) => {
                  const hasData = m.leadsCount > 0;
                  return (
                    <tr
                      key={m.monthKey}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: hasData ? 'transparent' : 'rgba(241, 245, 249, 0.4)',
                      }}
                    >
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: 700, color: '#1e293b' }}>
                        {m.monthLabel}
                      </td>
                      {aggregated.availableBranches.map((br) => {
                        const bItem = m.branchBreakdown.find((b) => b.branchName.toLowerCase() === br.toLowerCase());
                        if (!bItem) {
                          return <td key={br} style={{ padding: '0.75rem 0.5rem', color: '#94a3b8' }}>0</td>;
                        }
                        if (matrixMetric === 'leads') {
                          return <td key={br} style={{ padding: '0.75rem 0.5rem', fontWeight: 600, color: '#3b82f6' }}>{bItem.leadsCount}</td>;
                        }
                        if (matrixMetric === 'profiling') {
                          return <td key={br} style={{ padding: '0.75rem 0.5rem', fontWeight: 600, color: '#8b5cf6' }}>{bItem.profilingCount}</td>;
                        }
                        if (matrixMetric === 'scheduled') {
                          return <td key={br} style={{ padding: '0.75rem 0.5rem', fontWeight: 600, color: '#10b981' }}>{bItem.scheduledCount}</td>;
                        }
                        if (matrixMetric === 'junk') {
                          return <td key={br} style={{ padding: '0.75rem 0.5rem', fontWeight: 600, color: '#ef4444' }}>{bItem.junkCount}</td>;
                        }
                        // All 4 metrics combined
                        return (
                          <td key={br} style={{ padding: '0.55rem 0.5rem', fontSize: '0.76rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span><strong style={{ color: '#3b82f6' }}>L:</strong> {bItem.leadsCount}</span>
                              <span><strong style={{ color: '#8b5cf6' }}>P:</strong> {bItem.profilingCount}</span>
                              <span><strong style={{ color: '#10b981' }}>T:</strong> {bItem.scheduledCount}</span>
                              {bItem.junkCount > 0 && <span><strong style={{ color: '#ef4444' }}>J:</strong> {bItem.junkCount}</span>}
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: 800, color: '#4f46e5' }}>
                        {matrixMetric === 'leads' ? m.leadsCount : matrixMetric === 'profiling' ? m.profilingCount : matrixMetric === 'scheduled' ? m.scheduledCount : matrixMetric === 'junk' ? m.junkCount : `${m.leadsCount} leads`}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                        <button
                          type="button"
                          disabled={!hasData}
                          onClick={() => {
                            setActiveDrilldownMonth(m.monthKey);
                            setDrilldownBranchFilter('all');
                            setDrilldownMetricFilter('all');
                            setSearchQuery('');
                          }}
                          style={{
                            padding: '0.3rem 0.65rem',
                            fontSize: '0.74rem',
                            fontWeight: 600,
                            borderRadius: '5px',
                            border: hasData ? '1px solid #cbd5e1' : '1px solid #e2e8f0',
                            background: hasData ? '#ffffff' : '#f8fafc',
                            color: hasData ? '#4f46e5' : '#cbd5e1',
                            cursor: hasData ? 'pointer' : 'default',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          <span>Inspect</span>
                          <ChevronRight size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Leads Drilldown Modal */}
      {activeMonthData && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem',
        }}>
          <div style={{
            background: 'var(--panel-bg, #ffffff)',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '850px',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
            border: '1px solid var(--border-color, rgba(0,0,0,0.1))',
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <h3 style={{ margin: '0 0 0.2rem 0', fontSize: '1.2rem', fontWeight: 800 }}>
                  Leads for {activeMonthData.monthLabel} {drilldownBranchFilter !== 'all' ? `• ${drilldownBranchFilter}` : ''}
                </h3>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  Showing <strong>{filteredDrilldownLeads.length}</strong> filtered leads in {activeMonthData.monthLabel}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveDrilldownMonth(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  padding: '6px',
                  borderRadius: '6px',
                  display: 'inline-flex',
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Filter Tabs & Search */}
            <div style={{
              padding: '0.85rem 1.5rem',
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'profiling', label: 'Profiling' },
                    { id: 'scheduled', label: 'Scheduled' },
                    { id: 'junk', label: 'Junk' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setDrilldownMetricFilter(tab.id)}
                      style={{
                        padding: '0.35rem 0.75rem',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        borderRadius: '6px',
                        border: 'none',
                        cursor: 'pointer',
                        background: drilldownMetricFilter === tab.id ? '#4f46e5' : '#ffffff',
                        color: drilldownMetricFilter === tab.id ? '#ffffff' : '#64748b',
                        boxShadow: drilldownMetricFilter === tab.id ? '0 2px 6px rgba(79, 70, 229, 0.3)' : '0 1px 2px rgba(0,0,0,0.05)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Branch selector inside modal */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>Branch:</span>
                  <select
                    value={drilldownBranchFilter}
                    onChange={(e) => setDrilldownBranchFilter(e.target.value)}
                    style={{
                      fontSize: '0.76rem',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '5px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#1e293b',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <option value="all">All Branches</option>
                    {aggregated.availableBranches.map((br) => (
                      <option key={br} value={br}>{br}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ position: 'relative', minWidth: '220px' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  placeholder="Search name or phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.35rem 0.65rem 0.35rem 2rem',
                    fontSize: '0.8rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                  }}
                />
              </div>
            </div>

            {/* Modal Leads List */}
            <div style={{ padding: '1rem 1.5rem', overflowY: 'auto', flexGrow: 1 }}>
              {filteredDrilldownLeads.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#94a3b8' }}>
                  No leads matching the selected filter in this month.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  {filteredDrilldownLeads.map((lead) => {
                    const cleanPhone = String(lead.phone || '').replace(/[^\d]/g, '');
                    const waLink = cleanPhone ? `https://wa.me/${cleanPhone.startsWith('0') ? '62' + cleanPhone.slice(1) : cleanPhone}` : null;

                    return (
                      <div
                        key={lead.id}
                        style={{
                          padding: '0.85rem 1rem',
                          borderRadius: '10px',
                          border: '1px solid #e2e8f0',
                          background: lead.classification.isJunk ? 'rgba(239, 68, 68, 0.03)' : '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '1rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: '240px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.94rem', color: '#0f172a' }}>
                              {lead.name || 'Unnamed Lead'}
                            </span>
                            {lead.classification.isJunk && (
                              <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: '#fee2e2', color: '#b91c1c' }}>
                                JUNK
                              </span>
                            )}
                            {lead.classification.isScheduled && (
                              <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' }}>
                                TRIAL SCHEDULED
                              </span>
                            )}
                            {lead.classification.isProfiled && !lead.classification.isJunk && (
                              <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: '#ede9fe', color: '#6d28d9', border: '1px solid #ddd6fe' }}>
                                PROFILED
                              </span>
                            )}
                            {(!lead.classification.isScheduled && !lead.classification.isJunk && (lead.classification.needsFollowUp || lead.classification.isProfiled || drilldownMetricFilter === 'profiling')) && (
                              <span style={{
                                fontSize: '0.68rem',
                                fontWeight: 800,
                                padding: '2px 8px',
                                borderRadius: '4px',
                                background: '#fef3c7',
                                color: '#b45309',
                                border: '1px solid #fde68a',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                boxShadow: '0 1px 2px rgba(245, 158, 11, 0.1)',
                              }}>
                                <Clock size={11} />
                                NEED TO FOLLOW UP
                              </span>
                            )}
                            <span style={{
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: '4px',
                              background: (lead.classification.followUpCount || getLeadFollowUps(lead).length) > 0 ? '#e0e7ff' : '#f1f5f9',
                              color: (lead.classification.followUpCount || getLeadFollowUps(lead).length) > 0 ? '#3730a3' : '#64748b',
                              border: `1px solid ${(lead.classification.followUpCount || getLeadFollowUps(lead).length) > 0 ? '#c7d2fe' : '#e2e8f0'}`,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}>
                              <History size={11} />
                              {(lead.classification.followUpCount || getLeadFollowUps(lead).length) > 0
                                ? `${lead.classification.followUpCount || getLeadFollowUps(lead).length}x Follow-up`
                                : '0x Follow-up'}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.78rem', color: '#64748b', flexWrap: 'wrap' }}>
                            {lead.branch && <span>📍 {lead.branch}</span>}
                            {lead.trialDate && <span>🗓 Trial: {lead.trialDate}</span>}
                            <span>Status: <strong>{lead.status}</strong></span>
                            {lead.classification.lastFollowUp && (
                              <span style={{ color: '#4f46e5', fontWeight: 600 }}>
                                • Last touch: {lead.classification.lastFollowUp.performedBy || 'Staff'} ({lead.classification.lastFollowUp.channel || 'WhatsApp'})
                              </span>
                            )}
                          </div>

                          {(lead.message || lead.notes) && (
                            <div style={{ fontSize: '0.74rem', color: '#475569', marginTop: '0.35rem', fontStyle: 'italic', background: '#f8fafc', padding: '0.35rem 0.6rem', borderRadius: '6px', borderLeft: '3px solid #cbd5e1' }}>
                              &ldquo;{lead.message || lead.notes}&rdquo;
                            </div>
                          )}
                        </div>

                        {/* WhatsApp action + Journey button */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                          {waLink && (
                            <a
                              href={waLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '0.38rem 0.75rem',
                                borderRadius: '6px',
                                background: '#25D366',
                                color: '#ffffff',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                textDecoration: 'none',
                                boxShadow: '0 1px 2px rgba(37, 211, 102, 0.25)',
                              }}
                            >
                              <span>WhatsApp</span>
                              <ExternalLink size={12} />
                            </a>
                          )}

                          <button
                            type="button"
                            onClick={() => handleOpenJourney(lead)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '0.38rem 0.8rem',
                              borderRadius: '6px',
                              background: '#4f46e5',
                              color: '#ffffff',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              border: 'none',
                              cursor: 'pointer',
                              boxShadow: '0 1px 3px rgba(79, 70, 229, 0.3)',
                              transition: 'all 0.15s ease',
                            }}
                            title="View Follow-Up Journey and Log Interactions"
                          >
                            <History size={13} />
                            <span>Journey ({(lead.classification.followUpCount || getLeadFollowUps(lead).length)}x)</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '0.85rem 1.5rem',
              borderTop: '1px solid #e2e8f0',
              background: '#f8fafc',
              display: 'flex',
              justifyContent: 'flex-end',
            }}>
              <button
                type="button"
                onClick={() => setActiveDrilldownMonth(null)}
                style={{
                  padding: '0.45rem 1rem',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#334155',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Journey & Follow-Up Modal */}
      {activeJourneyLead && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.72)',
          backdropFilter: 'blur(5px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1100,
          padding: '1rem',
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '680px',
            maxHeight: '88vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
            border: '1px solid #e2e8f0',
          }}>
            {/* Header */}
            <div style={{
              padding: '1.2rem 1.5rem',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'linear-gradient(to right, #f8fafc, #ffffff)',
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                    {activeJourneyLead.name || 'Customer Journey'}
                  </h3>
                  <span style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: '4px',
                    background: '#e0e7ff',
                    color: '#3730a3',
                    border: '1px solid #c7d2fe',
                  }}>
                    {getLeadFollowUps(activeJourneyLead).length}x Followed Up
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.2rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {activeJourneyLead.branch && <span>📍 {activeJourneyLead.branch}</span>}
                  {activeJourneyLead.phone && <span>📞 {activeJourneyLead.phone}</span>}
                  <span>Status: <strong>{activeJourneyLead.status}</strong></span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveJourneyLead(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  padding: '6px',
                  borderRadius: '6px',
                  display: 'inline-flex',
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Body (Scrollable) */}
            <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              {/* Customer Profile Details Card */}
              {(activeJourneyLead.message || activeJourneyLead.notes) && (
                <div style={{
                  padding: '0.85rem 1rem',
                  borderRadius: '8px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  fontSize: '0.8rem',
                  color: '#334155',
                }}>
                  <strong style={{ display: 'block', marginBottom: '0.25rem', color: '#0f172a' }}>Customer Profile & Inbound Context:</strong>
                  <div>{activeJourneyLead.message || activeJourneyLead.notes}</div>
                </div>
              )}

              {/* Journey Timeline */}
              <div>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <History size={16} color="#4f46e5" />
                  Follow-Up Journey Timeline ({getLeadFollowUps(activeJourneyLead).length} touches)
                </h4>

                {getLeadFollowUps(activeJourneyLead).length === 0 ? (
                  <div style={{
                    padding: '2rem 1rem',
                    textAlign: 'center',
                    background: '#f8fafc',
                    borderRadius: '10px',
                    border: '1px dashed #cbd5e1',
                    color: '#64748b',
                    fontSize: '0.82rem',
                  }}>
                    <Clock size={28} style={{ margin: '0 auto 0.5rem', color: '#94a3b8' }} />
                    <p style={{ margin: 0, fontWeight: 600 }}>No follow-up interactions logged yet.</p>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      Fill in the form below to record who contacted this parent and track their customer journey.
                    </span>
                  </div>
                ) : (
                  <div style={{
                    position: 'relative',
                    paddingLeft: '1.5rem',
                    borderLeft: '2px solid #e2e8f0',
                    marginLeft: '0.75rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                  }}>
                    {getLeadFollowUps(activeJourneyLead).map((fu, idx) => {
                      const channelColor =
                        fu.channel === 'WhatsApp' ? '#22c55e' :
                        fu.channel === 'Phone Call' ? '#3b82f6' :
                        fu.channel === 'In-Person Meeting' ? '#f97316' : '#8b5cf6';

                      return (
                        <div key={fu.id || idx} style={{ position: 'relative' }}>
                          {/* Dot Marker */}
                          <div style={{
                            position: 'absolute',
                            left: '-1.95rem',
                            top: '4px',
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: '#4f46e5',
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.65rem',
                            fontWeight: 800,
                            border: '2px solid #ffffff',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                          }}>
                            {idx + 1}
                          </div>

                          <div style={{
                            padding: '0.75rem 1rem',
                            background: '#ffffff',
                            borderRadius: '8px',
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.35rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a' }}>
                                  👤 {fu.performedBy || 'Staff'}
                                </span>
                                <span style={{
                                  fontSize: '0.66rem',
                                  fontWeight: 700,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  background: `${channelColor}18`,
                                  color: channelColor,
                                  border: `1px solid ${channelColor}40`,
                                }}>
                                  {fu.channel || 'WhatsApp'}
                                </span>
                                {fu.outcome && (
                                  <span style={{
                                    fontSize: '0.66rem',
                                    fontWeight: 600,
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    background: '#f1f5f9',
                                    color: '#475569',
                                  }}>
                                    {fu.outcome}
                                  </span>
                                )}
                              </div>
                              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                                {fu.date ? new Date(fu.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown date'}
                              </span>
                            </div>

                            {fu.notes && (
                              <div style={{ fontSize: '0.8rem', color: '#334155', lineHeight: '1.4', marginTop: '0.25rem' }}>
                                {fu.notes}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Log Follow-Up Interaction Form */}
              <form onSubmit={handleSaveFollowUp} style={{
                background: '#f8fafc',
                padding: '1.1rem 1.25rem',
                borderRadius: '12px',
                border: '1px solid #cbd5e1',
              }}>
                <h4 style={{ margin: '0 0 0.85rem 0', fontSize: '0.88rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Plus size={16} color="#4f46e5" />
                  Log Follow-Up Attempt ({getLeadFollowUps(activeJourneyLead).length + 1}x)
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>
                      Who is doing the follow-up? *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Kak Muhajir, Admin"
                      value={followUpFormData.performedBy}
                      onChange={(e) => setFollowUpFormData({ ...followUpFormData, performedBy: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '0.4rem 0.6rem',
                        fontSize: '0.82rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>
                      Channel
                    </label>
                    <select
                      value={followUpFormData.channel}
                      onChange={(e) => setFollowUpFormData({ ...followUpFormData, channel: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '0.4rem 0.6rem',
                        fontSize: '0.82rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="WhatsApp">WhatsApp</option>
                      <option value="Phone Call">Phone Call</option>
                      <option value="In-Person Meeting">In-Person Meeting</option>
                      <option value="Email">Email</option>
                      <option value="Instagram DM">Instagram DM</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>
                      Follow-up Outcome / Action
                    </label>
                    <select
                      value={followUpFormData.outcome}
                      onChange={(e) => setFollowUpFormData({ ...followUpFormData, outcome: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '0.4rem 0.6rem',
                        fontSize: '0.82rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="Need Follow Up">Need Follow Up (Still Considering)</option>
                      <option value="Trial Booked">Trial Booked (Scheduled Trial)</option>
                      <option value="Interested - Callback Requested">Interested - Callback Requested</option>
                      <option value="No Response">No Response / Unread</option>
                      <option value="Not Interested / Junk">Not Interested / Junk</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>
                      Update Lead Stage
                    </label>
                    <select
                      value={followUpFormData.status}
                      onChange={(e) => setFollowUpFormData({ ...followUpFormData, status: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '0.4rem 0.6rem',
                        fontSize: '0.82rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="profiling">Profiling (Needs Follow-Up)</option>
                      <option value="trial_booked">Trial Booked (Scheduled)</option>
                      <option value="interest_trial">Interest Trial</option>
                      <option value="no_response">No Response</option>
                      <option value="junk">Junk / Spam</option>
                    </select>
                  </div>
                </div>

                {followUpFormData.status === 'trial_booked' && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>
                      Trial Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={followUpFormData.trialDate}
                      onChange={(e) => setFollowUpFormData({ ...followUpFormData, trialDate: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '0.4rem 0.6rem',
                        fontSize: '0.82rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                      }}
                    />
                  </div>
                )}

                <div style={{ marginBottom: '0.85rem' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>
                    Conversation Notes / Remarks
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Enter what the parent said, questions, student hobbies, next steps..."
                    value={followUpFormData.notes}
                    onChange={(e) => setFollowUpFormData({ ...followUpFormData, notes: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.45rem 0.65rem',
                      fontSize: '0.82rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      resize: 'vertical',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button
                    type="submit"
                    disabled={isSavingFollowUp}
                    style={{
                      padding: '0.45rem 1.1rem',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      borderRadius: '6px',
                      border: 'none',
                      background: '#4f46e5',
                      color: '#ffffff',
                      cursor: isSavingFollowUp ? 'not-allowed' : 'pointer',
                      opacity: isSavingFollowUp ? 0.7 : 1,
                      boxShadow: '0 2px 4px rgba(79, 70, 229, 0.3)',
                    }}
                  >
                    {isSavingFollowUp ? 'Saving...' : `Save Follow-Up (${getLeadFollowUps(activeJourneyLead).length + 1}x)`}
                  </button>
                </div>
              </form>

            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '0.75rem 1.5rem',
              borderTop: '1px solid #e2e8f0',
              background: '#f8fafc',
              display: 'flex',
              justifyContent: 'flex-end',
            }}>
              <button
                type="button"
                onClick={() => setActiveJourneyLead(null)}
                style={{
                  padding: '0.45rem 1rem',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#334155',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
