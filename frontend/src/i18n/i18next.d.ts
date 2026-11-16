import 'i18next';

declare module 'i18next' {
  interface CustomTypeOptions {
    // Bundles and helper keys are dynamic; retain the v26 optional-options contract.
    strictInterpolationChecks: false;
  }
}
