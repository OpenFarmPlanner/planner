import { useId, useState } from 'react';
import { Badge, Box, Button, IconButton, Popover, Stack, Typography } from '@mui/material';
import RuleIcon from '@mui/icons-material/Rule';
import { visuallyHidden } from '@mui/utils';
import type { TFunction } from 'i18next';
import { AppTooltip } from '../components/AppTooltip';
import type { GeometryIssue } from '../components/hierarchy/utils/growingAreaGeometry';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../utils/numberLocalization';
import { getGraphicalPortalContainer } from './useGraphicalStageSize';
import { getBedWorldRect, type analyzeGraphicalGeometry, type GraphicalParcel } from './graphicalAreaGeometry';
import type { Rect } from './graphicalLayoutUtils';

interface Subject {
  name: string;
  rect: Rect;
}

interface Warning {
  key: string;
  text: string;
  subjects: Subject[];
}

function describeIssues(
  issues: readonly GeometryIssue[],
  subjects: ReadonlyMap<number, Subject>,
  parent: Subject | null,
  t: TFunction<['fields', 'common']>,
): Warning[] {
  return issues.flatMap(issue => {
    if (issue.kind === 'noPathSpace') {
      return parent ? [{ key: 'noPathSpace', text: t('fields:graphical.geometry.noPathSpace', { name: parent.name }),
        subjects: [parent] }] : [];
    }
    if (issue.kind === 'outside') {
      const subject = subjects.get(issue.id);
      if (!subject) return [];
      const text = parent
        ? t('fields:graphical.geometry.bedOutside', { name: subject.name, parent: parent.name })
        : t('fields:graphical.geometry.parcelOutside', { name: subject.name });
      return [{ key: `outside-${issue.id}`, text, subjects: [subject] }];
    }
    const first = subjects.get(issue.ids[0]);
    const second = subjects.get(issue.ids[1]);
    if (!first || !second) return [];
    const names = { first: first.name, second: second.name };
    if (issue.kind === 'overlap') {
      return [{ key: `overlap-${issue.ids.join('-')}`, text: t('fields:graphical.geometry.overlap', names),
        subjects: [first, second] }];
    }
    const locale = getActiveFormattingLocale();
    const centimeters = (distance: number) => formatLocalizedNumber(distance * 100, locale, { maximumFractionDigits: 2 });
    return [{ key: `gap-${issue.ids.join('-')}`, text: t('fields:graphical.geometry.shortGap', {
      ...names, actual: centimeters(issue.gapM), recommended: centimeters(issue.recommendedM),
    }), subjects: [first, second] }];
  });
}

interface GraphicalGeometryWarningsProps {
  t: TFunction<['fields', 'common']>;
  parcels: readonly GraphicalParcel[];
  analysis: ReturnType<typeof analyzeGraphicalGeometry>;
  outsideParcels: ReadonlySet<number>;
  focusArea: (rect: Rect) => void;
}

function describeGraphicalWarnings(
  parcels: GraphicalGeometryWarningsProps['parcels'],
  analysis: GraphicalGeometryWarningsProps['analysis'],
  outsideParcels: GraphicalGeometryWarningsProps['outsideParcels'],
  t: GraphicalGeometryWarningsProps['t'],
) {
  const parcelSubjects = new Map(parcels.map(({ field, rect }) => [rect.id, { name: field.name, rect }]));
  const locationIssues = analysis.locationReport.issues.filter(issue => issue.kind !== 'outside');
  const outsideIssues: GeometryIssue[] = Array.from(outsideParcels, id => ({ kind: 'outside', id }));
  const warnings = describeIssues([...outsideIssues, ...locationIssues], parcelSubjects, null, t);
  const uncertainty: string[] = [];
  if (analysis.locationReport.coverage.grossArea === null) {
    uncertainty.push(t('fields:graphical.geometry.unknownLocation'));
  }
  const listFormat = new Intl.ListFormat(getActiveFormattingLocale());
  const names = (ids: readonly number[], subjects: ReadonlyMap<number, Subject>) =>
    listFormat.format(ids.map(id => subjects.get(id)?.name ?? '').filter(Boolean));
  if (analysis.locationReport.uncertainIds.length > 0) {
    uncertainty.push(t('fields:graphical.geometry.unknownParcels', {
      names: names(analysis.locationReport.uncertainIds, parcelSubjects),
    }));
  }
  for (const parcel of parcels) {
    const { field, rect, layout } = parcel;
    const report = analysis.parcelReports.get(rect.id);
    if (!report) continue;
    const beds = new Map(layout.bedRects.map(bed => [bed.id, { name: bed.name, rect: getBedWorldRect(parcel, bed) }]));
    const parent = { name: field.name, rect };
    warnings.push(...describeIssues(report.issues, beds, parent, t).map(warning => ({
      ...warning, key: `${rect.id}-${warning.key}`,
    })));
    if (report.uncertainIds.length > 0) {
      uncertainty.push(t('fields:graphical.geometry.unknownBeds', {
        name: field.name, names: names(report.uncertainIds, beds),
      }));
    }
  }

  return { warnings, uncertainty };
}

