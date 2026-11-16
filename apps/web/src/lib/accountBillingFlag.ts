// FILE: accountBillingFlag.ts
// Purpose: Whether this build ships the Synara billing UI. Kept apart from the billing
//          workflows so light modules (the settings taxonomy) can read it.
// Exports: ACCOUNT_BILLING_ENABLED

/** Sona has no hosted account or paid subscription UI. */
export const ACCOUNT_BILLING_ENABLED = false;
