import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';

import type { LocalizationProject, TranslationValue } from '@polylocale/core';

import { useEditor } from '../state/editor-context.js';
import { EditorProvider } from '../state/editor-provider.js';

import { DiffView } from './DiffView.js';

function val(text: string): TranslationValue {
  return {
    ir: [{ kind: 'text', value: text }],
    raw: text,
    reviewed: true,
    modifiedAt: 0,
    source: 'imported',
  };
}

function placeholderVal(literal: string, placeholder: string): TranslationValue {
  // e.g. literal "You have ", placeholder "count" → "You have {count}"
  return {
    ir: [
      { kind: 'text', value: literal },
      { kind: 'placeholder', name: placeholder },
    ],
    raw: `${literal}{${placeholder}}`,
    reviewed: true,
    modifiedAt: 0,
    source: 'imported',
  };
}

function fixtureProject(): LocalizationProject {
  return {
    id: 'p',
    name: 'test',
    locales: ['en', 'pl'],
    baseLocale: 'en',
    keys: [
      {
        id: 'greet',
        path: 'greet',
        values: { en: val('Hello'), pl: val('Cześć') },
        status: 'ok',
      },
      {
        id: 'farewell',
        path: 'farewell',
        values: { en: val('Goodbye'), pl: undefined },
        status: 'missing-translation',
      },
      {
        id: 'count_line',
        path: 'count_line',
        values: {
          en: placeholderVal('You have ', 'count'),
          pl: placeholderVal('Masz ', 'n'),
        },
        status: 'ok',
      },
    ],
    files: [{ locale: 'en', format: 'json-flat', path: 'en.json' }],
    settings: {},
  };
}

function LoadOnMount({ project }: { readonly project: LocalizationProject }): null {
  const { dispatch } = useEditor();
  useEffect(() => {
    dispatch({
      type: 'loaded',
      project,
      fsMode: 'fallback',
      directoryHandle: null,
      directoryName: null,
      fileHandles: new Map(),
      skipped: [],
    });
    dispatch({ type: 'setView', view: 'diff' });
  }, [dispatch, project]);
  return null;
}

function renderDiff(project: LocalizationProject): ReturnType<typeof render> {
  return render(
    <EditorProvider>
      <LoadOnMount project={project} />
      <DiffView />
    </EditorProvider>,
  );
}

describe('DiffView (smoke)', () => {
  it('renders only divergent keys with the right reason badge', async () => {
    renderDiff(fixtureProject());

    // farewell — pl missing → "missing"
    expect(await screen.findByText('farewell')).toBeInTheDocument();
    // count_line — placeholder rename {count} → {n} → "structural mismatch"
    expect(screen.getByText('count_line')).toBeInTheDocument();
    // greet — same structure same text → not rendered as a diff row
    expect(screen.queryByText('greet')).not.toBeInTheDocument();

    expect(screen.getByText('missing')).toBeInTheDocument();
    expect(screen.getByText('structural mismatch')).toBeInTheDocument();
    expect(screen.queryByText('empty')).not.toBeInTheDocument();
  });

  it('exposes both locale selectors with the default base/non-base pairing', () => {
    renderDiff(fixtureProject());
    const leftSelect = screen.getByLabelText('Diff left locale') as HTMLSelectElement;
    const rightSelect = screen.getByLabelText('Diff right locale') as HTMLSelectElement;
    expect(leftSelect.value).toBe('en');
    expect(rightSelect.value).toBe('pl');
  });
});
