/**
 * 버전 자동 증가 스크립트
 * npm run deploy 시 자동 호출됨
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const filePath = 'public/version.js';
const content  = readFileSync(filePath, 'utf8');
const match    = content.match(/v(\d+)/);

if (!match) {
  console.error('version.js에서 버전 번호를 찾을 수 없습니다.');
  process.exit(1);
}

const current = parseInt(match[1], 10);
const next    = current + 1;

writeFileSync(filePath, content.replace(`v${current}`, `v${next}`));
console.log(`버전: v${current} → v${next}`);

execSync('git add public/version.js');
execSync(`git commit -m "chore: v${next}"`, { stdio: 'inherit' });
