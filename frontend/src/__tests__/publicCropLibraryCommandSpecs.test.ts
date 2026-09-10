import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import i18n from '../i18n/config';
import { createPublicCropLibraryCommandSpecs } from '../crop-library/publicCropLibraryCommandSpecs';
import type { PublicCrop } from '../api/types';

const CROP = { id: 1, name: 'Tomate' } as PublicCrop;
const OTHER_CROP = { id: 2, name: 'Karotte' } as PublicCrop;

function buildOptions(
  overrides: Partial<Parameters<typeof createPublicCropLibraryCommandSpecs>[0]> = {},
) {
  return {
    // Command labels and keywords follow the UI language.
    t: i18n.getFixedT('de') as TFunction,
    crops: [CROP, OTHER_CROP],
    focusSearch: vi.fn(),
    goToRelativeCrop: vi.fn(),
    handleImport: vi.fn(),
    openEditDialog: vi.fn(),
    selectedCrop: CROP as PublicCrop | null,
    importing: false,
    ...overrides,
  };
}

const specsFor = (overrides: Partial<Parameters<typeof createPublicCropLibraryCommandSpecs>[0]> = {}) =>
  createPublicCropLibraryCommandSpecs(buildOptions(overrides));

const commandById = (
  overrides: Partial<Parameters<typeof createPublicCropLibraryCommandSpecs>[0]>,
  id: string,
) => specsFor(overrides).find((command) => command.id === id);

