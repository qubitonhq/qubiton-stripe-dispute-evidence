import { describe, it, expect } from 'vitest';
import { composeEvidence } from '../src/composeEvidence.js';
import { renderMarkdown } from '../src/renderMarkdown.js';
import type {
  AddressResponse,
  EmailValidateResponse,
  IpQualityResponse,
  PhoneValidateResponse,
} from '../src/types.js';

const goodAddr: AddressResponse = {
  address1: '1742 N Damen Ave',
  city: 'Chicago',
  state: 'IL',
  postalCode: '60647',
  country: { countryISO2: 'US' },
  isResidential: true,
  validationResults: [{ validationType: 'Address', validationPass: true }],
};

const goodIp: IpQualityResponse = {
  ipAddress: '73.247.18.92',
  isProxy: false,
  isVPN: false,
  isTOR: false,
  recentAbuse: false,
  isp: 'Comcast Cable Communications',
  city: 'Chicago',
  region: 'Illinois',
  connectionType: 'Residential',
  country: { countryISO2: 'US' },
};

const goodPhone: PhoneValidateResponse = {
  phoneNumber: '+13125550118',
  validationResults: [
    {
      validationType: 'Phone',
      validationPass: true,
      additionalInfo: [
        { key: 'LineType', value: 'Mobile' },
        { key: 'Carrier', value: 'T-Mobile USA' },
        { key: 'Name', value: 'N/A' }, // should be filtered out
        { key: 'City', value: '' },     // should be filtered out
      ],
    },
  ],
};

const goodEmail: EmailValidateResponse = {
  emailAddress: 'jordan@gmail.com',
  validationResults: [
    {
      validationType: 'Email',
      validationPass: true,
      additionalInfo: [
        { key: 'DomainCreatedDate', value: '09/15/2004 04:00:00' },
        { key: 'DnsValidationLevel', value: 'OK' },
      ],
    },
  ],
};

const torIp: IpQualityResponse = {
  ipAddress: '185.220.101.1',
  isProxy: true,
  isVPN: true,
  isTOR: true,
  recentAbuse: true,
  isp: 'Stiftung Erneuerbare Freiheit',
  city: 'Berlin',
  region: 'State of Berlin',
  connectionType: 'Data Center',
  country: { countryISO2: 'DE' },
};

const pagerPhone: PhoneValidateResponse = {
  phoneNumber: '+12132080044',
  fraudScore: 56,
  validationResults: [
    {
      validationType: 'Phone',
      validationPass: true,
      additionalInfo: [
        { key: 'LineType', value: 'Pager' },
        { key: 'Carrier', value: 'USA Mobility' },
      ],
    },
  ],
};

describe('composeEvidence', () => {
  it('builds a complete typed-evidence packet for a clean order', () => {
    const ev = composeEvidence({
      name: 'Jordan Reyes',
      email: 'jordan@gmail.com',
      ip: '73.247.18.92',
      addr: goodAddr,
      ipReport: goodIp,
      phoneReport: goodPhone,
      emailReport: goodEmail,
    });

    expect(ev.customer_name).toBe('Jordan Reyes');
    expect(ev.customer_email_address).toBe('jordan@gmail.com');
    expect(ev.customer_purchase_ip).toBe('73.247.18.92');
    expect(ev.billing_address).toBe('1742 N Damen Ave, Chicago, IL, 60647, US');
    expect(ev.uncategorized_text).toContain('Address validates: Yes');
    expect(ev.uncategorized_text).toContain('Phone validates: Yes');
    expect(ev.uncategorized_text).toContain('Email validates: Yes');
    expect(ev.uncategorized_text).toContain('VPN / Proxy / Tor: No');
    expect(ev.uncategorized_text).toContain('Carrier: T-Mobile USA');
    expect(ev.uncategorized_text).toContain('Line type: Mobile');
  });

  it('omits typed fields cleanly when inputs are missing', () => {
    const ev = composeEvidence({
      name: undefined,
      email: undefined,
      ip: undefined,
      addr: null,
      ipReport: null,
      phoneReport: null,
      emailReport: null,
    });

    expect(ev.customer_name).toBeUndefined();
    expect(ev.customer_email_address).toBeUndefined();
    expect(ev.customer_purchase_ip).toBeUndefined();
    expect(ev.billing_address).toBeUndefined();
    // Markdown still produced, with all placeholders
    expect(ev.uncategorized_text).toContain('Address validates: —');
    expect(ev.uncategorized_text).toContain('Standardized: —');
  });

  it('caps uncategorized_text under 20K chars', () => {
    const longCarrier = 'X'.repeat(50_000);
    const phone: PhoneValidateResponse = {
      validationResults: [
        {
          validationType: 'Phone',
          validationPass: true,
          additionalInfo: [{ key: 'Carrier', value: longCarrier }],
        },
      ],
    };
    const ev = composeEvidence({
      addr: null,
      ipReport: null,
      phoneReport: phone,
      emailReport: null,
    });
    expect(ev.uncategorized_text!.length).toBeLessThanOrEqual(19_500);
  });
});

describe('renderMarkdown', () => {
  it('flags the Tor + pager fraud signal correctly', () => {
    const md = renderMarkdown({
      addr: goodAddr,
      ipReport: torIp,
      phoneReport: pagerPhone,
      emailReport: null,
    });
    expect(md).toContain('VPN / Proxy / Tor: Tor');
    expect(md).toContain('Recent abuse: Yes');
    expect(md).toContain('Connection type: Data Center');
    expect(md).toContain('Line type: Pager');
    expect(md).toContain('Carrier: USA Mobility');
  });

  it('filters N/A and empty values from additionalInfo', () => {
    const md = renderMarkdown({
      addr: null,
      ipReport: null,
      phoneReport: goodPhone, // has 'N/A' Name and empty City
      emailReport: null,
    });
    expect(md).not.toContain('N/A');
  });

  it('does not produce leading-comma when address1 is missing but other parts exist', () => {
    const partialAddr: AddressResponse = {
      city: 'Chicago',
      state: 'IL',
      postalCode: '60647',
    };
    const md = renderMarkdown({
      addr: partialAddr,
      ipReport: null,
      phoneReport: null,
      emailReport: null,
    });
    expect(md).toMatch(/Standardized: Chicago IL 60647/);
    expect(md).not.toMatch(/Standardized: ,/);
    expect(md).not.toMatch(/Standardized: —,/);
  });
});
