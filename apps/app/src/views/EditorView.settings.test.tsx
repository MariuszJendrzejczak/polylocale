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

describe('EditorView Settings button (smoke)', (): void => {
  it('routes through the passphrase prompt and opens the Settings modal once unlocked', async (): Promise<void> => {
    const user = userEvent.setup();
    render(
      <EditorProvider>
        <LoadOnMount project={fixtureProject()} />
        <EditorView />
      </EditorProvider>,
    );

    await screen.findByText('greet');

    await user.click(screen.getByRole('button', { name: 'Open settings' }));

    // The secret store is locked the first time, so the passphrase prompt
    // gate runs before the modal mounts.
    const passphraseInput = await screen.findByLabelText('Passphrase');
    await user.type(passphraseInput, 'test-passphrase');
    await user.click(screen.getByRole('button', { name: /^unlock$/i }));

    await waitFor(
      (): void => {
        expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
      },
      { timeout: 10_000 },
    );
  }, 15_000);
});
