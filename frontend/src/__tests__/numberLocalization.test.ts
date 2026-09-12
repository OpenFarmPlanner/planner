import {
  formatLocalizedNumber,
  formatLocalizedNumberForInput,
  parseLocalizedNumber,
  resolveLocaleFromLanguage,
} from "../utils/numberLocalization";

describe("numberLocalization utilities", () => {
  it("formats decimals with comma in German locale", () => {
    expect(
      formatLocalizedNumber(12.75, "de-DE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    ).toBe("12,75");
  });

  it("parses German decimal input with comma", () => {
    expect(parseLocalizedNumber("1,5", "de-DE")).toBe(1.5);
  });

  it("parses decimal input with dot in German locale", () => {
    expect(parseLocalizedNumber("1.5", "de-DE")).toBe(1.5);
  });

  it("returns null for invalid localized number input", () => {
    expect(parseLocalizedNumber("abc", "de-DE")).toBeNull();
  });

  it("resolves language codes to locale tags", () => {
    expect(resolveLocaleFromLanguage("de")).toBe("de-DE");
    expect(resolveLocaleFromLanguage("en")).toBe("en-US");
  });

  it("formats editable values without grouping and allows precision overrides", () => {
    expect(formatLocalizedNumberForInput(1234.5678912, "de-DE")).toBe("1234,567891");
    expect(
      formatLocalizedNumberForInput(1234.567, "en-US", { maximumFractionDigits: 2 }),
    ).toBe("1234.57");
  });
});

describe('formatLocalizedNumber caching', () => {
  it('reuses one Intl.NumberFormat per locale and options', () => {
    // Grid cells format numbers on every render, and constructing a formatter
    // costs far more than using one — see numberLocalization.ts.
    const options = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    formatLocalizedNumber(0, 'de-DE', options);

    const constructorSpy = vi.spyOn(Intl, 'NumberFormat');
    try {
      for (let i = 0; i < 25; i += 1) {
        expect(formatLocalizedNumber(i, 'de-DE', options)).toContain(',');
      }
      expect(constructorSpy).not.toHaveBeenCalled();
    } finally {
      constructorSpy.mockRestore();
    }
  });

  it('keeps formatters for different options apart', () => {
    expect(formatLocalizedNumber(1.5, 'de-DE', { minimumFractionDigits: 3 })).toBe('1,500');
    expect(formatLocalizedNumber(1.5, 'de-DE', { minimumFractionDigits: 1 })).toBe('1,5');
    expect(formatLocalizedNumber(1.5, 'en-US', { minimumFractionDigits: 1 })).toBe('1.5');
  });
});
