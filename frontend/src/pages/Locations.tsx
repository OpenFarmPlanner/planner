import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { locationAPI, type Location } from '../api/api';
import PageContainer from '../components/layout/PageContainer';
import { useTranslation } from '../i18n';
import { formatLocalizedNumber, resolveLocaleFromLanguage } from '../utils/numberLocalization';
import { useProjectRequirement } from '../hooks/useProjectRequirement';
import ProjectRequiredState from '../components/project/ProjectRequiredState';
import EmptyStateCard from '../components/project/EmptyStateCard';
import { useLocation, useNavigate } from 'react-router';
import { useRegisterCreateActions } from '../commands/useCommandContext';
import { confirmAction } from '../utils/confirmAction';
import {
  formRowSx,
  fullWidthFieldSx,
  mediumFieldSx,
  smallFieldSx,
  wideFieldSx,
} from '../components/forms/formLayout';

type SoilType = NonNullable<Location['soil_type']>;
type Exposure = NonNullable<Location['exposure']>;

interface LocationFormState {
  name: string;
  coordinates: string;
  address: string;
  description: string;
  soil_type: SoilType | '';
  exposure: Exposure | '';
  notes: string;
}

const SOIL_OPTIONS: Array<{ value: SoilType; labelKey: string }> = [
  { value: 'sand', labelKey: 'sand' },
  { value: 'loam', labelKey: 'loam' },
  { value: 'clay', labelKey: 'clay' },
];

const EXPOSURE_OPTIONS: Array<{ value: Exposure; labelKey: string }> = [
  { value: 'north', labelKey: 'north' },
  { value: 'south', labelKey: 'south' },
  { value: 'east', labelKey: 'east' },
  { value: 'west', labelKey: 'west' },
  { value: 'flat', labelKey: 'flat' },
];

const emptyForm: LocationFormState = {
  name: '',
  coordinates: '',
  address: '',
  description: '',
  soil_type: '',
  exposure: '',
  notes: '',
};

const parseCoordinateValue = (value: string): number | null => {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseCoordinatesInput = (value: string): { latitude: number; longitude: number } | null => {
  const normalized = value.trim();
  if (!normalized) return null;

  const rawParts = normalized.includes(',')
    ? normalized.split(/\s*,\s*/)
    : normalized.split(/\s+/);

  if (rawParts.length !== 2) {
    return null;
  }

  const latitude = parseCoordinateValue(rawParts[0]);
  const longitude = parseCoordinateValue(rawParts[1]);
  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
};

const validateCoordinateRange = (value: number | null, min: number, max: number): boolean =>
  value === null || (value >= min && value <= max);

const formatCoordinate = (value: number, locale: string): string =>
  formatLocalizedNumber(value, locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 });

const toFormState = (location: Location | null): LocationFormState => ({
  name: location?.name ?? '',
  coordinates:
    typeof location?.latitude === 'number' && typeof location?.longitude === 'number'
      ? `${location.latitude}, ${location.longitude}`
      : '',
  address: location?.address ?? '',
  description: location?.description ?? '',
  soil_type: location?.soil_type ?? '',
  exposure: location?.exposure ?? '',
  notes: location?.notes ?? '',
});

