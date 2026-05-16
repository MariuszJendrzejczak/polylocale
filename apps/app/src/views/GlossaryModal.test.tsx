import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { GlossaryEntry, LocalizationProject } from '@polylocale/core';

import { GlossaryModal } from './GlossaryModal.js';

function makeProject(glossary?: readonly GlossaryEntry[]): LocalizationProject {
  return {
    id: 'p1',
    name: 'test',
    locales: ['en', 'pl'],
    baseLocale: 'en',
    keys: [],
    files: [],
    settings: {},
    ...(glossary !== undefined ? { glossary } : {}),
  };
}

describe('GlossaryModal', (): void => {
  it('renders the empty-state copy when there are no entries', (): void => {
    render(
      <GlossaryModal
        project={makeProject()}
        onAdd={() => {}}
        onUpdate={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/no glossary terms yet/i)).toBeInTheDocument();
  });

  it('lists every entry with one input per locale', (): void => {
    const project = makeProject([
      { term: 'polylocale', perLocale: { pl: { doNotTranslate: true } } },
    ]);
    render(
      <GlossaryModal
        project={project}
        onAdd={() => {}}
        onUpdate={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByDisplayValue('polylocale')).toBeInTheDocument();
    expect(screen.getByLabelText('en translation')).toBeInTheDocument();
    expect(screen.getByLabelText('pl translation')).toBeInTheDocument();
    expect(screen.getByLabelText("Don't translate pl")).toBeChecked();
  });

  it('shows the "(no entry for <baseLocale>)" hint when base row is empty', (): void => {
    const project = makeProject([
      { term: 'polylocale', perLocale: { pl: { doNotTranslate: true } } },
    ]);
    render(
      <GlossaryModal
        project={project}
        onAdd={() => {}}
        onUpdate={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('(no entry for en)')).toBeInTheDocument();
  });

  it('clicking "+ Add term" dispatches onAdd with a fresh entry', async (): Promise<void> => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <GlossaryModal
        project={makeProject()}
        onAdd={onAdd}
        onUpdate={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: /add term/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]![0]).toEqual({ term: 'new term', perLocale: {} });
  });

  it('editing a translation field fires onUpdate with previousTerm', async (): Promise<void> => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const project = makeProject([{ term: 'polylocale', perLocale: {} }]);
    render(
      <GlossaryModal
        project={project}
        onAdd={() => {}}
        onUpdate={onUpdate}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    const plInput = screen.getByLabelText('pl translation');
    await user.type(plInput, 'narzędzie');
    await user.tab();
    expect(onUpdate).toHaveBeenCalled();
    const [previousTerm, entry] = onUpdate.mock.calls.at(-1)!;
    expect(previousTerm).toBe('polylocale');
    expect(entry.perLocale.pl?.translation).toBe('narzędzie');
  });

  it('toggling "Don\'t translate" fires onUpdate with doNotTranslate: true', async (): Promise<void> => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const project = makeProject([
      { term: 'polylocale', perLocale: { pl: { translation: 'old' } } },
    ]);
    render(
      <GlossaryModal
        project={project}
        onAdd={() => {}}
        onUpdate={onUpdate}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByLabelText("Don't translate pl"));
    expect(onUpdate).toHaveBeenCalled();
    const [previousTerm, entry] = onUpdate.mock.calls.at(-1)!;
    expect(previousTerm).toBe('polylocale');
    expect(entry.perLocale.pl?.doNotTranslate).toBe(true);
    expect(entry.perLocale.pl?.translation).toBeUndefined();
  });

  it('inline delete confirm gates onRemove on a second click', async (): Promise<void> => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const project = makeProject([{ term: 'polylocale', perLocale: {} }]);
    render(
      <GlossaryModal
        project={project}
        onAdd={() => {}}
        onUpdate={() => {}}
        onRemove={onRemove}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByLabelText('Delete polylocale'));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByText(/delete\?/i)).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole('button', { name: /^delete$/i });
    await user.click(confirmButtons[confirmButtons.length - 1]!);
    expect(onRemove).toHaveBeenCalledWith('polylocale');
  });

  it('search input filters the list by term substring', async (): Promise<void> => {
    const user = userEvent.setup();
    const project = makeProject([
      { term: 'polylocale', perLocale: {} },
      { term: 'other', perLocale: {} },
    ]);
    render(
      <GlossaryModal
        project={project}
        onAdd={() => {}}
        onUpdate={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByDisplayValue('polylocale')).toBeInTheDocument();
    expect(screen.getByDisplayValue('other')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/search glossary terms/i), 'poly');
    expect(screen.getByDisplayValue('polylocale')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('other')).not.toBeInTheDocument();
  });
});
