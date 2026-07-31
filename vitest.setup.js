// Registers the jest-dom matchers on Vitest's expect and unmounts any rendered
// component tree between tests so DOM assertions never see a previous test's output.
//
// The default test environment is `node` (see vitest.config.mjs); only files
// carrying a `// @vitest-environment jsdom` docblock get a DOM. This setup file
// is still global, so everything DOM-dependent is loaded behind a `document`
// check: in a node environment there is nothing to attach matchers to and
// nothing to unmount, and importing @testing-library/react there would either
// fail or pull in react-dom for no reason.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');
  const { afterEach } = await import('vitest');

  afterEach(() => {
    cleanup();
  });
}
