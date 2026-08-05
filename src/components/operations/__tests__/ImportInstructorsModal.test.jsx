// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ImportInstructorsModal from '../ImportInstructorsModal';

describe('ImportInstructorsModal', () => {
  it('renders the header and components correctly', () => {
    render(
      <ImportInstructorsModal
        branches={[{ name: 'Bekasi' }, { name: 'Bintaro' }]}
        onClose={vi.fn()}
        onImportComplete={vi.fn()}
      />
    );

    expect(screen.getByText('Bulk Import Instructors')).toBeInTheDocument();
    expect(screen.getByText('Download CSV Template')).toBeInTheDocument();
    expect(screen.getByText('Click to select or drop your CSV / Excel file')).toBeInTheDocument();
  });
});
