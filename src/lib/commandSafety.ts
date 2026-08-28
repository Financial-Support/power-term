export type CommandRisk = 'none' | 'caution' | 'dangerous';

export interface CommandSafety {
  level: CommandRisk;
  reasons: string[];
}

interface SafetyRule {
  level: Exclude<CommandRisk, 'none'>;
  pattern: RegExp;
  reason: string;
}

// ponytail: local regex heuristics keep this offline and dependency-free; use a shell parser/allowlist if false positives become material.
const RULES: SafetyRule[] = [
  {
    level: 'dangerous',
    pattern: /\b(?:mkfs(?:\.[a-z0-9_-]+)?|fdisk|sfdisk|parted|gparted|wipefs|diskutil\s+(?:eraseDisk|secureErase))\b/i,
    reason: 'Formats or repartitions a disk',
  },
  {
    level: 'dangerous',
    pattern: /\b(?:dd|shred)\b[^\n;]*(?:\bof\s*=\s*\/dev\/|\/dev\/(?:sd[a-z]\d*|nvme\d+n\d+|(?:r?disk)\d+))/i,
    reason: 'Writes directly to a disk device',
  },
  {
    level: 'dangerous',
    pattern: /\b(?:shutdown|reboot|poweroff|halt)\b(?:\s|$)/i,
    reason: 'Stops or restarts the system',
  },
  {
    level: 'dangerous',
    pattern: /\b(?:killall|pkill)\b/i,
    reason: 'Can terminate multiple processes',
  },
  {
    level: 'dangerous',
    pattern: /\bkill\b[^\n;]*(?:^|\s)-?9?\s+1(?:\s|$)/i,
    reason: 'Can terminate the init process',
  },
  {
    level: 'dangerous',
    pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[^\n;]*f|push\s+[^\n;]*--force(?:-with-lease)?)/i,
    reason: 'Can discard or overwrite Git data',
  },
  {
    level: 'dangerous',
    pattern: /\bterraform\s+destroy\b/i,
    reason: 'Destroys managed infrastructure',
  },
  {
    level: 'dangerous',
    pattern: /\b(?:kubectl\s+[^\n;]*delete|docker\s+(?:system\s+prune|volume\s+prune|rm\s+-f)|podman\s+rm\s+-f)\b/i,
    reason: 'Deletes container or cluster resources',
  },
  {
    level: 'dangerous',
    pattern: /\b(?:drop\s+(?:database|schema|table)|truncate\s+(?:table|database)|delete\s+from\s+\w+)/i,
    reason: 'Deletes database data',
  },
  {
    level: 'dangerous',
    pattern: /\b(?:curl|wget)\b[^\n;]*\|\s*(?:sudo\s+)?(?:ba)?sh(?:\s|$)/i,
    reason: 'Executes code downloaded from the network',
  },
  {
    level: 'caution',
    pattern: /\bsudo\b/i,
    reason: 'Runs with administrator privileges',
  },
  {
    level: 'caution',
    pattern: /\brm\b[^\n;]*\s(?:-[^-\s]*r[^\s]*|--recursive)(?:\s|$)/i,
    reason: 'Recursively deletes files',
  },
  {
    level: 'caution',
    pattern: /\b(?:chmod|chown)\b/i,
    reason: 'Changes file permissions or ownership',
  },
  {
    level: 'caution',
    pattern: /\b(?:apt(?:-get)?|dnf|yum|brew|pacman)\s+(?:remove|uninstall|autoremove|clean)\b/i,
    reason: 'Removes installed software or packages',
  },
  {
    level: 'caution',
    pattern: /\bgit\s+(?:reset|clean|checkout|restore|push|branch\s+-D)\b/i,
    reason: 'May change or discard repository state',
  },
  {
    level: 'caution',
    pattern: /\b(?:docker|podman)\s+(?:rm|rmi|system\s+prune|volume\s+prune)\b/i,
    reason: 'Removes container resources',
  },
  {
    level: 'caution',
    pattern: /\b(?:kill|pkill|killall)\b/i,
    reason: 'Terminates a process',
  },
];

export function assessCommandSafety(command: string): CommandSafety {
  const matches = RULES.filter((rule) => rule.pattern.test(command));
  const rmTargets = recursiveDeleteTargets(command);
  if (rmTargets.some((target) => /^(?:\/|\/\*|~(?:\/\*)?|\.{1,2}(?:\/\*)?|\*|\$(?:HOME|USERPROFILE)(?:\/\*)?|\/(?:home|Users)(?:\/[^/]+)?(?:\/\*)?)$/i.test(target))) {
    matches.unshift({
      level: 'dangerous',
      pattern: /$^/,
      reason: 'Recursively deletes a broad or root path',
    });
  }

  const reasons = [...new Set(matches.map((rule) => rule.reason))].slice(0, 3);
  return {
    level: matches.some((rule) => rule.level === 'dangerous')
      ? 'dangerous'
      : reasons.length > 0
      ? 'caution'
      : 'none',
    reasons,
  };
}

function recursiveDeleteTargets(command: string): string[] {
  const match = /\brm\b([^\n;]*)/i.exec(command);
  if (!match) return [];
  return match[1]
    .trim()
    .split(/\s+/)
    .map((value) => value.replace(/["']/g, ''))
    .filter((value) => value && value !== '--' && !value.startsWith('-'));
}
