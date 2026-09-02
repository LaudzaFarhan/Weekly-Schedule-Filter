// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const subscribeToInternalClasses = vi.hoisted(() => vi.fn());
const subscribeToInternalInstructors = vi.hoisted(() => vi.fn());
const subscribeToInternalStudents = vi.hoisted(() => vi.fn());
const subscribeToLiveProgress = vi.hoisted(() => vi.fn());
const saveLiveProgress = vi.hoisted(() => vi.fn(async () => ({})));
const showToast = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: () => ({
    enabledBranches: [{ name: 'Kelapa Gading' }, { name: 'Puri Indah' }],
    branches: [{ name: 'Kelapa Gading' }, { name: 'Puri Indah' }],
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'admin@thelab.id' } }),
}));

vi.mock('@/services/newActivityService', () => ({
  logActivity: vi.fn(async () => ({})),
  displayUser: (email) => (email ? email.split('@')[0] : 'Unknown'),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('@/services/internalScheduleService', () => ({
  subscribeToInternalClasses,
  updateInternalClass: vi.fn(async () => ({})),
  createInternalClass: vi.fn(async () => ({})),
  deleteInternalClass: vi.fn(async () => ({})),
}));

vi.mock('@/services/internalInstructorService', () => ({
  subscribeToInternalInstructors,
}));

const updateInternalStudent = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('@/services/internalStudentService', () => ({
  subscribeToInternalStudents,
  updateInternalStudent,
}));

vi.mock('@/services/newLiveProgressService', () => ({
  subscribeToLiveProgress,
  saveLiveProgress,
}));

const { default: LiveProgressTable } = await import('@/views/LiveProgressTable');

describe('LiveProgressTable - Unassigned Students & Unregistered Instructors', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Registered instructor: Only "Ziyah" is registered in instructorProfiles
    subscribeToInternalInstructors.mockImplementation((cb) => {
      cb([
        { id: 'ziyah@lab.id', name: 'Ziyah', fullname: 'Fauziyah Amira Zahra', branches: ['Kelapa Gading'] },
      ]);
      return () => {};
    });

    // Classes: Student A is taught by "Ziyah" (registered), Student B is taught by "Sherlyn" (unregistered)
    subscribeToInternalClasses.mockImplementation((cb) => {
      cb([
        {
          id: 'c1',
          teacher: 'Ziyah',
          student: 'Arya Arkananta',
          day: 'Monday',
          time: '3:00 PM - 4:30 PM',
          branchName: 'Kelapa Gading',
          program: 'K1',
          classType: 'Regular',
        },
        {
          id: 'c2',
          teacher: 'Sherlyn', // Instructor not added in website yet
          student: 'Marvel Benedict',
          day: 'Monday',
          time: '1:00 PM - 2:30 PM',
          branchName: 'Kelapa Gading',
          program: 'KF2',
          classType: 'Regular',
        },
      ]);
      return () => {};
    });

    // Student Registry: Includes Liam and Kenzo who have no class row yet
    subscribeToInternalStudents.mockImplementation((cb) => {
      cb([
        { id: 's1', name: 'Arya Arkananta', level: 'Kinder Core', branchName: 'Kelapa Gading', status: 'Active' },
        { id: 's2', name: 'Marvel Benedict', level: 'Kinder Foundation', branchName: 'Kelapa Gading', status: 'Active' },
        { id: 's3', name: 'Liam Theodore', level: 'Kinder Foundation', branchName: 'Kelapa Gading', status: 'Active', remarks: 'Instructor: Sherlyn | Schedule: Monday 1.00-2.30pm' },
        { id: 's4', name: 'Kenzo Smith', level: 'Kinder Core', branchName: 'Kelapa Gading', status: 'Active' },
      ]);
      return () => {};
    });

    subscribeToLiveProgress.mockImplementation((cb) => {
      cb([]);
      return () => {};
    });
  });

  it('renders all students including those with unadded instructors (Sherlyn) and without class slots', () => {
    render(<LiveProgressTable category="Kinder" />);

    expect(screen.getByText('Arya Arkananta')).toBeInTheDocument();
    expect(screen.getByText('Marvel Benedict')).toBeInTheDocument();
    expect(screen.getByText('Liam Theodore')).toBeInTheDocument();
    expect(screen.getByText('Kenzo Smith')).toBeInTheDocument();
  });

  it('flags unadded instructor (Sherlyn) as Unassigned with "Not in website" badge', () => {
    render(<LiveProgressTable category="Kinder" />);

    // Marvel Benedict and Liam Theodore have teacher "Sherlyn" who is not in instructorProfiles
    expect(screen.getAllByText('Sherlyn').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Not in website').length).toBeGreaterThanOrEqual(1);

    // Both Marvel Benedict & Liam Theodore & Kenzo Smith have UNASSIGNED badges
    const unassignedBadges = screen.getAllByText('UNASSIGNED');
    expect(unassignedBadges.length).toBeGreaterThanOrEqual(3);
  });

  it('displays the Unassigned Students count badge in the header', () => {
    render(<LiveProgressTable category="Kinder" />);

    const unassignedHeaderBadge = screen.getByTitle('Click to filter Unassigned students');
    expect(unassignedHeaderBadge).toBeInTheDocument();
    expect(within(unassignedHeaderBadge).getByText('3')).toBeInTheDocument(); // Marvel Benedict, Liam Theodore, Kenzo Smith
  });

  it('filters to only unassigned students when clicking the Unassigned header badge', async () => {
    render(<LiveProgressTable category="Kinder" />);

    const unassignedHeaderBadge = screen.getByTitle('Click to filter Unassigned students');
    fireEvent.click(unassignedHeaderBadge);

    // Only unassigned students should be visible
    expect(screen.getByText('Marvel Benedict')).toBeInTheDocument();
    expect(screen.getByText('Liam Theodore')).toBeInTheDocument();
    expect(screen.getByText('Kenzo Smith')).toBeInTheDocument();
    expect(screen.queryByText('Arya Arkananta')).not.toBeInTheDocument();
  });

  it('filters to only unassigned students when selecting Unassigned in Status dropdown', async () => {
    render(<LiveProgressTable category="Kinder" />);

    const statusSelect = screen.getByLabelText('Status');
    fireEvent.change(statusSelect, { target: { value: 'Unassigned' } });

    expect(screen.getByText('Marvel Benedict')).toBeInTheDocument();
    expect(screen.getByText('Liam Theodore')).toBeInTheDocument();
    expect(screen.getByText('Kenzo Smith')).toBeInTheDocument();
    expect(screen.queryByText('Arya Arkananta')).not.toBeInTheDocument();
  });

  it('displays the arrangement button for unassigned students', () => {
    render(<LiveProgressTable category="Kinder" />);

    const arrangeButtons = screen.getAllByTitle(/Click to arrange lesson/i);
    expect(arrangeButtons.length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('+ Assign Instructor')).toBeInTheDocument();
  });

  it('filters students by branch when selecting branch from dropdown', () => {
    render(<LiveProgressTable category="Kinder" />);

    const branchSelect = screen.getByDisplayValue('All Branches');
    expect(branchSelect).toBeInTheDocument();

    // Change to Puri Indah (where no students belong in test data)
    fireEvent.change(branchSelect, { target: { value: 'Puri Indah' } });
    expect(screen.getByText('No student matches your filters.')).toBeInTheDocument();

    // Change back to Kelapa Gading
    fireEvent.change(branchSelect, { target: { value: 'Kelapa Gading' } });
    expect(screen.getByText('Arya Arkananta')).toBeInTheDocument();
  });

  it('opens video attachment modal, attaches google drive video link, and saves', async () => {
    render(<LiveProgressTable category="Kinder" />);

    // Find the KF1 video button for Arya Arkananta
    const kf1Btns = screen.getAllByRole('button', { name: /KF1/i });
    expect(kf1Btns.length).toBeGreaterThanOrEqual(1);

    // Click on the first KF1 button to open modal
    fireEvent.click(kf1Btns[0]);

    // Modal should appear
    expect(screen.getByText('Attach Video Link')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/drive\.google\.com/i)).toBeInTheDocument();

    // Type video link
    const input = screen.getByPlaceholderText(/drive\.google\.com/i);
    fireEvent.change(input, { target: { value: 'https://drive.google.com/file/d/12345/view' } });

    // Click Save Video Link
    const saveBtn = screen.getByRole('button', { name: /Save Video Link/i });
    fireEvent.click(saveBtn);

    expect(saveLiveProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        videos: expect.objectContaining({
          KF1: expect.objectContaining({
            link: 'https://drive.google.com/file/d/12345/view',
          }),
        }),
      })
    );
  });

  it('renders dynamic attendance buttons matching student subscription package (24 meetings)', () => {
    subscribeToInternalStudents.mockImplementation((cb) => {
      cb([
        { id: 's-coder', name: 'Aaron Sudjana', level: 'Coder Advance', branchName: 'Puri Indah', status: 'Active', remarks: '[TargetMeetings: 24]' },
      ]);
      return () => {};
    });
    subscribeToInternalClasses.mockImplementation((cb) => {
      cb([
        {
          id: 'c-coder',
          teacher: 'Iqbal',
          student: 'Aaron Sudjana',
          day: 'Monday',
          time: '3:00 PM - 4:30 PM',
          branchName: 'Puri Indah',
          program: 'Coder Advance',
          classType: 'Regular',
        },
      ]);
      return () => {};
    });

    render(<LiveProgressTable category="Coder" />);

    expect(screen.getByText('Aaron Sudjana')).toBeInTheDocument();
    // Meeting 24 button should be present
    const meeting24 = screen.getByRole('button', { name: /Meeting 24 for Aaron Sudjana/i });
    expect(meeting24).toBeInTheDocument();
    expect(screen.getByText(/0 \/ 24 meetings \(0%\)/i)).toBeInTheDocument();
  });

  it('opens lesson arrangement modal when clicking lesson arrangement button', () => {
    render(<LiveProgressTable category="Kinder" />);

    const arrangeButtons = screen.getAllByTitle(/Click to arrange lesson/i);
    fireEvent.click(arrangeButtons[0]);

    expect(screen.getByRole('heading', { name: /Lesson Arrangement/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save Lesson Arrangement/i })).toBeInTheDocument();
  });

  it('renders student name with clickable Zoho link and opens in new tab when zohoLink is present', () => {
    subscribeToInternalStudents.mockImplementation((cb) => {
      cb([
        {
          id: 's-zoho',
          name: 'Azlan Djohar',
          level: 'Kinder Core',
          branchName: 'Puri Indah',
          status: 'Active',
          remarks: '[Zoho: https://crm.zoho.com/crm/org123/tab/Leads/987654321]',
        },
      ]);
      return () => {};
    });
    subscribeToInternalClasses.mockImplementation((cb) => {
      cb([
        {
          id: 'c-zoho',
          teacher: 'Ziyah',
          student: 'Azlan Djohar',
          day: 'Monday',
          time: '3:00 PM - 4:30 PM',
          branchName: 'Puri Indah',
          program: 'K1',
          classType: 'Regular',
        },
      ]);
      return () => {};
    });

    render(<LiveProgressTable category="Kinder" />);

    const zohoAnchor = screen.getByRole('link', { name: /Azlan Djohar/i });
    expect(zohoAnchor).toBeInTheDocument();
    expect(zohoAnchor).toHaveAttribute('href', 'https://crm.zoho.com/crm/org123/tab/Leads/987654321');
    expect(zohoAnchor).toHaveAttribute('target', '_blank');
  });

  it('opens Attach Zoho Link modal, enters URL, and saves to student record', async () => {
    subscribeToInternalStudents.mockImplementation((cb) => {
      cb([
        {
          id: 's-osvaldo',
          name: 'Osvaldo Louvin Widjaya',
          level: 'Kinder Core',
          branchName: 'Puri Indah',
          status: 'Active',
          remarks: '',
        },
      ]);
      return () => {};
    });
    subscribeToInternalClasses.mockImplementation((cb) => {
      cb([
        {
          id: 'c-osvaldo',
          teacher: 'Ziyah',
          student: 'Osvaldo Louvin Widjaya',
          day: 'Tuesday',
          time: '3:00 PM - 4:30 PM',
          branchName: 'Puri Indah',
          program: 'K1',
          classType: 'Regular',
        },
      ]);
      return () => {};
    });

    render(<LiveProgressTable category="Kinder" />);

    // Click student name or attach button
    const studentBtn = screen.getByText('Osvaldo Louvin Widjaya');
    fireEvent.click(studentBtn);

    // Modal appears
    expect(screen.getByRole('heading', { name: /Zoho Attachment Link/i })).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/https:\/\/crm\.zoho\.com/i);
    expect(input).toBeInTheDocument();

    // Type Zoho URL
    fireEvent.change(input, { target: { value: 'https://crm.zoho.com/crm/org123/tab/Contacts/555666' } });

    // Click Save Zoho Link
    const saveBtn = screen.getByRole('button', { name: /Save Zoho Link/i });
    fireEvent.click(saveBtn);

    expect(updateInternalStudent).toHaveBeenCalledWith(
      's-osvaldo',
      expect.objectContaining({
        zohoLink: 'https://crm.zoho.com/crm/org123/tab/Contacts/555666',
        remarks: expect.stringContaining('https://crm.zoho.com/crm/org123/tab/Contacts/555666'),
      })
    );
  });

  it('filters students by Allocation: Hide Unallocated, Show All, and Only Unallocated', async () => {
    // Student 1 (Arya) is allocated with class; Student 3 (Liam) is unassigned without class
    render(<LiveProgressTable category="Kinder" />);

    // Initially (Show All), both allocated and unallocated students are present
    expect(screen.getByText('Arya Arkananta')).toBeInTheDocument();
    expect(screen.getByText('Liam Theodore')).toBeInTheDocument();

    // Select "Hide Unallocated (Allocated Only)"
    const allocationSelect = screen.getByRole('combobox', { name: /Allocation/i });
    fireEvent.change(allocationSelect, { target: { value: 'allocated' } });

    // Arya is present, but Liam (unallocated) is hidden
    expect(screen.getByText('Arya Arkananta')).toBeInTheDocument();
    expect(screen.queryByText('Liam Theodore')).not.toBeInTheDocument();

    // Select "Show Only Unallocated"
    fireEvent.change(allocationSelect, { target: { value: 'unallocated' } });

    // Liam (unallocated) is present, but Arya (allocated) is hidden
    expect(screen.getByText('Liam Theodore')).toBeInTheDocument();
    expect(screen.queryByText('Arya Arkananta')).not.toBeInTheDocument();

    // Select "Show All (With Unallocated)"
    fireEvent.change(allocationSelect, { target: { value: 'all' } });

    // Both are shown again
    expect(screen.getByText('Arya Arkananta')).toBeInTheDocument();
    expect(screen.getByText('Liam Theodore')).toBeInTheDocument();
  });

  it('displays Need Update column and badge when attendance reaches 7 lessons', () => {
    // Student 1 (Arya) has attendance on 7 lessons
    subscribeToLiveProgress.mockImplementation((cb) => {
      cb([
        {
          studentName: 'Arya Arkananta',
          programCode: 'K1',
          category: 'Kinder',
          attendance: {
            1: { date: '2026-08-01', note: 'Lesson 1' },
            2: { date: '2026-08-08', note: 'Lesson 2' },
            3: { date: '2026-08-15', note: 'Lesson 3' },
            4: { date: '2026-08-22', note: 'Lesson 4' },
            5: { date: '2026-08-29', note: 'Lesson 5' },
            6: { date: '2026-09-05', note: 'Lesson 6' },
            7: { date: '2026-09-12', note: 'Lesson 7' },
          },
        },
      ]);
      return () => {};
    });

    render(<LiveProgressTable category="Kinder" />);

    // Table header should contain "Need Update"
    expect(screen.getByRole('columnheader', { name: /Need Update/i })).toBeInTheDocument();

    // The badge "Need Update" should appear for Arya
    const needUpdateBadges = screen.getAllByText('Need Update');
    expect(needUpdateBadges.length).toBeGreaterThan(0);
  });

  it('filters students when clicking Need Update header badge', () => {
    subscribeToLiveProgress.mockImplementation((cb) => {
      cb([
        {
          studentName: 'Arya Arkananta',
          programCode: 'K1',
          category: 'Kinder',
          attendance: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} },
        },
        {
          studentName: 'Marvel Benedict',
          programCode: 'KF2',
          category: 'Kinder',
          attendance: { 1: {}, 2: {} },
        },
      ]);
      return () => {};
    });

    render(<LiveProgressTable category="Kinder" />);

    // Both Arya and Marvel initially visible
    expect(screen.getByText('Arya Arkananta')).toBeInTheDocument();
    expect(screen.getByText('Marvel Benedict')).toBeInTheDocument();

    // Click "Need Update" filter badge in header
    const needUpdateBadge = screen.getByTitle('Click to filter students that need progress update');
    expect(needUpdateBadge).toBeInTheDocument();
    fireEvent.click(needUpdateBadge);

    // Only Arya (7 lessons) should be visible, Marvel (2 lessons) hidden
    expect(screen.getByText('Arya Arkananta')).toBeInTheDocument();
    expect(screen.queryByText('Marvel Benedict')).not.toBeInTheDocument();
  });

  it('records user account audit info when saving attendance', async () => {
    render(<LiveProgressTable category="Kinder" />);

    // Click meeting 1 button for Arya Arkananta
    const meeting1Btn = screen.getByRole('button', { name: /Meeting 1 for Arya Arkananta/i });
    fireEvent.click(meeting1Btn);

    // Save attendance modal opens
    const saveBtn = screen.getByRole('button', { name: /^Save$/i });
    fireEvent.click(saveBtn);

    expect(saveLiveProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        studentName: 'Arya Arkananta',
        attendance: expect.objectContaining({
          1: expect.objectContaining({
            recordedBy: 'admin@thelab.id',
          }),
        }),
      })
    );
  });

  it('opens AttendanceDetailHistoryModal when clicking the View Detail Attendance button', () => {
    subscribeToLiveProgress.mockImplementation((cb) => {
      cb([
        {
          studentName: 'Arya Arkananta',
          programCode: 'K1',
          category: 'Kinder',
          arrangedLesson: '3',
          arrangedTeacher: 'Sherlyn',
          attendance: {
            1: { date: '2026-08-01', note: 'Shapes', recordedBy: 'ziyah@thelab.id', teacher: 'Ziyah' },
            2: { date: '2026-08-08', note: 'Counting', recordedBy: 'admin@thelab.id' },
          },
        },
      ]);
      return () => {};
    });

    render(<LiveProgressTable category="Kinder" />);

    // Find the View Detail Attendance button for Arya
    const viewDetailBtn = screen.getByRole('button', { name: /View detailed attendance history for Arya Arkananta/i });
    expect(viewDetailBtn).toBeInTheDocument();

    // Click to open modal
    fireEvent.click(viewDetailBtn);

    // Check modal contents
    expect(screen.getByRole('dialog', { name: /Arya Arkananta/i })).toBeInTheDocument();
    expect(screen.getByText('Attendance Progress')).toBeInTheDocument();
    expect(screen.getByText('Teacher Tracking Status')).toBeInTheDocument();

    // Teacher tracking for lesson 1 (Ziyah)
    expect(screen.getByText(/Filled by Assigned Teacher \(Ziyah\)/i)).toBeInTheDocument();

    // Teacher tracking for lesson 2 (admin)
    expect(screen.getByText(/Filled by admin@thelab\.id/i)).toBeInTheDocument();

    // Teacher tracking for arranged lesson 3 (pending Sherlyn)
    expect(screen.getByText(/Not Filled by Sherlyn/i)).toBeInTheDocument();
  });

  it('opens ProgressUpdateModal when clicking the Need Update status badge and updates status', async () => {
    subscribeToLiveProgress.mockImplementation((cb) => {
      cb([
        {
          studentName: 'Arya Arkananta',
          programCode: 'K1',
          category: 'Kinder',
          attendance: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} },
        },
      ]);
      return () => {};
    });

    render(<LiveProgressTable category="Kinder" />);

    // Click the Need Update badge for Arya
    const needUpdateBtn = screen.getByRole('button', { name: /Progress update status: Need Update for Arya Arkananta/i });
    expect(needUpdateBtn).toBeInTheDocument();
    fireEvent.click(needUpdateBtn);

    // Progress Update Modal should be open
    expect(screen.getByRole('dialog', { name: /Arya Arkananta/i })).toBeInTheDocument();
    expect(screen.getByText('Progress Update Workflow Status')).toBeInTheDocument();

    // Select "Update Scheduled"
    const scheduledOption = screen.getByText('Update Scheduled');
    fireEvent.click(scheduledOption);

    // Select date and time slot
    const dateInput = screen.getByLabelText(/Select Date/i);
    expect(dateInput).toBeInTheDocument();
    fireEvent.change(dateInput, { target: { value: '2026-09-04' } });

    const timeSelect = screen.getByLabelText(/Select Time Slot/i);
    expect(timeSelect).toBeInTheDocument();
    fireEvent.change(timeSelect, { target: { value: '04:30 PM' } });

    // Save workflow status
    const saveWorkflowBtn = screen.getByRole('button', { name: /Save Workflow Status/i });
    fireEvent.click(saveWorkflowBtn);

    expect(saveLiveProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        studentName: 'Arya Arkananta',
        progressUpdateStatus: 'Update Scheduled',
        progressUpdateDate: 'Fri, 4 Sep 2026 · 04:30 PM',
      })
    );
  });

  it('opens NextTermContinuationModal on Update Done status and resets attendance on confirm continue', async () => {
    subscribeToLiveProgress.mockImplementation((cb) => {
      cb([
        {
          studentName: 'Arya Arkananta',
          programCode: 'K1',
          category: 'Kinder',
          progressUpdateStatus: 'Update Done',
          attendance: { 1: { date: '2026-08-01' }, 2: { date: '2026-08-08' }, 3: {}, 4: {}, 5: {}, 6: {}, 7: {}, 8: {}, 9: {}, 10: {} },
        },
      ]);
      return () => {};
    });

    render(<LiveProgressTable category="Kinder" />);

    // Click on Update Done / Confirm Next Term badge
    const updateDoneBtn = screen.getByRole('button', { name: /Progress update status: Update Done for Arya Arkananta/i });
    expect(updateDoneBtn).toBeInTheDocument();
    fireEvent.click(updateDoneBtn);

    // Next Term Continuation Modal should be open
    expect(screen.getByText('Next Term Continuation Confirmation')).toBeInTheDocument();
    expect(screen.getByText('Confirm Continue')).toBeInTheDocument();

    // Submit confirmation
    const confirmBtn = screen.getByRole('button', { name: /Confirm Continue & Reset Attendance/i });
    fireEvent.click(confirmBtn);

    expect(saveLiveProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        studentName: 'Arya Arkananta',
        attendance: {},
        continuation: 'Continue',
        progressUpdateStatus: 'Completed',
        termHistory: expect.arrayContaining([
          expect.objectContaining({
            attendedCount: 10,
          }),
        ]),
      })
    );
  });

  it('opens NextTermContinuationModal on Wait Payment status and allows setting next term continuation', async () => {
    subscribeToLiveProgress.mockImplementation((cb) => {
      cb([
        {
          studentName: 'Arya Arkananta',
          programCode: 'K1',
          category: 'Kinder',
          progressUpdateStatus: 'Wait Payment',
          attendance: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {}, 8: {}, 9: {}, 10: {} },
        },
      ]);
      return () => {};
    });

    render(<LiveProgressTable category="Kinder" />);

    const waitPaymentBtn = screen.getByRole('button', { name: /Progress update status: Wait Payment for Arya Arkananta/i });
    expect(waitPaymentBtn).toBeInTheDocument();
    fireEvent.click(waitPaymentBtn);

    expect(screen.getByText('Next Term Continuation Confirmation')).toBeInTheDocument();
  });
});






