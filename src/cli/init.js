import inquirer from 'inquirer';
import { getPolicyDbPath, savePolicyConfig } from '../policy/policyStore.js';

const HEADER = `
╭─────────────────────────────────────────────────────────────╮
│  Claude Observer - Policy Configuration                     │
╰─────────────────────────────────────────────────────────────╯
`;

function parsePatterns(input) {
  if (!input || typeof input !== 'string') return [];
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function runInitWizard() {
  process.stdout.write(HEADER + '\n');

  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'blockDestructiveShell',
      message: 'Block destructive shell commands (rm -rf, sudo rm)?',
      default: true,
    },
    {
      type: 'confirm',
      name: 'allowWritesOutsideProject',
      message: 'Allow file writes outside project directory?',
      default: false,
    },
    {
      type: 'confirm',
      name: 'blockNetworkTools',
      message: 'Block network tools (curl, wget) in shell?',
      default: false,
    },
    {
      type: 'confirm',
      name: 'blockSystemPaths',
      message: 'Block access to system paths (~/.ssh, ~/.aws, /etc)?',
      default: true,
    },
    {
      type: 'list',
      name: 'sensitiveMode',
      message:
        'How should sensitive files (.env, credentials, secrets) be handled?',
      choices: [
        {
          name: 'Block all access (most secure - agent cannot read them)',
          value: 'block',
        },
        {
          name: "Ask me each time (I'll decide per-request)",
          value: 'ask',
        },
        {
          name: 'Allow but warn (agent can read, gets reminder not to leak)',
          value: 'warn',
        },
        {
          name: 'No restrictions (current behavior)',
          value: 'none',
        },
      ],
      default: 0,
    },
    {
      type: 'input',
      name: 'customPatternsRaw',
      message: 'Add custom blocked patterns (comma-separated, or skip):',
      default: '',
    },
  ]);

  const customPatterns = parsePatterns(answers.customPatternsRaw);

  savePolicyConfig({
    blockDestructiveShell: answers.blockDestructiveShell,
    allowWritesOutsideProject: answers.allowWritesOutsideProject,
    blockNetworkTools: answers.blockNetworkTools,
    blockSystemPaths: answers.blockSystemPaths,
    sensitiveMode: answers.sensitiveMode,
    customPatterns,
  });

  const dbPath = getPolicyDbPath();
  console.log('');
  console.log(`✓ Policy saved to ${dbPath}`);
  console.log("✓ Run 'claude-observer start' to begin enforcing policies");
}
