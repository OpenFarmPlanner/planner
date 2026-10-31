import type { PublicCrop } from '../../../api/types';
import { CompanionKindColumns } from '../../../crops/CompanionKindColumns';
import { companionReasonLabelKey, type LibraryCompanionRow } from '../../../crops/companions';
import { useTranslation } from '../../../i18n';
import { DetailSection } from './DetailPrimitives';

interface LibraryCompanionsSectionProps {
  rows: readonly LibraryCompanionRow[];
  onSelectEntry: (entry: PublicCrop) => void;
}

/** "Mischkultur" on the library page, styled as in the crop details; a neighbour with an entry links to it. */
export function LibraryCompanionsSection({ rows, onSelectEntry }: LibraryCompanionsSectionProps) {
  const { t } = useTranslation('crops');
  return (
    <DetailSection title={t('companions.title')}>
      <div data-testid="library-companions-section">
        <CompanionKindColumns
          items={rows.map((row, index) => {
            const reason = row.reason === 'other' ? '' : t(companionReasonLabelKey(row.reason));
            const { entry } = row;
            return {
              key: `${row.kind}-${row.label}-${index}`,
              kind: row.kind,
              label: row.label,
              detail: [reason, row.note].filter(Boolean).join(': '),
              onSelect: entry ? () => onSelectEntry(entry) : undefined,
            };
          })}
        />
      </div>
    </DetailSection>
  );
}
