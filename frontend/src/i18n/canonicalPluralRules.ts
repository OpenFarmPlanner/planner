import type { ThirdPartyModule } from 'i18next';

import { normalizeLanguageTag } from './languages';

interface PluralResolver {
  getRule(code: string, options?: { ordinal?: boolean }): Intl.PluralRules | undefined;
}

/** The pt bundle is European Portuguese; i18next otherwise asks Intl for Brazilian pt rules. */
export const canonicalPluralRules: ThirdPartyModule = {
  type: '3rdParty',
  init(instance) {
    const resolver = instance.services.pluralResolver as PluralResolver;
    const getRule = resolver.getRule.bind(resolver);
    resolver.getRule = (code, options) =>
      getRule(normalizeLanguageTag(code) === 'pt' ? 'pt-PT' : code, options);
  },
};
