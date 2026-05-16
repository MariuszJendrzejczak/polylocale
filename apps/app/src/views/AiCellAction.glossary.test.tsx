import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { AIProvider } from '@polylocale/ai';
import type { GlossaryEntry, ICUNode, TranslationValue } from '@polylocale/core';

import type { AIProviderHost } from '../services/ai-provider-host.js';

import { AiCellAction } from './AiCellAction.js';

function baseValue(text: string): TranslationValue {
  return {
    ir: [{ kind: 'text', value: text }] satisfies ICUNode[],
    raw: text,
    reviewed: true,
    modifiedAt: 0,
    source: 'imported',
  };
}

function hostWith(translate: AIProvider['translate']): AIProviderHost {
  const provider: AIProvider = { id: 'stub', translate };
  return {
    async getProvider() {
      return provider;
    },
    reset() {},
  };
}

describe('AiCellAction glossary forwarding', (): void => {
  it('passes the project glossary on provider.translate when the ✦ button is clicked', async (): Promise<void> => {
    const user = userEvent.setup();
    const translate = vi.fn<AIProvider['translate']>(async ({ nodes }) => nodes);
    const glossary: readonly GlossaryEntry[] = [
      { term: 'polylocale', perLocale: { pl: { doNotTranslate: true } } },
    ];

    render(
      <AiCellAction
        host={hostWith(translate)}
        providerId="deepl"
        keyId="greet"
        keyPath="greet"
        locale="pl"
        baseLocale="en"
        baseValue={baseValue('Hello from polylocale')}
        glossary={glossary}
        isPending={false}
        onStart={() => {}}
        onClear={() => {}}
        onFail={() => {}}
        onAccept={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: /translate greet into pl/i }));

    await waitFor((): void => {
      expect(translate).toHaveBeenCalledTimes(1);
    });
    const call = translate.mock.calls[0]![0];
    expect(call.glossary).toEqual(glossary);
    expect(call.from).toBe('en');
    expect(call.to).toBe('pl');
  });

  it('omits the glossary field when none is supplied', async (): Promise<void> => {
    const user = userEvent.setup();
    const translate = vi.fn<AIProvider['translate']>(async ({ nodes }) => nodes);

    render(
      <AiCellAction
        host={hostWith(translate)}
        providerId="deepl"
        keyId="greet"
        keyPath="greet"
        locale="pl"
        baseLocale="en"
        baseValue={baseValue('Hello')}
        isPending={false}
        onStart={() => {}}
        onClear={() => {}}
        onFail={() => {}}
        onAccept={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: /translate greet into pl/i }));

    await waitFor((): void => {
      expect(translate).toHaveBeenCalled();
    });
    const call = translate.mock.calls[0]![0];
    expect('glossary' in call).toBe(false);
  });
});
