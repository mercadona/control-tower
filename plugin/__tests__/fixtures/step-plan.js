export class StepPlanMother {
  static WORK = 'work with spaces.txt'

  static oneTask() {
    return [
      '# Boundary scenario', '## 7. Tasks', '### Task 1 — do the work',
      '**Objective:** the declared work is committed.',
      '**Files:** `work with spaces.txt` (create).',
      '**TDD:** No TDD — fixture.', '**Tests:** N/A — fixture.',
      '**Verification:** the file exists.', '```bash', 'test -f "work with spaces.txt"', '```',
      '## 8. Global verification', 'N/A — fixture.', '',
    ].join('\n')
  }
}
