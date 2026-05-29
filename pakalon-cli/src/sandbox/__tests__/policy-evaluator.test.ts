import { describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PolicyEvaluator } from '../policy-evaluator.js';

async function makeProject(): Promise<string> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pakalon-policy-'));
  await fs.mkdir(path.join(projectDir, '.pakalon-agents', 'phase-4'), { recursive: true });
  await fs.mkdir(path.join(projectDir, '.pakalon'), { recursive: true });
  return projectDir;
}

describe('PolicyEvaluator', () => {
  it('normalizes security-policy.yml vulnerability threshold aliases', async () => {
    const projectDir = await makeProject();
    const phase4Dir = path.join(projectDir, '.pakalon-agents', 'phase-4');

    await fs.writeFile(path.join(projectDir, '.pakalon', 'security-policy.yml'), [
      'promotion_criteria:',
      '  max_critical_vulnerabilities: 0',
      '  max_high_vulnerabilities: 1',
      '  max_medium_vulnerabilities: 5',
      '  min_security_score: 70',
      '  required_sast_coverage: 80',
      '  require_dast: true',
      '  require_sbom: true',
      'actions:',
      '  on_failure: loop_back',
      '  loop_back_phase: 3',
      '  max_loop_iterations: 3',
      '',
    ].join('\n'));

    await fs.writeFile(path.join(phase4Dir, 'security-score.json'), JSON.stringify({
      score: 82,
      grade: 'B',
      breakdown: { critical: 0, high: 1, medium: 1, low: 0, total: 2 },
      scanResults: {
        sast: { issues: 1 },
        dast: { issues: 0 },
      },
    }, null, 2));
    await fs.writeFile(path.join(phase4Dir, 'sbom.json'), '{}');
    await fs.writeFile(path.join(phase4Dir, 'zap-results.xml'), '<OWASPZAPReport />');

    const evaluator = await PolicyEvaluator.loadFromFile(path.join(projectDir, '.pakalon', 'security-policy.yml'));
    const result = await evaluator.evaluate(projectDir);

    expect(result.passed).toBe(true);
    expect(evaluator.getPolicy().promotion_criteria.max_high).toBe(1);
  });

  it('fails when required sandbox scan artifacts are missing', async () => {
    const projectDir = await makeProject();
    const phase4Dir = path.join(projectDir, '.pakalon-agents', 'phase-4');

    await fs.writeFile(path.join(phase4Dir, 'security-score.json'), JSON.stringify({
      score: 95,
      grade: 'A',
      breakdown: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
      scanResults: {
        sast: { issues: 0 },
        dast: { issues: 0, skipped: true },
      },
    }, null, 2));

    const result = await new PolicyEvaluator().evaluate(projectDir);

    expect(result.passed).toBe(false);
    expect(result.reasons.some((reason) => reason.includes('SBOM generated'))).toBe(true);
    expect(result.reasons.some((reason) => reason.includes('DAST scan performed'))).toBe(true);
  });
});
