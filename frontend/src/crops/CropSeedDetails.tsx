import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type { ReactNode } from 'react';
import type { CultivationType, SeedRateUnit } from '../api/types';
import {
  formatNumber,
  formatSeedRateNumber,
  formatSeedUnitLabel,
} from './cropDetailFormatters';
import { varietySpecificValueHighlightSx } from './varietyValueAccent';
import { ValueWithLibraryPin } from './LibraryPinIndicator';

export interface CropSeedRateRow {
  method: CultivationType;
  value: number;
  unit: SeedRateUnit | string;
  /** Omitted where the safety margin is not part of the data set (public library). */
  safety?: number | null;
  valueSource?: ValueSource | null;
  safetySource?: ValueSource | null;
}

export type ValueSource = 'fromCrop' | 'ownValue';

interface CropSeedDetailsProps {
  activeCultivationTypes: CultivationType[];
  cultivationTypeSource?: ValueSource | null;
  /** The locally-pinned marker after the value (crop detail read view only). */
  cultivationTypePin?: ReactNode;
  seedRateRows: CropSeedRateRow[];
  /**
   * The seed safety margin is a farm-specific planning decision, so views on
   * data that is not farm-specific (the public crop library) hide it entirely
   * instead of rendering an empty value.
   */
  showSeedSafetyMargin?: boolean;
  sowingSafetyPercent?: number | null;
  sowingSafetySource?: ValueSource | null;
  seedingRequirement?: number | null;
  seedingRequirementSource?: ValueSource | null;
  seedingRequirementType?: 'per_sqm' | 'per_plant' | '';
  seedingRequirementTypeSource?: ValueSource | null;
  thousandKernelWeightG?: number | null;
  thousandKernelWeightSource?: ValueSource | null;
  thousandKernelWeightPin?: ReactNode;
  emptyValueLabel: string;
  locale: string;
  t: (key: string) => string;
}

const seedDetailGridSx = {
  display: 'grid',
  gridTemplateColumns: {
    xs: '1fr',
    sm: 'repeat(2, minmax(180px, 1fr))',
    lg: 'repeat(3, minmax(180px, 1fr))',
  },
  gap: 2,
  justifyContent: 'start',
} as const;

function getOwnValueSx(source?: ValueSource | null) {
  return source === 'ownValue' ? varietySpecificValueHighlightSx : undefined;
}

function ValueWithSource({
  children,
  source,
  pin,
}: {
  children: ReactNode;
  source?: ValueSource | null;
  pin?: ReactNode;
}) {
  return (
    <ValueWithLibraryPin pin={pin}>
      <Typography variant="body1" sx={getOwnValueSx(source)}>
        {children}
      </Typography>
    </ValueWithLibraryPin>
  );
}

