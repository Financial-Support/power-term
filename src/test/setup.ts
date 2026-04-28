import '@testing-library/jest-dom/vitest';

// Patch makeNormalizer to preserve trailing whitespace by default, so that
// getByDisplayValue('text\n') can match a textarea with .value === 'text\n'.
// This is required because @testing-library/dom v10 trims node.value before
// comparing to the matcher string, which breaks exact newline assertions.
declare const require: (mod: string) => Record<string, unknown>;
const dtlMatches = require('@testing-library/dom/dist/matches') as {
  makeNormalizer: (opts?: { trim?: boolean; collapseWhitespace?: boolean; normalizer?: (s: string) => string }) => (text: string) => string;
};
const origMakeNormalizer = dtlMatches.makeNormalizer;
dtlMatches.makeNormalizer = (opts: { trim?: boolean; collapseWhitespace?: boolean; normalizer?: (s: string) => string } = {}) => {
  if (!opts.normalizer && opts.trim === undefined && opts.collapseWhitespace === undefined) {
    // When no options are explicitly given, use identity normalizer to preserve
    // the exact value (including trailing newlines) for display-value matching.
    return (text: string) => text;
  }
  return origMakeNormalizer(opts);
};
