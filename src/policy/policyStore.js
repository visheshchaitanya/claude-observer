import {
  createDb,
  insertPolicyRule,
  insertSensitivePattern,
} from '../server/db.js';

const WIZARD_REASON = 'wizard-setup';

export function getPolicyDbPath() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return `${home}/.claude-observer/policy.db`;
}

function sensitiveModeToAction(mode) {
  switch (mode) {
    case 'block':
      return 'deny';
    case 'ask':
      return 'ask';
    case 'warn':
      return 'warn';
    case 'none':
    default:
      return 'allow';
  }
}

/** Default sensitive paths / names when mode is not "none" */
const DEFAULT_SENSITIVE = [
  { pattern: '\\.env($|\\.)', category: 'env' },
  { pattern: '.*\\.pem$', category: 'keys' },
  { pattern: '(credentials|secrets|api_key|token)', category: 'secrets' },
];

/**
 * @param {object} config
 * @param {boolean} config.blockDestructiveShell
 * @param {boolean} config.allowWritesOutsideProject
 * @param {boolean} config.blockNetworkTools
 * @param {boolean} config.blockSystemPaths
 * @param {'block'|'ask'|'warn'|'none'} config.sensitiveMode
 * @param {string[]} config.customPatterns
 */
export function savePolicyConfig(config, dbPath = getPolicyDbPath()) {
  const db = createDb(dbPath);

  try {
    const run = db.transaction(() => {
      db.prepare('DELETE FROM policy_rules WHERE reason = ?').run(WIZARD_REASON);
      db.prepare('DELETE FROM sensitive_patterns WHERE description = ?').run(WIZARD_REASON);

      insertPolicyRule(db, {
        rule_type: 'sensitive_mode',
        pattern: config.sensitiveMode,
        tool_matcher: '*',
        action: 'allow',
        reason: WIZARD_REASON,
        priority: 0,
        enabled: 1,
      });

      if (config.blockDestructiveShell) {
        insertPolicyRule(db, {
          rule_type: 'shell_block_pattern',
          pattern: '(rm\\s+-rf|sudo\\s+rm|rm\\s+\\-[rR]f)',
          tool_matcher: 'Bash',
          action: 'deny',
          reason: WIZARD_REASON,
          priority: 100,
          enabled: 1,
        });
      }

      if (!config.allowWritesOutsideProject) {
        insertPolicyRule(db, {
          rule_type: 'write_scope',
          pattern: 'outside_project',
          tool_matcher: '*',
          action: 'deny',
          reason: WIZARD_REASON,
          priority: 80,
          enabled: 1,
        });
      }

      if (config.blockNetworkTools) {
        insertPolicyRule(db, {
          rule_type: 'shell_block_pattern',
          pattern: '\\b(curl|wget)\\b',
          tool_matcher: 'Bash',
          action: 'deny',
          reason: WIZARD_REASON,
          priority: 90,
          enabled: 1,
        });
      }

      if (config.blockSystemPaths) {
        for (const [pattern, pr] of [
          ['**/.ssh/**', 85],
          ['**/.aws/**', 84],
          ['/etc/**', 83],
        ]) {
          insertPolicyRule(db, {
            rule_type: 'block_path',
            pattern,
            tool_matcher: '*',
            action: 'deny',
            reason: WIZARD_REASON,
            priority: pr,
            enabled: 1,
          });
        }
      }

      const sensAction = sensitiveModeToAction(config.sensitiveMode);
      if (config.sensitiveMode !== 'none') {
        for (const row of DEFAULT_SENSITIVE) {
          insertSensitivePattern(db, {
            pattern: row.pattern,
            category: row.category,
            description: WIZARD_REASON,
            action: sensAction,
            enabled: 1,
          });
        }
      }

      for (const raw of config.customPatterns) {
        if (!raw) continue;
        insertSensitivePattern(db, {
          pattern: raw,
          category: 'custom',
          description: WIZARD_REASON,
          action: 'deny',
          enabled: 1,
        });
      }
    });

    run();
  } finally {
    db.close();
  }
}