export function CropSeedDetails({
  activeCultivationTypes,
  cultivationTypeSource = null,
  cultivationTypePin,
  seedRateRows,
  showSeedSafetyMargin = true,
  sowingSafetyPercent,
  sowingSafetySource = null,
  seedingRequirement,
  seedingRequirementSource = null,
  seedingRequirementType,
  seedingRequirementTypeSource = null,
  thousandKernelWeightG,
  thousandKernelWeightSource = null,
  thousandKernelWeightPin,
  emptyValueLabel,
  locale,
  t,
}: CropSeedDetailsProps) {
  const hasSingleSeedRate = seedRateRows.length > 0 && activeCultivationTypes.length <= 1;
  const hasMethodSeedRates = seedRateRows.length > 0 && activeCultivationTypes.length > 1;

  return (
    <Box sx={seedDetailGridSx}>
      {activeCultivationTypes.length > 0 && (
        <Box sx={{ gridColumn: '1 / -1' }}>
          <Typography variant="body2" color="text.secondary">
            {t('form.cultivationType')}
          </Typography>
          <ValueWithSource source={cultivationTypeSource} pin={cultivationTypePin}>
            {activeCultivationTypes
              .map((item) => (
                item === 'pre_cultivation'
                  ? t('form.cultivationTypePreCultivation')
                  : t('form.cultivationTypeDirectSowing')
              ))
              .join(', ')}
          </ValueWithSource>
        </Box>
      )}
      {hasSingleSeedRate && (
        <Box>
          <Typography variant="body2" color="text.secondary">
            {t('form.seedAmountLabel')}
          </Typography>
          <ValueWithSource source={seedRateRows[0].valueSource}>
            {formatSeedRateNumber(seedRateRows[0].value, t, locale)} {formatSeedUnitLabel(seedRateRows[0].unit, t)}
          </ValueWithSource>
        </Box>
      )}
      {hasSingleSeedRate && showSeedSafetyMargin && (
        <Box>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 1 }}
          >
            {t('detail.fields.seedSafetyMargin')}
          </Typography>
          <ValueWithSource source={seedRateRows[0].safetySource}>
            {seedRateRows[0].safety !== null && seedRateRows[0].safety !== undefined
              ? `${formatNumber(seedRateRows[0].safety, t, locale)} ${t('detail.units.percent')}`
              : '-'}
          </ValueWithSource>
        </Box>
      )}
      {hasMethodSeedRates && (
        <Box sx={{ gridColumn: '1 / -1' }}>
          <Typography variant="body2" color="text.secondary">{t('detail.fields.seedRateByCultivation')}</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('detail.fields.method')}</TableCell>
                <TableCell>{t('form.seedAmountLabel')}</TableCell>
                <TableCell>{t('form.seedUnitLabel')}</TableCell>
                {showSeedSafetyMargin && (
                  <TableCell>{t('detail.fields.seedSafetyMarginPercent')}</TableCell>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {seedRateRows.map((row) => (
                <TableRow key={`${row.method}-${row.unit}-${row.value}`}>
                  <TableCell>{row.method === 'pre_cultivation' ? t('form.cultivationTypePreCultivation') : t('form.cultivationTypeDirectSowing')}</TableCell>
                  <TableCell>
                    <Box component="span" sx={getOwnValueSx(row.valueSource)}>
                      {formatSeedRateNumber(row.value, t, locale)}
                    </Box>
                  </TableCell>
                  <TableCell>
                    {formatSeedUnitLabel(row.unit, t)}
                  </TableCell>
                  {showSeedSafetyMargin && (
                    <TableCell>
                      <Box component="span" sx={getOwnValueSx(row.safetySource)}>
                        {row.safety !== null && row.safety !== undefined
                          ? `${formatNumber(row.safety, t, locale)} ${t('detail.units.percent')}`
                          : '-'}
                      </Box>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      {seedRateRows.length === 0 && showSeedSafetyMargin && sowingSafetyPercent !== undefined && sowingSafetyPercent !== null && (
        <Box>
          <Typography variant="body2" color="text.secondary">
            {t('detail.fields.seedSafetyMargin')}
          </Typography>
          <ValueWithSource source={sowingSafetySource}>
            {formatNumber(sowingSafetyPercent, t, locale)} {t('detail.units.percent')}
          </ValueWithSource>
        </Box>
      )}
      {seedingRequirement !== undefined && seedingRequirement !== null && (
        <Box>
          <Typography
            variant="body2"
            color="text.secondary"
          >
            {t('detail.fields.seedingRequirement')}
          </Typography>
          <ValueWithSource source={seedingRequirementSource ?? seedingRequirementTypeSource}>
            {formatSeedRateNumber(seedingRequirement, t, locale)}
            {seedingRequirementType === 'per_sqm'
              ? ` ${t('detail.seedingRequirementTypes.perSqm')}`
              : seedingRequirementType === 'per_plant'
                ? ` ${t('detail.seedingRequirementTypes.perPlant')}`
                : ''}
          </ValueWithSource>
        </Box>
      )}
      <Box>
        <Typography variant="body2" color="text.secondary">
          {t('form.thousandKernelWeightLabel')}
        </Typography>
        <ValueWithSource source={thousandKernelWeightSource} pin={thousandKernelWeightPin}>
          {thousandKernelWeightG !== null && thousandKernelWeightG !== undefined
            ? `${formatNumber(thousandKernelWeightG, t, locale)} ${t('detail.units.grams')}`
            : emptyValueLabel}
        </ValueWithSource>
      </Box>
    </Box>
  );
}
