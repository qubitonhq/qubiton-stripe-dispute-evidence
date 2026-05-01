/**
 * Re-exports of the QubitOn SDK response types we use, plus the local
 * EvidenceInputs and DisputeEvidence shapes that thread internal state.
 *
 * The SDK is the source of truth for response shapes — this file is just
 * a focused alias surface so the rest of the app doesn't import @qubiton/sdk
 * everywhere.
 */

export type {
  AddressResponse,
  IpQualityResponse,
  PhoneValidateResponse,
  EmailValidateResponse,
  ValidationResult,
  AppendInfo,
} from '@qubiton/sdk';

import type {
  AddressResponse,
  IpQualityResponse,
  PhoneValidateResponse,
  EmailValidateResponse,
} from '@qubiton/sdk';

export interface EvidenceInputs {
  name?: string;
  email?: string;
  ip?: string;
  addr: AddressResponse | null;
  ipReport: IpQualityResponse | null;
  phoneReport: PhoneValidateResponse | null;
  emailReport: EmailValidateResponse | null;
}

/** Subset of Stripe's typed dispute-evidence shape we populate. */
export interface DisputeEvidence {
  customer_name?: string;
  customer_email_address?: string;
  customer_purchase_ip?: string;
  billing_address?: string;
  uncategorized_text?: string;
}
