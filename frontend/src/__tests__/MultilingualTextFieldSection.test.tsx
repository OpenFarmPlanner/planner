import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MultilingualTextFieldSection } from '../crop-library/components/MultilingualTextFieldSection';

describe('MultilingualTextFieldSection', () => {
  it('edits the original-language text and shows the original language', async () => {
    const user = userEvent.setup();
    const onOriginalValueChange = vi.fn();

    render(
      <MultilingualTextFieldSection
        title="Notizen"
        fieldLabel="Notizen"
        originalLanguageCode="de"
        currentLanguageCode="de"
        originalValue="Robuste Sorte."
        translationValue=""
        translationPlaceholder="Beschreibung"
        onOriginalValueChange={onOriginalValueChange}
        onTranslationValueChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Originalsprache: Deutsch')).toBeInTheDocument();
    expect(screen.queryByLabelText('Deutsch-Übersetzung')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Notizen'), ' Mehr');

    expect(onOriginalValueChange).toHaveBeenCalled();
  });

  it('shows an inline translation field and explicit fallback notice for a missing current-language translation', () => {
    render(
      <MultilingualTextFieldSection
        title="Notizen"
        fieldLabel="Notizen"
        originalLanguageCode="de"
        currentLanguageCode="en"
        originalValue="Robuste Sorte."
        translationValue=""
        translationPlaceholder="Beschreibung"
        onOriginalValueChange={vi.fn()}
        onTranslationValueChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Originaltext auf Deutsch wird angezeigt')).toBeInTheDocument();
    expect(screen.getByLabelText('Englisch-Übersetzung')).toHaveValue('');
    expect(screen.getByLabelText('Englisch-Übersetzung')).toHaveAttribute('lang', 'en');
    expect(screen.getByLabelText('Notizen')).toHaveAttribute('lang', 'de');
  });

  it('loads an existing current-language translation into the inline editor', () => {
    render(
      <MultilingualTextFieldSection
        title="Notizen"
        fieldLabel="Notizen"
        originalLanguageCode="de"
        currentLanguageCode="en"
        originalValue="Robuste Sorte."
        translationValue="A robust variety."
        translationPlaceholder="Beschreibung"
        onOriginalValueChange={vi.fn()}
        onTranslationValueChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Englisch-Übersetzung')).toHaveValue('A robust variety.');
    expect(screen.queryByText('Originaltext auf Deutsch wird angezeigt')).not.toBeInTheDocument();
  });
});
