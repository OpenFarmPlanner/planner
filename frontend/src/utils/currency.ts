import type { ProjectRegion } from '../auth/types';

export function currencyForRegion(region: ProjectRegion | undefined): string {
  if (region === 'switzerland') return 'CHF';
  return region === 'germany' || region === 'austria' ? 'EUR' : '';
}

export function formatOfferPrice(value: number | string, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency, currencyDisplay: 'code', maximumFractionDigits: 4,
  }).format(Number(value));
}
