import { useEffect, useId, useRef, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { StemCoordinates } from '../api/types';
import { LocalizedDecimalField } from '../components/inputs/LocalizedDecimalField';
import { useTranslation } from '../i18n';
import {
  generateRegularPlants, MAX_INDIVIDUAL_POSITIONS, type RegularPlantInputs,
} from '../pages/individualPlantGeneration';
import type { RectSize } from '../pages/graphicalLayoutUtils';
import { getActiveFormattingLocale } from '../utils/numberLocalization';

interface Props {
  dimensions: RectSize;
  suggestedSpacing: Pick<RegularPlantInputs, 'plantSpacing' | 'rowSpacing'>;
  occupied: readonly StemCoordinates[];
  existingCount: number;
  initialCount?: number | 'max' | null;
  confirmLabel?: string;
  onConfirm: (positions: StemCoordinates[]) => void;
  onClose: () => void;
}

function PositionPreview({
  dimensions, proposed, occupied, label,
}: {
  dimensions: RectSize;
  proposed: readonly StemCoordinates[];
  occupied: readonly StemCoordinates[];
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const theme = useTheme();
  const background = theme.palette.background.paper;
  const outline = theme.palette.divider;
  const existingColor = theme.palette.text.secondary;
  const proposedColor = theme.palette.primary.main;
  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx) return;
    const { width, height } = element;
    const padding = 12;
    const scale = Math.min((width - 2 * padding) / dimensions.width, (height - 2 * padding) / dimensions.height);
    const boxWidth = dimensions.width * scale;
    const boxHeight = dimensions.height * scale;
    const left = (width - boxWidth) / 2;
    const top = (height - boxHeight) / 2;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = background;
    ctx.fillRect(left, top, boxWidth, boxHeight);
    ctx.strokeStyle = outline;
    ctx.strokeRect(left, top, boxWidth, boxHeight);
    const draw = (points: readonly StemCoordinates[], color: string, radius: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const point of points) {
        if (point.x_m < 0 || point.y_m < 0 || point.x_m > dimensions.width || point.y_m > dimensions.height) continue;
        const x = left + point.x_m * scale;
        const y = top + point.y_m * scale;
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
      ctx.fill();
    };
    draw(occupied, existingColor, 2);
    draw(proposed, proposedColor, 3);
  }, [background, dimensions, existingColor, occupied, outline, proposed, proposedColor]);

  return <Box component="canvas" ref={canvas} aria-label={label} role="img" width={480} height={190}
    data-testid="individual-generation-preview" data-position-count={proposed.length}
    sx={{ display: 'block', width: '100%', height: 'auto', maxHeight: 190, objectFit: 'contain',
      borderRadius: 1, bgcolor: 'action.hover' }} />;
}

/** Shared by graphical placement and the planting-plan creation flow. */
export function IndividualPlantGenerationDialog({
  dimensions, suggestedSpacing, occupied, existingCount, initialCount = null, confirmLabel, onConfirm, onClose,
}: Props) {
  const { t } = useTranslation(['fields', 'common']);
  const tr = (key: string) => t(`fields:individualPlants.generation.${key}`);
  const title = useId();
  const [inputs, setInputs] = useState<RegularPlantInputs>({
    count: typeof initialCount === 'number' ? initialCount : null,
    marginWidth: 0, marginLength: 0, along: 'length', ...suggestedSpacing,
  });
  const [mode, setMode] = useState<'exact' | 'max'>(initialCount === 'max' ? 'max' : 'exact');
  const update = (change: Partial<RegularPlantInputs>) => setInputs(previous => ({ ...previous, ...change }));
  const preview = generateRegularPlants(dimensions, { ...inputs, count: mode === 'max' ? 'max' : inputs.count },
    occupied, existingCount);
  const number = (value: number | bigint) => new Intl.NumberFormat(getActiveFormattingLocale()).format(value);
  const summary = t('fields:individualPlants.generation.summary', {
    rows: number(preview.rowCount),
    added: number(preview.positions.length),
    total: number(existingCount + preview.positions.length),
  });
  const message = preview.problem && t(`fields:individualPlants.generation.${preview.problem}`, {
    max: number(preview.maxAdditional), cap: number(MAX_INDIVIDUAL_POSITIONS), free: number(preview.freeSlots),
  });
  const belowRecommendation = preview.positions.length > 0 && (
    (inputs.plantSpacing ?? 0) < (suggestedSpacing.plantSpacing ?? 0)
    || (inputs.rowSpacing ?? 0) < (suggestedSpacing.rowSpacing ?? 0)
  );

  return (
    <Dialog open onClose={onClose} aria-labelledby={title} fullWidth maxWidth="sm">
      <DialogTitle id={title}>{tr('title')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField select size="small" fullWidth label={tr('quantity')} value={mode}
              onChange={event => setMode(event.target.value === 'max' ? 'max' : 'exact')}>
              <MenuItem value="exact">{tr('exact')}</MenuItem>
              <MenuItem value="max">{tr('max')}</MenuItem>
            </TextField>
            {mode === 'exact' && <LocalizedDecimalField fullWidth size="small" inputMode="numeric"
              label={tr('extraCount')} value={inputs.count} onValueChange={count => update({ count })}
              onInvalidValue={() => update({ count: null })} />}
          </Stack>
          <TextField select fullWidth size="small" label={tr('orientation')} value={inputs.along}
            onChange={event => update({ along: event.target.value === 'length' ? 'length' : 'width' })}>
            <MenuItem value="length">{tr('length')}</MenuItem>
            <MenuItem value="width">{tr('width')}</MenuItem>
          </TextField>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <LocalizedDecimalField fullWidth size="small" label={tr('plantSpacing')} value={inputs.plantSpacing}
              onValueChange={plantSpacing => update({ plantSpacing })}
              onInvalidValue={() => update({ plantSpacing: null })} />
            <LocalizedDecimalField fullWidth size="small" label={tr('rowSpacing')} value={inputs.rowSpacing}
              onValueChange={rowSpacing => update({ rowSpacing })}
              onInvalidValue={() => update({ rowSpacing: null })} />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <LocalizedDecimalField fullWidth size="small" label={tr('marginWidth')} value={inputs.marginWidth}
              onValueChange={marginWidth => update({ marginWidth })}
              onInvalidValue={() => update({ marginWidth: null })} />
            <LocalizedDecimalField fullWidth size="small" label={tr('marginLength')} value={inputs.marginLength}
              onValueChange={marginLength => update({ marginLength })}
              onInvalidValue={() => update({ marginLength: null })} />
          </Stack>
          <PositionPreview dimensions={dimensions} occupied={occupied} proposed={preview.positions} label={summary} />
          {preview.positions.length > 0 && <Typography role="status" variant="body2">{summary}</Typography>}
          {preview.blockedSlots > 0 && (
            <Typography variant="body2" color="text.secondary">{t('fields:individualPlants.generation.blocked', {
              count: preview.blockedSlots, formatted: number(preview.blockedSlots),
            })}</Typography>
          )}
          {belowRecommendation && <Alert severity="warning">{tr('belowRecommendation')}</Alert>}
          {message && <Alert severity="info">{message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap' }}>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button variant="contained" disabled={!preview.positions.length}
          onClick={() => onConfirm(preview.positions)}>{confirmLabel ?? tr('apply')}</Button>
      </DialogActions>
    </Dialog>
  );
}
