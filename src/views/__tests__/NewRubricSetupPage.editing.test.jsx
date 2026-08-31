// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewRubricSetupPage from '../NewRubricSetupPage';

const getRubricCompetencies = vi.hoisted(() => vi.fn());
const createRubricCompetency = vi.hoisted(() => vi.fn());
const updateRubricCompetency = vi.hoisted(() => vi.fn());
const reorderRubricCompetencies = vi.hoisted(() => vi.fn());
const deleteRubricCompetency = vi.hoisted(() => vi.fn());

vi.mock('@/services/rubricCompetenciesService', () => ({
  getRubricCompetencies,
  createRubricCompetency,
  updateRubricCompetency,
  reorderRubricCompetencies,
  deleteRubricCompetency,
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { role: 'Admin', username: 'admin' },
  }),
}));

describe('NewRubricSetupPage Per-Program Rubric Editing', () => {
  const mockCompetenciesData = {
    categories: ['Kinder', 'Junior', 'Coder'],
    competencies: {
      Kinder: [
        {
          id: 1,
          category: 'Kinder',
          key: 'concept',
          label: 'Kinder Concept',
          color: '#3b82f6',
          sortOrder: 0,
          descriptors: {
            5: 'Kinder 5 - Independent',
            4: 'Kinder 4 - Minimal help',
            3: 'Kinder 3 - Some guidance',
            2: 'Kinder 2 - Step-by-step',
            1: 'Kinder 1 - Early stage',
          },
          active: true,
        },
      ],
      Junior: [
        {
          id: 2,
          category: 'Junior',
          key: 'concept',
          label: 'Junior Concept',
          color: '#f97316',
          sortOrder: 0,
          descriptors: {
            5: 'Junior 5 - Independent',
            4: 'Junior 4 - Minimal help',
            3: 'Junior 3 - Some guidance',
            2: 'Junior 2 - Step-by-step',
            1: 'Junior 1 - Early stage',
          },
          active: true,
        },
      ],
      Coder: [
        {
          id: 3,
          category: 'Coder',
          key: 'concept',
          label: 'Coder Logic & Algorithms',
          color: '#10b981',
          sortOrder: 0,
          descriptors: {
            5: 'Coder 5 - Solves advanced logic',
            4: 'Coder 4 - Minor debugging assistance',
            3: 'Coder 3 - Guided syntax structure',
            2: 'Coder 2 - Frequent syntax help',
            1: 'Coder 1 - Needs line-by-line guidance',
          },
          active: true,
        },
      ],
    },
    usingFallback: {
      Kinder: false,
      Junior: false,
      Coder: false,
    },
    maxPerCategory: 8,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getRubricCompetencies.mockResolvedValue(mockCompetenciesData);
    createRubricCompetency.mockResolvedValue({ success: true });
    updateRubricCompetency.mockResolvedValue({ success: true });
    deleteRubricCompetency.mockResolvedValue({ success: true });
  });

  it('renders program tabs and switches between Kinder, Junior, and Coder', async () => {
    const user = userEvent.setup();
    render(<NewRubricSetupPage />);

    // Initially loads Kinder
    expect(await screen.findByText('Kinder Scoring Guidelines')).toBeInTheDocument();
    expect(screen.getByText('Kinder Concept')).toBeInTheDocument();
    expect(screen.getByText('Kinder 5 - Independent')).toBeInTheDocument();

    // Click on "Coder" tab
    const coderTab = screen.getByRole('button', { name: /Coder/i });
    await user.click(coderTab);

    // Header and cards update to Coder
    expect(screen.getByText('Coder Scoring Guidelines')).toBeInTheDocument();
    expect(screen.getByText('Coder Logic & Algorithms')).toBeInTheDocument();
    expect(screen.getByText('Coder 5 - Solves advanced logic')).toBeInTheDocument();
  });

  it('enters edit mode, allows editing label & descriptors, and saves changes', async () => {
    const user = userEvent.setup();
    render(<NewRubricSetupPage />);

    expect(await screen.findByText('Kinder Concept')).toBeInTheDocument();

    // Click Edit Rubric
    const editBtn = screen.getByRole('button', { name: /Edit Rubric/i });
    await user.click(editBtn);

    // Label input becomes editable
    const labelInput = screen.getByDisplayValue('Kinder Concept');
    await user.clear(labelInput);
    await user.type(labelInput, 'Early Explorations');

    // Descriptor 5 becomes editable
    const desc5Input = screen.getByDisplayValue('Kinder 5 - Independent');
    await user.clear(desc5Input);
    await user.type(desc5Input, 'Explores freely with confidence');

    // Click Done & Save All
    const saveAllBtn = screen.getByRole('button', { name: /Done & Save All/i });
    await user.click(saveAllBtn);

    expect(updateRubricCompetency).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        label: 'Early Explorations',
        descriptors: expect.objectContaining({
          5: 'Explores freely with confidence',
        }),
      })
    );
  });

  it('opens add competency modal and submits new competency', async () => {
    const user = userEvent.setup();
    render(<NewRubricSetupPage />);

    expect(await screen.findByText('Kinder Scoring Guidelines')).toBeInTheDocument();

    // Click Add Competency
    const addBtn = screen.getByRole('button', { name: /Add Competency/i });
    await user.click(addBtn);

    // Modal opens
    expect(screen.getByText(/Add Competency for Kinder/i)).toBeInTheDocument();

    const keyInput = screen.getByPlaceholderText('e.g. logicCode');
    const labelInput = screen.getByPlaceholderText('e.g. Logic & Code');

    await user.type(keyInput, 'motorSkills');
    await user.type(labelInput, 'Fine Motor Skills');

    const modal = screen.getByRole('dialog');
    const submitBtn = within(modal).getByRole('button', { name: /^Add Competency$/i });
    await user.click(submitBtn);

    expect(createRubricCompetency).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'Kinder',
        key: 'motorSkills',
        label: 'Fine Motor Skills',
      })
    );
  });
});
