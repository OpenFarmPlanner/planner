import { useId, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import type { CropBulkDeleteRecord } from '../api/types';
import { useTranslation } from '../i18n';

const INITIAL_LIST_SIZE = 8;

export function CropAffectedList({ records, label }: {
  records: CropBulkDeleteRecord[];
  label: string;
}) {
  const { t } = useTranslation('crops');
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const nodes = new Map(records.map(record => [record.id, { record, varieties: [] as CropBulkDeleteRecord[] }]));
  const groups = [...nodes.values()].filter(({ record }) => {
    const parent = record.parent_id === null ? undefined : nodes.get(record.parent_id);
    if (!parent) return true;
    parent.varieties.push(record);
    return false;
  });
  const visibleIds = expanded
    ? new Set(nodes.keys())
    : new Set(groups.flatMap(({ record, varieties }) => [record, ...varieties])
      .slice(0, INITIAL_LIST_SIZE).map(record => record.id));
  const omitted = records.length - INITIAL_LIST_SIZE;

  const nameRow = (record: CropBulkDeleteRecord, nested: boolean) => (
    <>
      <Typography component="span" variant="caption" color="text.secondary" sx={{ mr: 0.75 }}>
        {t(record.variety ? 'bulkDelete.varietyLabel' : 'bulkDelete.cultureLabel')}
      </Typography>
      <span>{record.variety
        ? nested ? record.variety : t('bulkDelete.varietyInCulture', { culture: record.parent_name, variety: record.variety })
        : record.name}</span>
    </>
  );

  return (
    <Box sx={{ typography: 'body2', overflowWrap: 'anywhere' }}>
      <Box component="ul" id={listId} aria-label={label} sx={{ my: 0, pl: 2.5, '& li': { py: 0.25 } }}>
        {groups.filter(({ record }) => visibleIds.has(record.id)).map(({ record, varieties }) => {
          const visibleVarieties = varieties.filter(variety => visibleIds.has(variety.id));
          return (
            <li key={record.id}>
              {nameRow(record, false)}
              {visibleVarieties.length > 0 ? (
                <Box component="ul" sx={{ pl: 2.5 }}>
                  {visibleVarieties.map(variety => <li key={variety.id}>{nameRow(variety, true)}</li>)}
                </Box>
              ) : null}
            </li>
          );
        })}
      </Box>
      {omitted > 0 ? (
        <Button variant="text" size="small" aria-expanded={expanded} aria-controls={listId}
          onClick={() => setExpanded(value => !value)}>
          {expanded ? t('bulkDelete.showFewer') : t('bulkDelete.showMore', { count: omitted })}
        </Button>
      ) : null}
    </Box>
  );
}