export function GraphicalGeometryWarnings({ t, parcels, analysis, outsideParcels, focusArea }: GraphicalGeometryWarningsProps) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const locationReport = analysis.locationReport;
  const parcelReports = [...analysis.parcelReports.values()];
  const count = outsideParcels.size
    + locationReport.issues.filter(issue => issue.kind === 'overlap' || issue.kind === 'shortGap').length
    + parcelReports.reduce((total, report) => total + report.issues.length, 0);
  const available = count > 0 || locationReport.coverage.grossArea === null
    || locationReport.uncertainIds.length > 0 || parcelReports.some(report => report.uncertainIds.length > 0);
  const label = count > 0 ? t('fields:graphical.geometry.open', { count }) : t('fields:graphical.geometry.title');
  const { warnings, uncertainty } = anchor ? describeGraphicalWarnings(parcels, analysis, outsideParcels, t)
    : { warnings: [], uncertainty: [] };
  return (
    <>
      <Box role="status" sx={visuallyHidden}>{available ? label : ''}</Box>
      {available || anchor ? (
        <AppTooltip title={label} placement="left" disableInteractive
          slotProps={{ popper: { container: getGraphicalPortalContainer } }}>
          <IconButton
            size="small"
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={Boolean(anchor)}
            aria-controls={anchor ? id : undefined}
            onClick={event => setAnchor(event.currentTarget)}
            sx={{ borderRadius: 0, width: 44, height: 44 }}
          >
            <Badge color="warning" badgeContent={count}>
              <RuleIcon fontSize="small" />
            </Badge>
          </IconButton>
        </AppTooltip>
      ) : null}
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        container={getGraphicalPortalContainer()}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: {
          id, role: 'dialog', 'aria-modal': true, 'aria-labelledby': `${id}-title`,
          sx: { width: 410, maxWidth: 'calc(100% - 32px)', maxHeight: '65vh' },
        } }}
      >
        <Stack spacing={1} sx={{ p: 2 }}>
          <Typography id={`${id}-title`} component="h2" variant="subtitle1" sx={{ fontWeight: 600 }}>
            {t('fields:graphical.geometry.title')}
          </Typography>
          {warnings.length > 0 ? (
            <Stack component="ul" spacing={0.75} sx={{ m: 0, pl: 2.5 }}>
              {warnings.map(warning => (
                <Box component="li" key={warning.key}>
                  <Typography variant="body2">{warning.text}</Typography>
                  <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
                    {warning.subjects.map((subject, index) => (
                      <Button key={index} size="small" sx={{ minHeight: 44 }} onClick={() => {
                        focusArea(subject.rect);
                        setAnchor(null);
                      }} aria-label={t('fields:graphical.geometry.focus', { name: subject.name })}>
                        {subject.name}
                      </Button>
                    ))}
                  </Stack>
                </Box>
              ))}
            </Stack>
          ) : null}
          {uncertainty.map(text => <Typography key={text} variant="body2" color="text.secondary">{text}</Typography>)}
          <Button onClick={() => setAnchor(null)} sx={{ alignSelf: 'flex-end', minHeight: 44 }}>{t('common:actions.close')}</Button>
        </Stack>
      </Popover>
    </>
  );
}