describe('createPublicCropLibraryCommandSpecs', () => {
  it('registers every library command under the publicCropLibrary context', () => {
    const commands = specsFor();

    expect(commands.map((command) => command.id)).toEqual([
      'publicCropLibrary.focusSearch',
      'publicCropLibrary.edit',
      'publicCropLibrary.import',
      'publicCropLibrary.previous',
      'publicCropLibrary.next',
    ]);
    // A command leaking out of this context would fire on unrelated pages.
    expect(commands.every((command) => command.contextTags?.includes('publicCropLibrary'))).toBe(true);
  });

  it('binds the shortcuts the labels advertise', () => {
    const byId = new Map(specsFor().map((command) => [command.id, command]));

    expect(byId.get('publicCropLibrary.focusSearch')?.keys).toEqual({ key: '/' });
    expect(byId.get('publicCropLibrary.edit')?.keys).toEqual({ alt: true, key: 'e' });
    expect(byId.get('publicCropLibrary.import')?.keys).toEqual({ alt: true, key: 'i' });
    expect(byId.get('publicCropLibrary.previous')?.keys).toEqual({ alt: true, shift: true, key: 'ArrowLeft' });
    expect(byId.get('publicCropLibrary.next')?.keys).toEqual({ alt: true, shift: true, key: 'ArrowRight' });

    expect(byId.get('publicCropLibrary.focusSearch')?.shortcutHint).toBe('/');
    expect(byId.get('publicCropLibrary.edit')?.shortcutHint).toBe('Alt+E');
    expect(byId.get('publicCropLibrary.import')?.shortcutHint).toBe('Alt+I');
    expect(byId.get('publicCropLibrary.previous')?.shortcutHint).toBe('Alt+Shift+←');
    expect(byId.get('publicCropLibrary.next')?.shortcutHint).toBe('Alt+Shift+→');
  });

  it('labels the commands in the UI language', () => {
    const byId = new Map(specsFor().map((command) => [command.id, command]));

    expect(byId.get('publicCropLibrary.focusSearch')?.label).toBe('Kulturbibliothek durchsuchen (/)');
    expect(byId.get('publicCropLibrary.import')?.label).toBe('Kultur ins Projekt übernehmen (Alt+I)');
  });

  it('indexes both the localized and the English search aliases', () => {
    const importCommand = commandById({}, 'publicCropLibrary.import');

    expect(importCommand?.keywords).toEqual(
      expect.arrayContaining(['übernehmen', 'projekt', 'kultur', 'import', 'crop']),
    );
  });

  it('groups all commands under navigation', () => {
    expect(specsFor().every((command) => command.group === 'navigation')).toBe(true);
  });

  describe('focusSearch', () => {
    it('stays available with no crop selected, so the page is never a dead end', () => {
      expect(commandById({ selectedCrop: null, crops: [] }, 'publicCropLibrary.focusSearch')?.isEnabled?.()).toBe(true);
    });

    it('calls focusSearch', () => {
      const options = buildOptions();

      createPublicCropLibraryCommandSpecs(options)
        .find((command) => command.id === 'publicCropLibrary.focusSearch')
        ?.action();

      expect(options.focusSearch).toHaveBeenCalledTimes(1);
    });
  });

  describe('edit', () => {
    it('needs a selected crop', () => {
      expect(commandById({}, 'publicCropLibrary.edit')?.isEnabled?.()).toBe(true);
      expect(commandById({ selectedCrop: null }, 'publicCropLibrary.edit')?.isEnabled?.()).toBe(false);
    });

    it('stays available while an import is running', () => {
      expect(commandById({ importing: true }, 'publicCropLibrary.edit')?.isEnabled?.()).toBe(true);
    });

    it('opens the edit dialog', () => {
      const options = buildOptions();

      createPublicCropLibraryCommandSpecs(options)
        .find((command) => command.id === 'publicCropLibrary.edit')
        ?.action();

      expect(options.openEditDialog).toHaveBeenCalledTimes(1);
    });
  });

  describe('import', () => {
    it('needs a selected crop', () => {
      expect(commandById({}, 'publicCropLibrary.import')?.isEnabled?.()).toBe(true);
      expect(commandById({ selectedCrop: null }, 'publicCropLibrary.import')?.isEnabled?.()).toBe(false);
    });

    it('is disabled while an import is already running, so it cannot be fired twice', () => {
      expect(commandById({ importing: true }, 'publicCropLibrary.import')?.isEnabled?.()).toBe(false);
    });

    it('triggers the import', () => {
      const options = buildOptions();

      createPublicCropLibraryCommandSpecs(options)
        .find((command) => command.id === 'publicCropLibrary.import')
        ?.action();

      expect(options.handleImport).toHaveBeenCalledTimes(1);
    });
  });

  describe('previous and next', () => {
    it('need a selected crop to step away from', () => {
      expect(commandById({ selectedCrop: null }, 'publicCropLibrary.previous')?.isEnabled?.()).toBe(false);
      expect(commandById({ selectedCrop: null }, 'publicCropLibrary.next')?.isEnabled?.()).toBe(false);
    });

    it('need more than one crop, since stepping within a single entry goes nowhere', () => {
      expect(commandById({ crops: [CROP] }, 'publicCropLibrary.previous')?.isEnabled?.()).toBe(false);
      expect(commandById({ crops: [CROP] }, 'publicCropLibrary.next')?.isEnabled?.()).toBe(false);
      expect(commandById({}, 'publicCropLibrary.previous')?.isEnabled?.()).toBe(true);
      expect(commandById({}, 'publicCropLibrary.next')?.isEnabled?.()).toBe(true);
    });

    it('stay available while an import is running', () => {
      expect(commandById({ importing: true }, 'publicCropLibrary.next')?.isEnabled?.()).toBe(true);
    });

    it('each step in their own direction', () => {
      const options = buildOptions();
      const commands = createPublicCropLibraryCommandSpecs(options);

      commands.find((command) => command.id === 'publicCropLibrary.previous')?.action();
      expect(options.goToRelativeCrop).toHaveBeenLastCalledWith('previous');

      commands.find((command) => command.id === 'publicCropLibrary.next')?.action();
      expect(options.goToRelativeCrop).toHaveBeenLastCalledWith('next');
      expect(options.goToRelativeCrop).toHaveBeenCalledTimes(2);
    });
  });
});
