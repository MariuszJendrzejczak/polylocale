import type { LocalizationProject } from '@polylocale/core';

export type PathValidationReason = 'empty' | 'duplicate' | 'illegal-segment' | 'prefix-collision';

export type PathValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PathValidationReason };

export interface ValidateKeyPathOptions {
  readonly excludeKeyId?: string;
}

export function validateKeyPath(
  path: string,
  project: LocalizationProject,
  options: ValidateKeyPathOptions = {},
): PathValidationResult {
  if (path.trim() === '') return { ok: false, reason: 'empty' };

  const exclude = options.excludeKeyId;
  for (const key of project.keys) {
    if (key.id === exclude) continue;
    if (key.path === path) return { ok: false, reason: 'duplicate' };
  }

  const isNestedProject = project.files.some((f) => f.format === 'json-nested');
  if (!isNestedProject) return { ok: true };

  const segments = path.split('.');
  if (segments.some((s) => s === '')) return { ok: false, reason: 'illegal-segment' };

  for (const key of project.keys) {
    if (key.id === exclude) continue;
    if (isStrictDotPrefix(segments, key.path.split('.'))) {
      return { ok: false, reason: 'prefix-collision' };
    }
    if (isStrictDotPrefix(key.path.split('.'), segments)) {
      return { ok: false, reason: 'prefix-collision' };
    }
  }

  return { ok: true };
}

function isStrictDotPrefix(a: readonly string[], b: readonly string[]): boolean {
  if (a.length >= b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function describePathError(reason: PathValidationReason): string {
  switch (reason) {
    case 'empty':
      return 'Key path cannot be empty.';
    case 'duplicate':
      return 'A key with this path already exists.';
    case 'illegal-segment':
      return 'Key path has an empty segment (consecutive or trailing dots).';
    case 'prefix-collision':
      return 'Key path collides with an existing nested key.';
  }
}
