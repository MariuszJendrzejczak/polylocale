import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { InvalidPassphraseError, type SecretStore } from '../services/secret-store.js';

import { SettingsModal } from './SettingsModal.js';

interface FakeStore extends SecretStore {
  readonly _data: Map<string, string>;
}

function createFakeStore(seed: Readonly<Record<string, string>> = {}): FakeStore {
  const data = new Map<string, string>(Object.entries(seed));
  let unlocked = true;
  let passphrase = 'old-pp';
  return {
    _data: data,
    async unlock(pp: string): Promise<void> {
      if (pp !== passphrase) throw new InvalidPassphraseError();
      unlocked = true;
    },
    isUnlocked: () => unlocked,
    async set(name: string, value: string): Promise<void> {
      data.set(name, value);
    },
    async get(name: string): Promise<string | undefined> {
      return data.get(name);
    },
    async delete(name: string): Promise<void> {
      data.delete(name);
    },
    async list(): Promise<readonly string[]> {
      return [...data.keys()].sort();
    },
    async changePassphrase(oldPp: string, newPp: string): Promise<void> {
      if (oldPp !== passphrase) throw new InvalidPassphraseError();
      passphrase = newPp;
    },
    lock(): void {
      unlocked = false;
    },
  };
}

describe('SettingsModal', (): void => {
  it('renders configured slots with the right mask suffix and not-configured rows', async (): Promise<void> => {
    const store = createFakeStore({
      'deepl-api-key': 'deepl-secret-XYZW',
      'openai-api-key': 'sk-abcd-1234',
    });

    render(<SettingsModal secretStore={store} onClose={() => {}} onSlotMutated={() => {}} />);

    await waitFor((): void => {
      expect(screen.getByLabelText('DeepL: configured')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('DeepL: configured')).toHaveTextContent('XYZW');
    expect(screen.getByLabelText('OpenAI: configured')).toHaveTextContent('1234');
    expect(screen.getByLabelText('Anthropic: not configured')).toBeInTheDocument();
  });

  it('renders the empty notice when no slots are configured', async (): Promise<void> => {
    const store = createFakeStore();

    render(<SettingsModal secretStore={store} onClose={() => {}} onSlotMutated={() => {}} />);

    expect(await screen.findByText(/no keys configured yet/i)).toBeInTheDocument();
  });

  it('deletes a configured slot after the inline confirm and notifies the host', async (): Promise<void> => {
    const user = userEvent.setup();
    const store = createFakeStore({ 'deepl-api-key': 'deepl-secret-XYZW' });
    const onSlotMutated = vi.fn();
    const deleteSpy = vi.spyOn(store, 'delete');

    render(<SettingsModal secretStore={store} onClose={() => {}} onSlotMutated={onSlotMutated} />);

    await screen.findByLabelText('DeepL: configured');

    const deepLRow = screen.getByText('DeepL').closest('div');
    expect(deepLRow).not.toBeNull();

    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument();

    // Inside the confirm row there are Cancel + Delete buttons; click the
    // second Delete (the one inside the confirm).
    const confirmDeleteButton = screen.getAllByRole('button', { name: 'Delete' }).slice(-1)[0]!;
    await user.click(confirmDeleteButton);

    await waitFor((): void => {
      expect(screen.getByLabelText('DeepL: not configured')).toBeInTheDocument();
    });
    expect(deleteSpy).toHaveBeenCalledWith('deepl-api-key');
    expect(onSlotMutated).toHaveBeenCalledWith('deepl');
    expect(store._data.has('deepl-api-key')).toBe(false);
  });

  it('changes the passphrase and surfaces a success notice', async (): Promise<void> => {
    const user = userEvent.setup();
    const store = createFakeStore({ 'deepl-api-key': 'x' });
    const changeSpy = vi.spyOn(store, 'changePassphrase');

    render(<SettingsModal secretStore={store} onClose={() => {}} onSlotMutated={() => {}} />);

    await screen.findByLabelText('DeepL: configured');

    await user.click(screen.getByRole('button', { name: /change passphrase…/i }));

    await user.type(screen.getByLabelText('Current passphrase'), 'old-pp');
    await user.type(screen.getByLabelText('New passphrase'), 'new-pp');
    await user.type(screen.getByLabelText('Confirm new passphrase'), 'new-pp');

    await user.click(screen.getByRole('button', { name: /^change passphrase$/i }));

    expect(changeSpy).toHaveBeenCalledWith('old-pp', 'new-pp');
    expect(await screen.findByText(/passphrase updated/i)).toBeInTheDocument();
  });

  it('shows an inline error when the current passphrase is wrong', async (): Promise<void> => {
    const user = userEvent.setup();
    const store = createFakeStore({ 'deepl-api-key': 'x' });

    render(<SettingsModal secretStore={store} onClose={() => {}} onSlotMutated={() => {}} />);

    await screen.findByLabelText('DeepL: configured');

    await user.click(screen.getByRole('button', { name: /change passphrase…/i }));
    await user.type(screen.getByLabelText('Current passphrase'), 'wrong-pp');
    await user.type(screen.getByLabelText('New passphrase'), 'new-pp');
    await user.type(screen.getByLabelText('Confirm new passphrase'), 'new-pp');

    await user.click(screen.getByRole('button', { name: /^change passphrase$/i }));

    expect(await screen.findByText(/current passphrase did not match/i)).toBeInTheDocument();
    expect(screen.queryByText(/passphrase updated/i)).not.toBeInTheDocument();
  });
});
