// jest-dom adds custom matchers for asserting on DOM nodes (e.g. toHaveTextContent).
import '@testing-library/jest-dom/vitest';

// Every test starts from an empty localStorage — auth tokens and
// per-user conversation keys must not leak between cases.
beforeEach(() => {
  localStorage.clear();
});
