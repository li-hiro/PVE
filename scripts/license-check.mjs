#!/usr/bin/env node
/**
 * VirtGate 依赖许可证审计。
 *
 * 目标：保证生产与开发依赖仅包含 MIT / Apache-2.0 等宽松开源许可，
 * 阻止 GPL / AGPL / LGPL / MPL / EPL / BUSL 等强传染或商业限制协议进入依赖树。
 *
 * 用法：
 *   node scripts/license-check.mjs
 *   node scripts/license-check.mjs --json
 *
 * 退出码：0 全部合规；1 存在违规或无法识别的许可证。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_DIRS = ['server/node_modules', 'web/node_modules', 'node_modules'];

/** 宽松开源许可证白名单（SPDX 标识，大小写不敏感）。 */
const ALLOWED = new Set([
  '0bsd',
  'apache-2.0',
  'artistic-2.0',
  'blueoak-1.0.0',
  'bsd',
  'bsd-2-clause',
  'bsd-3-clause',
  'cc0-1.0',
  'cc-by-3.0',
  'cc-by-4.0',
  'isc',
  'mit',
  'mit-0',
  'python-2.0',
  'unlicense',
  'wtfpl',
  'zlib',
]);

/** 明确禁止的许可证关键词（用于给出更清晰的失败原因）。 */
const DENIED = [
  'gpl',
  'agpl',
  'lgpl',
  'mpl',
  'epl',
  'busl',
  'sspl',
  'commons-clause',
  'cc-by-nc',
  'cc-by-sa',
  'proprietary',
  'commercial',
];

const normalize = (token) =>
  token
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/\s+license$/, '')
    .replace(/\s+/g, '-')
    .replace(/[()]/g, '')
    .trim();

const readLicense = (manifest) => {
  const direct = manifest.license;
  if (typeof direct === 'string') return direct;
  if (direct && typeof direct === 'object' && typeof direct.type === 'string') return direct.type;
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses
      .map((item) => (typeof item === 'string' ? item : item?.type))
      .filter(Boolean)
      .join(' OR ');
  }
  return '';
};

/** 递归判断 SPDX 表达式：OR 任一满足；AND 全部满足；WITH 只看主体许可。 */
const evaluate = (expression) => {
  const cleaned = expression.replace(/\(/g, ' ').replace(/\)/g, ' ').trim();
  if (!cleaned) return false;
  if (/\s+OR\s+/i.test(cleaned)) {
    return cleaned.split(/\s+OR\s+/i).some((part) => evaluate(part));
  }
  const withoutException = cleaned.split(/\s+WITH\s+/i)[0];
  return withoutException
    .split(/\s+AND\s+/i)
    .map((part) => normalize(part))
    .every((token) => ALLOWED.has(token));
};

const matchesDenied = (expression) => {
  const lower = expression.toLowerCase();
  return DENIED.some((keyword) => lower.includes(keyword));
};

const readPackage = (manifestPath) => {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return;
  }
  if (!manifest.name || !manifest.version) return;
  const key = `${manifest.name}@${manifest.version}`;
  if (seen.has(key)) return;
  seen.add(key);
  packages.push({
    name: manifest.name,
    version: manifest.version,
    license: readLicense(manifest),
    path: manifestPath.replace(ROOT, ''),
  });
};

/** 只遍历 node_modules 结构，避免扫描依赖包的源码目录。 */
const scanNodeModules = (modulesDir) => {
  let entries;
  try {
    entries = readdirSync(modulesDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(modulesDir, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) {
      // 作用域包：@scope/pkg
      let scoped;
      try {
        scoped = readdirSync(full, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of scoped) {
        if (!child.isDirectory()) continue;
        const pkgDir = join(full, child.name);
        readPackage(join(pkgDir, 'package.json'));
        scanNodeModules(join(pkgDir, 'node_modules'));
      }
      continue;
    }
    readPackage(join(full, 'package.json'));
    scanNodeModules(join(full, 'node_modules'));
  }
};

const packages = [];
const seen = new Set();

for (const relative of SCAN_DIRS) {
  const base = join(ROOT, relative);
  try {
    statSync(base);
  } catch {
    continue;
  }
  scanNodeModules(base);
}

const violations = [];
const unknown = [];

for (const pkg of packages) {
  if (!pkg.license) {
    unknown.push(pkg);
    continue;
  }
  if (!evaluate(pkg.license)) {
    violations.push(pkg);
  }
}

const deniedViolations = violations.filter((pkg) => matchesDenied(pkg.license));

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      {
        scanned: packages.length,
        passed: packages.length - violations.length - unknown.length,
        violations,
        unknown,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`VirtGate 许可证审计：共扫描 ${packages.length} 个依赖`);
  console.log(`  合规：${packages.length - violations.length - unknown.length}`);
  console.log(`  违规：${violations.length}`);
  console.log(`  未知：${unknown.length}`);

  if (deniedViolations.length > 0) {
    console.error('\n检测到强传染 / 商业限制许可证：');
    for (const pkg of deniedViolations) {
      console.error(`  ✗ ${pkg.name}@${pkg.version} -> ${pkg.license}`);
    }
  }

  const otherViolations = violations.filter((pkg) => !matchesDenied(pkg.license));
  if (otherViolations.length > 0) {
    console.error('\n不在宽松许可白名单中的依赖：');
    for (const pkg of otherViolations) {
      console.error(`  ✗ ${pkg.name}@${pkg.version} -> ${pkg.license}`);
    }
  }

  if (unknown.length > 0) {
    console.error('\n无法识别许可证的依赖：');
    for (const pkg of unknown) {
      console.error(`  ? ${pkg.name}@${pkg.version}`);
    }
  }
}

process.exit(violations.length > 0 || unknown.length > 0 ? 1 : 0);
