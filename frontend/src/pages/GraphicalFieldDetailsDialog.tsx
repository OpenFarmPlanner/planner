import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import type { TFunction } from "i18next";
import { useEffect, useState } from 'react';
import { plantingPlanAPI } from '../api/api';
import type { PlantingPlan } from '../api/types';
import { DetailSection } from '../components/layout/DetailPrimitives';
import LoadRetryButton from '../components/LoadRetryButton';
import { useTranslation } from '../i18n';
import { GrowingAreaPlanLinks } from '../planting-plans/GrowingAreaPlanLinks';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../utils/numberLocalization';

import type { SelectedElement } from "./graphicalFieldsGeometry";

interface GraphicalFieldDetailsDialogProps {
  /** The dialog is open while this is non-null. */
  element: SelectedElement | null;
  onClose: () => void;
  t: TFunction<["fields", "common"]>;
}

/**
 * Presentational details dialog for a clicked field/bed on the graphical
 * map (name, location, parent field, area). Selection state lives in
 * GraphicalFields.tsx; this component only renders.
 */
export function GraphicalFieldDetailsDialog({
  element,
  onClose,
  t,
}: GraphicalFieldDetailsDialogProps) {
  const formatArea = (area: number) => `${formatLocalizedNumber(area, getActiveFormattingLocale(), {
    maximumFractionDigits: 2,
  })} ${t('common:units.squareMeters')}`;
  return (
    <Dialog
      open={Boolean(element)}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle>
        {element
          ? t(`fields:graphical.details.${element.type}`)
          : ""}
      </DialogTitle>
      <DialogContent>
        {element ? (
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Typography>
              {t("common:fields.name")}: {element.name}
            </Typography>
            <Typography>
              {t("fields:graphical.location")}: {element.locationName}
            </Typography>
            {element.parentName ? (
              <Typography>
                {t("fields:graphical.parentField")}:{" "}
                {element.parentName}
              </Typography>
            ) : null}
            {element.area !== null ? (
              <Typography>
                {t("fields:graphical.area")}: {formatArea(element.area)}
              </Typography>
            ) : null}
            <GraphicalAreaPlans key={`${element.type}:${element.id}`} type={element.type} id={element.id} />
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>
          {t("common:actions.close")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function GraphicalAreaPlans({ type, id }: Pick<SelectedElement, 'type' | 'id'>) {
  const { t } = useTranslation(['hierarchy', 'plantingPlans']);
  const [plans, setPlans] = useState<PlantingPlan[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void plantingPlanAPI.listForArea(type, id).then(({ results }) => {
      if (current) setPlans(results);
    }).catch(() => {
      if (current) setLoadFailed(true);
    });
    return () => { current = false; };
  }, [attempt, id, type]);

  if (loadFailed) return <Alert severity="error" action={<LoadRetryButton onClick={() => {
    setLoadFailed(false);
    setAttempt(value => value + 1);
  }} />}>{t('plantingPlans:errors.load')}</Alert>;
  if (!plans.length) return null;
  return <DetailSection title={t('details.sections.plantingPlans')}>
    <GrowingAreaPlanLinks plans={plans} showBed={type === 'field'} />
  </DetailSection>;
}
