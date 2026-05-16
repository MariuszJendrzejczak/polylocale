/**
 * Deterministic passphrase reused across every AI / Settings scenario.
 *
 * The secret store is locked the first time the user touches an AI flow;
 * the gate fires the `PassphrasePrompt` modal. Using a fixed value here
 * keeps the test boundary tight — D3 is the only scenario that swaps
 * mid-test (verifying that rotation survives a reload), and it does so by
 * naming a second, equally deterministic value locally.
 *
 * Do not export domain-secret material from this file. The passphrase is
 * literal text the SPA hashes via PBKDF2; nothing here is sensitive.
 */
export const TEST_PASSPHRASE = 'e2e-test-passphrase';

/** Used by D3 to prove rotation actually rotates the verifier. */
export const TEST_PASSPHRASE_ROTATED = 'e2e-rotated-passphrase';
