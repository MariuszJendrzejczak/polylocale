import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  composeProject,
  parseICU,
  type LocaleCode,
  type LocalizationProject,
  type ParsedFile,
  type TranslationKey,
  type TranslationValue,
} from '@polylocale/core';

import type { BatchValueEntry } from '../state/editor-state.js';
import type { ImportPlan } from '../services/translator-handoff.js';

import { HandoffModal } from './HandoffModal.js';

function buildKey(path: string, values: Readonly<Record<LocaleCode, string>>): TranslationKey {
  const now = Date.now();
  const entries: Record<LocaleCode, TranslationValue> = {};
  for (const [locale, raw] of Object.entries(values)) {
    entries[locale] = {
      ir: parseICU(raw),
      raw,
      reviewed: false,
      modifiedAt: now,
      source: 'imported',
    };
  }
  return { id: path, path, values: entries, status: 'ok' };
}

function buildProject(): LocalizationProject {
  const locales: readonly LocaleCode[] = ['en', 'pl-PL'];
  const keys: readonly TranslationKey[] = [
    buildKey('hello', { en: 'Hello' }),
    buildKey('bye', { en: 'Bye', 'pl-PL': 'Pa' }),
  ];
  const sources: ParsedFile[] = locales.map((locale) => ({
    locale,
    format: 'json-flat' as const,
    path: `${locale}.json`,
    keys: keys
      .filter((k) => k.values[locale] !== undefined)
      .map((k) => ({
        id: k.id,
        path: k.path,
        values: { [locale]: k.values[locale]! },
        status: 'ok' as const,
      })),
  }));
  return composeProject({ id: 'p', name: 'test', baseLocale: 'en', sources });
}

function buildPlan(): ImportPlan {
  return {
    applies: [
      {
        keyPath: 'hello',
        locale: 'pl-PL',
        ir: parseICU('Cześć'),
        raw: 'Cześć',
        source: 'imported',
      },
    ],
    conflicts: [
      {
        keyId: 'bye',
        keyPath: 'bye',
        locale: 'pl-PL',
        currentText: 'Pa',
        incomingText: 'Żegnaj',
        incomingIr: parseICU('Żegnaj'),
      },
    ],
    parseErrors: [
      {
        kind: 'parse-error',
        keyPath: 'broken',
        locale: 'pl-PL',
        message: 'parse error in broken / pl-PL: unexpected eof',
      },
    ],
  };
}

describe('HandoffModal', () => {
  it('renders the three triage sections with their counts', () => {
    render(
      <HandoffModal
        project={buildProject()}
        initialPlan={buildPlan()}
        onApply={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Clean applies')).toBeInTheDocument();
    expect(screen.getByText('Conflicts')).toBeInTheDocument();
    expect(screen.getByText('Parse errors')).toBeInTheDocument();
    expect(screen.getByLabelText('Apply hello pl-PL')).toBeChecked();
    expect(screen.getByLabelText('Force apply bye pl-PL')).not.toBeChecked();
  });

  it('applies clean rows plus checked conflicts through onApply', async () => {
    const onApply = vi.fn<(entries: readonly BatchValueEntry[]) => void>();
    render(
      <HandoffModal
        project={buildProject()}
        initialPlan={buildPlan()}
        onApply={onApply}
        onClose={() => {}}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Force apply bye pl-PL'));
    await user.click(screen.getByRole('button', { name: /apply 2 selected/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const entries = onApply.mock.calls[0]![0];
    expect(entries).toHaveLength(2);
    const byPath = Object.fromEntries(entries.map((e) => [e.keyPath, e]));
    expect(byPath['hello']?.raw).toBe('Cześć');
    expect(byPath['bye']?.raw).toBe('Żegnaj');
    expect(entries.every((e) => e.source === 'imported')).toBe(true);
  });

  it('parse-error rows have no checkbox', () => {
    render(
      <HandoffModal
        project={buildProject()}
        initialPlan={buildPlan()}
        onApply={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('parse-error')).toBeInTheDocument();
    expect(screen.queryByLabelText(/apply broken/i)).toBeNull();
  });

  it('closes when the Cancel button is clicked', async () => {
    const onClose = vi.fn();
    render(
      <HandoffModal
        project={buildProject()}
        initialPlan={buildPlan()}
        onApply={() => {}}
        onClose={onClose}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});
