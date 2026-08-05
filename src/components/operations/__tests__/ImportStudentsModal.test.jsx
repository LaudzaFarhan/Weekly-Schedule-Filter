// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ImportStudentsModal from '../ImportStudentsModal';

describe('ImportStudentsModal', () => {
  it('renders the header and buttons correctly', () => {
    render(
      <ImportStudentsModal
        branches={[{ name: 'Bekasi' }, { name: 'Bintaro' }]}
        defaultBranch="Bekasi"
        onClose={vi.fn()}
        onImportComplete={vi.fn()}
      />
    );

    expect(screen.getByText('Bulk Import Students')).toBeInTheDocument();
    expect(screen.getByText('Download Sample Format (.xlsx)')).toBeInTheDocument();
    expect(screen.getByText('Target Branch')).toBeInTheDocument();
  });
});
