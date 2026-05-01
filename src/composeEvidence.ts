import { renderMarkdown } from './renderMarkdown.js';
import type { DisputeEvidence, EvidenceInputs } from './types.js';

/** uncategorized_text caps at 20,000 chars per Stripe's API. We leave headroom. */
const UNCATEGORIZED_TEXT_CAP = 19_500;

export function composeEvidence(input: EvidenceInputs): DisputeEvidence {
  const { name, email, ip, addr, ipReport, phoneReport, emailReport } = input;

  const billingAddress =
    [addr?.address1, addr?.city, addr?.state, addr?.postalCode, addr?.country?.countryISO2]
      .filter((s): s is string => Boolean(s))
      .join(', ') || undefined;

  return {
    customer_name: name,
    customer_email_address: email,
    customer_purchase_ip: ip,
    billing_address: billingAddress,
    uncategorized_text: renderMarkdown({ addr, ipReport, phoneReport, emailReport }).slice(
      0,
      UNCATEGORIZED_TEXT_CAP,
    ),
  };
}
