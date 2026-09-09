// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const subscribeToInternalStudents = vi.hoisted(() => vi.fn());
const getAllInternalStudents = vi.hoisted(() => vi.fn());
const bulkDeleteAllStudents = vi.hoisted(() => vi.fn());
const logActivity = vi.hoisted(() => vi.fn());
const downloadStudentExport = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

let mockAuthUser = {
  email: 'adit@thelab.id',
  username: 'adit',
  displayName: 'Adit Instructor',
  role: 'Instructor',
  location: 'Bintaro',
};

vi.mock('@/contexts/ScheduleContext', () => ({
  ScheduleProvider: ({ children }) => children,
  useSchedule: () => ({
    enabledBranches: [{ name: 'Bintaro' }, { name: 'Kelapa Gading' }, { name: 'Puri Indah' }],
    branches: [{ name: 'Bintaro' }, { name: 'Kelapa Gading' }, { name: 'Puri Indah' }],
    users: { 'adit@thelab.id': 'Instructor' },
    rolePermissions: {},
    userPermissions: {},
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ user: mockAuthUser }),
}));

vi.mock('@/components/ui/Toast', () => ({
  ToastProvider: ({ children }) => children,
  useToast: () => ({ showToast, dismissToast: () => {} }),
}));

vi.mock('@/services/internalStudentService', async (importOriginal) => ({
  ...(await importOriginal()),
  subscribeToInternalStudents,
  getAllInternalStudents,
  bulkDeleteAllStudents,
}));

vi.mock('@/services/newActivityService', () => ({
  logActivity,
  getActivity: vi.fn(async () => []),
  subscribeToActivity: vi.fn(() => () => {}),
  deleteActivity: vi.fn(async () => ({})),
  displayUser: (email) => (email ? String(email).split('@')[0] : 'Unknown user'),
}));

vi.mock('@/lib/studentExport', () => ({
  STUDENT_EXPORT_HEADERS: ['ID', 'Name', 'Level', 'Branch'],
  buildStudentExportRows: () => [],
  studentExportFileName: () => 'students.xlsx',
  downloadStudentExport,
}));

const { default: NewStudentsPage } = await import('@/views/NewStudentsPage');

const MOCK_STUDENTS = [
  {
    id: 1,
    name: 'Student Bintaro 1',
    level: 'J1',
    branchName: 'Bintaro',
    parentName: 'Parent 1',
    contact: '0811111111',
    status: 'Active',
    subscription: '3 Months',
    remarks: 'Bintaro student',
  },
  {
    id: 2,
    name: 'Student Bintaro 2',
    level: 'Kinder Foundation',
    branchName: 'Bintaro',
    parentName: 'Parent 2',
    contact: '0822222222',
    status: 'Active',
    subscription: '3 Months',
    remarks: 'Bintaro student',
  },
  {
    id: 3,
    name: 'Student Kelapa Gading',
    level: 'Coder Basic',
    branchName: 'Kelapa Gading',
    parentName: 'Parent 3',
    contact: '0833333333',
    status: 'Active',
    subscription: '3 Months',
    remarks: 'Kelapa Gading student',
  },
  {
    id: 4,
    name: 'Student Puri Indah',
    level: 'Coder Advance',
    branchName: 'Puri Indah',
    parentName: 'Parent 4',
    contact: '0844444444',
    status: 'Active',
    subscription: '3 Months',
    remarks: 'Puri Indah student',
  },
];

function mountPage() {
  subscribeToInternalStudents.mockImplementation((callback) => {
    callback(MOCK_STUDENTS);
    return () => {};
  });
  return render(<NewStudentsPage />);
}

describe('NewStudentsPage branch restriction for assigned instructors', () => {
  beforeEach(() => {
    showToast.mockReset();
    subscribeToInternalStudents.mockReset();
  });

  it('restricts assigned instructor view strictly to their assigned branch', () => {
    mockAuthUser = {
      email: 'adit@thelab.id',
      username: 'adit',
      displayName: 'Adit Instructor',
      role: 'Instructor',
      location: 'Bintaro',
    };

    mountPage();

    // Should display Bintaro students
    expect(screen.getByText('Student Bintaro 1')).toBeInTheDocument();
    expect(screen.getByText('Student Bintaro 2')).toBeInTheDocument();

    // Should NOT display students from other branches
    expect(screen.queryByText('Student Kelapa Gading')).not.toBeInTheDocument();
    expect(screen.queryByText('Student Puri Indah')).not.toBeInTheDocument();

    // Header badge shows locked assigned branch
    expect(screen.getByText(/Assigned/i)).toBeInTheDocument();
    expect(screen.getAllByText('Bintaro').length).toBeGreaterThan(0);

    // Branch select dropdown should be disabled and set to Bintaro
    const selects = screen.getAllByRole('combobox');
    // The branch select is the second select (Level, Branch, Status, Subscription)
    const branchSelect = selects.find(sel => Array.from(sel.options).some(o => o.value === 'Bintaro'));
    expect(branchSelect).toBeDefined();
    expect(branchSelect).toBeDisabled();
    expect(branchSelect.value).toBe('Bintaro');
  });

  it('allows Admin full unrestricted access across all branches', () => {
    mockAuthUser = {
      email: 'admin@thelab.id',
      username: 'admin',
      displayName: 'Admin User',
      role: 'Admin',
    };

    mountPage();

    // Should display students from all branches
    expect(screen.getByText('Student Bintaro 1')).toBeInTheDocument();
    expect(screen.getByText('Student Bintaro 2')).toBeInTheDocument();
    expect(screen.getByText('Student Kelapa Gading')).toBeInTheDocument();
    expect(screen.getByText('Student Puri Indah')).toBeInTheDocument();

    // Header badge shows All Branches and Global
    expect(screen.getByText('Global')).toBeInTheDocument();
    expect(screen.getAllByText('All Branches').length).toBeGreaterThan(0);

    // Branch select dropdown is NOT disabled
    const selects = screen.getAllByRole('combobox');
    const branchSelect = selects.find(sel => Array.from(sel.options).some(o => o.value === 'all'));
    expect(branchSelect).toBeDefined();
    expect(branchSelect).not.toBeDisabled();
  });
});
