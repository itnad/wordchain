/**
 * 버전 자동 증가 스크립트
 * package.json의 version을 patch 단위로 올리고 version.js에 동기화
 * npm run deploy 시 자동 호출됨
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

// package.json의 patch 버전 증가 (1.0.0 → 1.0.1), git 커밋/태그는 직접 처리
execSync('npm version patch --no-git-tag-version', { stdio: 'inherit' });

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

// version.js에 동기화
const content = readFileSync('public/version.js', 'utf8');
writeFileSync('public/version.js', content.replace(/APP_VERSION = '[^']*'/, `APP_VERSION = 'v${version}'`));

console.log(`배포 버전: v${version}`);

execSync('git add package.json package-lock.json public/version.js');
execSync(`git commit -m "chore: v${version}"`, { stdio: 'inherit' });
