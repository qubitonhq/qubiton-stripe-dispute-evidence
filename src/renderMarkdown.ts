import type { EvidenceInputs, ValidationResult } from './types.js';

const yn = (v: unknown): string =>
  v === true ? 'Yes' : v === false ? 'No' : '—';

const passes = (results: ValidationResult[] | undefined, type: string): boolean | undefined => {
  if (!results) return undefined;
  return results.some(
    (v) => v?.validationType?.toLowerCase() === type && v?.validationPass === true,
  );
};

/**
 * Pull key/value enrichment out of validationResults[0].additionalInfo[].
 * Skips 'N/A' and empty values so they render as '—' instead of leaking through.
 */
const extractKv = (results: ValidationResult[] | undefined): Record<string, string> => {
  const info = results?.[0]?.additionalInfo ?? [];
  const out: Record<string, string> = {};
  for (const kv of info) {
    if (kv.key && kv.value && kv.value !== 'N/A') out[kv.key] = kv.value;
  }
  return out;
};

export function renderMarkdown(input: Pick<EvidenceInputs, 'addr' | 'ipReport' | 'phoneReport' | 'emailReport'>): string {
  const { addr, ipReport, phoneReport, emailReport } = input;

  const addrPass = passes(addr?.validationResults, 'address');
  const phonePass = passes(phoneReport?.validationResults, 'phone');
  const emailPass = passes(emailReport?.validationResults, 'email');

  const phoneInfo = extractKv(phoneReport?.validationResults);
  const emailInfo = extractKv(emailReport?.validationResults);

  const standardized =
    [addr?.address1, addr?.city, addr?.state, addr?.postalCode]
      .filter((s): s is string => Boolean(s))
      .join(' ') || '—';

  const ipCity =
    [ipReport?.city, ipReport?.region]
      .filter((s): s is string => Boolean(s))
      .join(', ') || '—';

  // Tor is the strongest fraud signal; check it first even if VPN/Proxy also flag.
  const vpnLabel = ipReport?.isTOR
    ? 'Tor'
    : ipReport?.isVPN
      ? 'VPN'
      : ipReport?.isProxy
        ? 'Proxy'
        : 'No';

  return `
# Dispute evidence (auto-generated ${new Date().toISOString()})

## Identity & address
- Address validates: ${yn(addrPass)}
- Standardized: ${standardized}
- Residential: ${yn(addr?.isResidential)}

## Network / location
- Order IP: ${ipReport?.ipAddress ?? '—'}
- IP country: ${ipReport?.country?.countryISO2 ?? '—'}
- IP city: ${ipCity}
- ISP: ${ipReport?.isp ?? '—'}
- VPN / Proxy / Tor: ${vpnLabel}
- Recent abuse: ${yn(ipReport?.recentAbuse)}
- Connection type: ${ipReport?.connectionType ?? '—'}

## Contact validity
- Phone validates: ${yn(phonePass)}
- Line type: ${phoneInfo.LineType ?? '—'}
- Carrier: ${phoneInfo.Carrier ?? '—'}
- Email validates: ${yn(emailPass)}
- Email domain created: ${emailInfo.DomainCreatedDate ?? '—'}
- Email DNS valid: ${emailInfo.DnsValidationLevel ?? '—'}
`.trimStart();
}
