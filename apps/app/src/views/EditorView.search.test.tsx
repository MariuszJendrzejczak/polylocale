import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';

import type { LocalizationProject, TranslationValue } from '@polylocale/core';

import { useEditor } from '../state/editor-context.js';
import { EditorProvider } from '../state/editor-provider.js';

import { EditorView } from './EditorView.js';

const en = (text: string): TranslationValue => ({
  ir: [{ kind: 'text', value: text }],
  raw: text,
  reviewed: true,
  modifiedAt: 0,
  source: 'imported',
});

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
        values: { en: en('Hello world'), pl: undefined },
        status: 'missing-translation',
      },
      {
        id: 'farewell',
        path: 'farewell',
        values: { en: en('Goodbye'), pl: undefined },
        status: 'missing-translation',
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
  }, [dispatch, project]);
  return null;
}

function renderEditor(project: LocalizationProject): ReturnType<typeof render> {
  return render(
    <EditorProvider>
      <LoadOnMount project={project} />
      <EditorView />
    </EditorProvider>,
  );
}

describe('EditorView search filter (smoke)', (): void => {
  it('filters rows by key path and restores them when the input is cleared', async (): Promise<void> => {
    const user = userEvent.setup();
    renderEditor(fixtureProject());

    expect(await screen.findByText('greet')).toBeInTheDocument();
    expect(screen.getByText('farewell')).toBeInTheDocument();

    const search = screen.getByLabelText('Search keys or values');
    await user.type(search, 'greet');

    await waitFor(
      (): void => {
        expect(screen.queryByText('farewell')).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    expect(screen.getByText('greet')).toBeInTheDocument();

    await user.clear(search);

    await waitFor(
      (): void => {
        expect(screen.getByText('farewell')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    expect(screen.getByText('greet')).toBeInTheDocument();
  });

  it('matches against rendered locale values, not just key paths', async (): Promise<void> => {
    const user = userEvent.setup();
    renderEditor(fixtureProject());

    await screen.findByText('greet');

    const search = screen.getByLabelText('Search keys or values');
    await user.type(search, 'goodbye');

    await waitFor((): void => {
      expect(screen.queryByText('greet')).not.toBeInTheDocument();
    });
    expect(screen.getByText('farewell')).toBeInTheDocument();
  });
});

