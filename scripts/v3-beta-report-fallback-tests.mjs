import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/v3-beta-publish.yml', import.meta.url), 'utf8');
const report = workflow.split('  report:\n')[1];
assert.ok(report, 'publish report job exists');
assert.match(report, /if: always\(\)/, 'report executes on deployment failure');
assert.match(report, /NOT YET VERIFIED/, 'failure is explicitly reported');
assert.match(report, /ONLINE VERIFIED/, 'success requires verify job success');
assert.match(report, /GITHUB_STEP_SUMMARY/, 'result survives comment permission failures');
assert.match(report, /gh api --method POST "repos\/\$REPO\/issues\/54\/comments"/, 'use REST comment endpoint');
assert.match(report, /if ! gh api/, 'comment permissions must not erase job result');
assert.doesNotMatch(report, /gh issue comment/, 'avoid GraphQL addComment integration denial');
console.log('V3 beta report fallback contract passed');