function Locations() {
  const { t, i18n } = useTranslation(['locations', 'common']);
  const location = useLocation();
  const navigate = useNavigate();
  const { shouldShowProjectRequiredState, missingProjectReason } = useProjectRequirement();
  const numberLocale = resolveLocaleFromLanguage(i18n.language);
  const [locations, setLocations] = useState<Location[]>([]);
  const [isFetching, setLoading] = useState<boolean>(true);
  const [fetchError, setError] = useState<string>('');

  // Without a project there is nothing to fetch, so the page is neither
  // loading nor in error. Derived rather than pushed into state from an
  // effect: the effect version cost an extra render pass and left the page
  // stuck on "loading" whenever the reset was missed.
  const loading = shouldShowProjectRequiredState ? false : isFetching;
  const error = shouldShowProjectRequiredState ? '' : fetchError;
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [formState, setFormState] = useState<LocationFormState>(emptyForm);
  const [formError, setFormError] = useState<string>('');
  const [formErrorField, setFormErrorField] = useState<'name' | 'coordinates' | null>(null);

  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const { results } = await locationAPI.listAll();
      setLocations(results);
    } catch {
      setError(t('locations:errors.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (shouldShowProjectRequiredState) {
      return;
    }
    void loadData();
  }, [loadData, shouldShowProjectRequiredState]);

  const openCreateDialog = useCallback((): void => {
    setEditingLocation(null);
    setFormState(emptyForm);
    setFormError('');
    setFormErrorField(null);
    setDialogOpen(true);
    // `setFormState` is listed because the compiler infers it as a dependency.
    // useState setters are stable, so this does not change the callback identity.
  }, [setFormState]);

  const createActions = useMemo(() => [
    {
      id: 'create-location',
      label: t('locations:addButton'),
      shortcut: 'Alt+Shift+N',
      disabled: shouldShowProjectRequiredState,
      handler: openCreateDialog,
    },
  ], [openCreateDialog, shouldShowProjectRequiredState, t]);

  useRegisterCreateActions('locations-page', createActions);

  useEffect(() => {
    if (shouldShowProjectRequiredState || dialogOpen) {
      return;
    }
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get('create') !== 'true') {
      return;
    }

    openCreateDialog();
    searchParams.delete('create');
    const nextSearch = searchParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true },
    );
  }, [dialogOpen, location.pathname, location.search, navigate, openCreateDialog, shouldShowProjectRequiredState]);

  const openEditDialog = (location: Location): void => {
    setEditingLocation(location);
    setFormState(toFormState(location));
    setFormError('');
    setFormErrorField(null);
    setDialogOpen(true);
  };

  const closeDialog = (): void => {
    setDialogOpen(false);
    setEditingLocation(null);
    setFormState(emptyForm);
    setFormError('');
    setFormErrorField(null);
  };

  const validateForm = (): { latitude: number | null; longitude: number | null } | null => {
    if (!formState.name.trim()) {
      setFormError(t('locations:validation.nameRequired'));
      setFormErrorField('name');
      return null;
    }

    if (!formState.coordinates.trim()) {
      setFormError('');
      setFormErrorField(null);
      return { latitude: null, longitude: null };
    }

    const parsedCoordinates = parseCoordinatesInput(formState.coordinates);
    if (!parsedCoordinates) {
      setFormError(t('locations:validation.coordinateFormat'));
      setFormErrorField('coordinates');
      return null;
    }

    const { latitude, longitude } = parsedCoordinates;
    if (!validateCoordinateRange(latitude, -90, 90)) {
      setFormError(t('locations:validation.latitudeRange'));
      setFormErrorField('coordinates');
      return null;
    }
    if (!validateCoordinateRange(longitude, -180, 180)) {
      setFormError(t('locations:validation.longitudeRange'));
      setFormErrorField('coordinates');
      return null;
    }
    setFormError('');
    setFormErrorField(null);
    return { latitude, longitude };
  };

  const saveLocation = async (): Promise<void> => {
    const parsed = validateForm();
    if (!parsed) return;
    const payload: Location = {
      name: formState.name.trim(),
      latitude: parsed.latitude ?? undefined,
      longitude: parsed.longitude ?? undefined,
      address: formState.address.trim(),
      description: formState.description.trim(),
      soil_type: formState.soil_type || null,
      exposure: formState.exposure || null,
      notes: formState.notes.trim(),
    };

    try {
      if (editingLocation?.id) {
        await locationAPI.update(editingLocation.id, payload);
      } else {
        await locationAPI.create(payload);
      }
      closeDialog();
      await loadData();
    } catch {
      setFormError(t('locations:errors.save'));
      setFormErrorField(null);
    }
  };

  const deleteLocation = async (locationId: number): Promise<void> => {
    if (!confirmAction(t('locations:confirmDelete'))) return;
    try {
      await locationAPI.delete(locationId);
      await loadData();
    } catch {
      setError(t('locations:errors.delete'));
    }
  };

  return (
    <PageContainer>
      <Box sx={{ width: '100%', mx: 'auto' }}>

        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        {loading ? <Typography>{t('common:messages.loading')}</Typography> : null}
        {!loading && shouldShowProjectRequiredState && missingProjectReason ? (
          <ProjectRequiredState reason={missingProjectReason} />
        ) : null}

        {!loading && !shouldShowProjectRequiredState && locations.length === 0 ? (
          <EmptyStateCard
            title={t('locations:emptyState.title')}
            description={t('locations:emptyState.description')}
            actions={[{ label: t('locations:addButton'), onClick: openCreateDialog }]}
          />
        ) : (
          !shouldShowProjectRequiredState && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 360px))',
              gap: 2,
              alignItems: 'stretch',
              width: '100%',
              justifyContent: 'center',
            }}
          >
            {locations.map((location) => {
              const hasCoordinates =
                typeof location.latitude === 'number' && typeof location.longitude === 'number';
              const mapLink = hasCoordinates
                ? `https://www.google.com/maps?q=${location.latitude},${location.longitude}`
                : null;

              return (
                <Box
                  key={location.id}
                  sx={{
                    width: '100%',
                    height: '100%',
                  }}
                >
                  <Card
                    variant="outlined"
                    sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
                  >
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Typography variant="h6" sx={{ mb: 1, }} >{location.name}</Typography>

                      <Stack spacing={1}>
                        <Typography variant="body2">
                          <strong>{t('locations:columns.coordinates')}:</strong>{' '}
                          {hasCoordinates && mapLink ? (
                            <Link href={mapLink} target="_blank" rel="noreferrer" underline="hover">
                              {`${formatCoordinate(location.latitude!, numberLocale)}; ${formatCoordinate(location.longitude!, numberLocale)}`}
                            </Link>
                          ) : '—'}
                        </Typography>
                        <Typography variant="body2"><strong>{t('locations:columns.address')}:</strong> {location.address || '—'}</Typography>
                        <Typography variant="body2"><strong>{t('locations:columns.soilType')}:</strong> {location.soil_type ? t(`locations:soilType.${location.soil_type}`) : '—'}</Typography>
                        <Typography variant="body2"><strong>{t('locations:columns.exposure')}:</strong> {location.exposure ? t(`locations:exposure.${location.exposure}`) : '—'}</Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          <strong>{t('locations:columns.description')}:</strong> {location.description || '—'}
                        </Typography>
                      </Stack>

                    </CardContent>
                    <CardActions sx={{ justifyContent: 'flex-end', mt: 'auto' }}>
                      <Button size="small" startIcon={<EditOutlinedIcon />} onClick={() => openEditDialog(location)}>
                        {t('common:actions.edit')}
                      </Button>
                      {location.id ? (
                        <Button
                          color="error"
                          size="small"
                          startIcon={<DeleteOutlineIcon />}
                          onClick={() => void deleteLocation(location.id!)}
                        >
                          {t('common:actions.delete')}
                        </Button>
                      ) : null}
                    </CardActions>
                  </Card>
                </Box>
              );
            })}
          </Box>
          )
        )}
      </Box>

      <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>
          {editingLocation ? t('locations:editTitle') : t('locations:addButton')}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            autoFocus
            required
            label={t('common:fields.name')}
            value={formState.name}
            onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
            error={formErrorField === 'name'}
            helperText={formErrorField === 'name' ? formError : ' '}
            sx={wideFieldSx}
          />
          <TextField
            label={t('locations:columns.coordinates')}
            value={formState.coordinates}
            onChange={(event) => setFormState((prev) => ({ ...prev, coordinates: event.target.value }))}
            placeholder={t('locations:placeholders.coordinates')}
            error={formErrorField === 'coordinates'}
            helperText={formErrorField === 'coordinates' ? formError : t('locations:helpers.coordinatesExample')}
            sx={mediumFieldSx}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          <TextField
            label={t('locations:columns.address')}
            value={formState.address}
            onChange={(event) => setFormState((prev) => ({ ...prev, address: event.target.value }))}
            sx={wideFieldSx}
          />
          <TextField
            label={t('locations:columns.description')}
            value={formState.description}
            onChange={(event) => setFormState((prev) => ({ ...prev, description: event.target.value }))}
            multiline
            minRows={2}
            sx={fullWidthFieldSx}
          />
          <Box sx={formRowSx}>
            <TextField
              select
              label={t('locations:columns.soilType')}
              value={formState.soil_type}
              onChange={(event) => setFormState((prev) => ({ ...prev, soil_type: event.target.value as SoilType | '' }))}
              helperText={t('locations:helpers.optionalField')}
              sx={smallFieldSx}
            >
              <MenuItem value="">{t('common:messages.noData')}</MenuItem>
              {SOIL_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {t(`locations:soilType.${option.labelKey}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('locations:columns.exposure')}
              value={formState.exposure}
              onChange={(event) => setFormState((prev) => ({ ...prev, exposure: event.target.value as Exposure | '' }))}
              helperText={t('locations:helpers.optionalField')}
              sx={smallFieldSx}
            >
              <MenuItem value="">{t('common:messages.noData')}</MenuItem>
              {EXPOSURE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {t(`locations:exposure.${option.labelKey}`)}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <TextField
            label={t('common:fields.notes')}
            value={formState.notes}
            onChange={(event) => setFormState((prev) => ({ ...prev, notes: event.target.value }))}
            multiline
            minRows={3}
            sx={fullWidthFieldSx}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>{t('common:actions.cancel')}</Button>
          <Button variant="contained" onClick={() => void saveLocation()}>{t('common:actions.save')}</Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}

export default Locations;
