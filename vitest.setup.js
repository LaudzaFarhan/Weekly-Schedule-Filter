// Registers the jest-dom matchers on Vitest's expect and unmounts any rendered
// component tree between tests so DOM assertions never see a previous test's output.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
