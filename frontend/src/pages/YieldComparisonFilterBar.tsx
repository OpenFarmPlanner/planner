import { useId, useState } from 'react';
import { Autocomplete, Button, MenuItem, Stack, TextField } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import type { YieldComparisonFilterOptions, YieldComparisonFilters } from '../api/types';
import { useTranslation } from '../i18n';
import { tokenizeSearchQuery } from '../search/searchText';
import type { YieldComparisonCropGroup } from './yieldComparisonFilters';

interface Props {
  options: YieldComparisonFilterOptions;
  groups: YieldComparisonCropGroup[];
  selected: YieldComparisonCropGroup[];
  filters: YieldComparisonFilters;
  onChange: (filters: YieldComparisonFilters) => void;
}

const selectStyles = { flex: '1 1 10rem', maxWidth: { xs: '100%', sm: '15rem' }, minWidth: 0 };
const readId = (value: string) => value === 'all' ? null : Number(value);

export function YieldComparisonFilterBar({ options, groups, selected, filters, onChange }: Props) {
  const { t } = useTranslation(['yieldOverview', 'common', 'plantingPlans', 'ganttChart']);
  const advancedId = useId();
  const cropInputId = useId();
  const hasAdvancedFilters = filters.fieldId !== null || filters.bedId !== null || filters.varietyId !== null;
  const [advanced, setAdvanced] = useState(hasAdvancedFilters);
  const fields = options.fields.filter(field =>
    filters.locationId === null || filters.locationId === field.location_id);
  const fieldIds = new Set(fields
    .filter(field => filters.fieldId === null || filters.fieldId === field.id).map(field => field.id));
  const beds = options.beds.filter(bed => fieldIds.has(bed.field_id));
  const cropIds = new Set(selected.flatMap(group => group.cropIds));
  const varieties = options.crops.filter(crop =>
    crop.variety && (cropIds.size === 0 || cropIds.has(crop.id)));
  const changeCrops = (next: YieldComparisonCropGroup[]) => {
    const varietyId = next.length === 0 || next.some(group => filters.varietyId !== null
      && group.cropIds.includes(filters.varietyId)) ? filters.varietyId : null;
    onChange({ ...filters, cropKeys: next.map(group => group.key), varietyId });
  };
  const scopeName = (id: number | null) => id ?? 'all';
  const fieldLabel = (field: YieldComparisonFilterOptions['fields'][number]) => [
    filters.locationId === null ? options.locations.find(site => site.id === field.location_id)?.name : null,
    field.name,
  ].filter(Boolean).join(' › ');

  return <Stack spacing={1}>
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
      <Autocomplete
        id={cropInputId} multiple options={groups} value={selected} limitTags={1} disableCloseOnSelect
        openOnFocus size="small" clearText={t('filters.clearCrops')}
        getOptionLabel={group => group.name} getOptionKey={group => group.key}
        isOptionEqualToValue={(group, value) => group.key === value.key}
        filterOptions={(items, { inputValue }) => {
          const terms = tokenizeSearchQuery(inputValue);
          return items.filter(group => terms.every(term => group.terms.some(name => name.includes(term))));
        }}
        onChange={(_, next) => changeCrops(next)}
        renderInput={params => <TextField {...params} label={t('filters.crop')}
          placeholder={selected.length === 0 ? t('filters.allCrops') : undefined}
          slotProps={{ ...params.slotProps, inputLabel: { ...params.slotProps.inputLabel, shrink: true } }} />}
        sx={{
          flex: '2 1 13rem', maxWidth: { xs: '100%', sm: '24rem' }, minWidth: 0,
          '& .MuiAutocomplete-clearIndicator': { visibility: 'visible' },
        }}
      />
      <TextField select size="small" sx={selectStyles} label={t('plantingPlans:columns.location')}
        value={scopeName(filters.locationId)}
        onChange={event => onChange({ ...filters, locationId: readId(event.target.value), fieldId: null, bedId: null })}>
        <MenuItem value="all">{t('ganttChart:treeFilters.allLocations')}</MenuItem>
        {options.locations.map(location => <MenuItem key={location.id} value={location.id}>{location.name}</MenuItem>)}
      </TextField>
      <TextField select size="small" sx={selectStyles} label={t('filters.seasonWindow')}
        value={filters.seasonWindow}
        onChange={event => onChange({ ...filters, seasonWindow: event.target.value as YieldComparisonFilters['seasonWindow'] })}>
        <MenuItem value="3">{t('filters.lastThreeSeasons')}</MenuItem>
        <MenuItem value="5">{t('filters.lastFiveSeasons')}</MenuItem>
        <MenuItem value="all">{t('filters.allSeasons')}</MenuItem>
      </TextField>
      <Button startIcon={<FilterListIcon />} aria-expanded={advanced} aria-controls={advancedId}
        variant={hasAdvancedFilters ? 'outlined' : 'text'} onClick={() => setAdvanced(value => !value)}>
        {t('filters.moreFilters')}
      </Button>
    </Stack>
    <Stack id={advancedId} direction="row" spacing={1} useFlexGap
      sx={{ display: advanced ? 'flex' : 'none', flexWrap: 'wrap', alignItems: 'center' }}>
      <TextField select size="small" sx={selectStyles} label={t('filters.variety')}
        value={scopeName(filters.varietyId)}
        onChange={event => onChange({ ...filters, varietyId: readId(event.target.value) })}>
        <MenuItem value="all">{t('filters.allVarieties')}</MenuItem>
        {varieties.map(crop => <MenuItem key={crop.id} value={crop.id}>{crop.name}</MenuItem>)}
      </TextField>
      <TextField select size="small" sx={selectStyles} label={t('plantingPlans:columns.field')}
        value={scopeName(filters.fieldId)}
        onChange={event => onChange({ ...filters, fieldId: readId(event.target.value), bedId: null })}>
        <MenuItem value="all">{t('ganttChart:treeFilters.allFields')}</MenuItem>
        {fields.map(field => <MenuItem key={field.id} value={field.id}>{fieldLabel(field)}</MenuItem>)}
      </TextField>
      <TextField select size="small" sx={selectStyles} label={t('plantingPlans:columns.bed')}
        value={scopeName(filters.bedId)}
        onChange={event => onChange({ ...filters, bedId: readId(event.target.value) })}>
        <MenuItem value="all">{t('filters.allBeds')}</MenuItem>
        {beds.map(bed => {
          const field = fields.find(option => option.id === bed.field_id);
          const label = filters.fieldId === null && field ? `${fieldLabel(field)} › ${bed.name}` : bed.name;
          return <MenuItem key={bed.id} value={bed.id}>{label}</MenuItem>;
        })}
      </TextField>
      {hasAdvancedFilters && <Button onClick={() => onChange({
        ...filters, varietyId: null, fieldId: null, bedId: null,
      })}>{t('common:actions.reset')}</Button>}
    </Stack>
  </Stack>;
}
