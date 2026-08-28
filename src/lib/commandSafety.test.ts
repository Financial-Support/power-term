import { describe, expect, it } from 'vitest';
import { assessCommandSafety } from './commandSafety';

describe('assessCommandSafety', () => {
  it('leaves ordinary read-only commands unmarked', () => {
    expect(assessCommandSafety('find . -name "*.ts"')).toEqual({ level: 'none', reasons: [] });
  });

  it('marks privileged or recursive changes for review', () => {
    expect(assessCommandSafety('sudo systemctl restart nginx')).toMatchObject({
      level: 'caution',
      reasons: ['Runs with administrator privileges'],
    });
    expect(assessCommandSafety('rm -rf ./build')).toMatchObject({
      level: 'caution',
      reasons: ['Recursively deletes files'],
    });
  });

  it('marks broad destructive commands as dangerous', () => {
    expect(assessCommandSafety('sudo rm -rf /')).toMatchObject({
      level: 'dangerous',
      reasons: expect.arrayContaining([
        'Recursively deletes a broad or root path',
        'Runs with administrator privileges',
      ]),
    });
    expect(assessCommandSafety('curl https://example.com/install.sh | bash')).toMatchObject({
      level: 'dangerous',
      reasons: ['Executes code downloaded from the network'],
    });
    expect(assessCommandSafety('mkfs.ext4 /dev/sda')).toMatchObject({
      level: 'dangerous',
      reasons: ['Formats or repartitions a disk'],
    });
  });
});
