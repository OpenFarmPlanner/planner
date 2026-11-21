import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
  TextField, useMediaQuery, useTheme,
} from '@mui/material';
import type { Bed, Crop, Field, PlantingPlan, PlantingPlanDetail, Task, TaskWritePayload } from '../../api/types';
import { projectAPI, type ProjectMemberPayload } from '../../api/api';
import { useTranslation } from '../../i18n';
import { resolveLocaleFromLanguage } from '../../utils/numberLocalization';
import { formatCropDisplayName } from '../../crops/cropDisplay';
import { formGridSx, formGridFieldSx, formGridFullRowSx } from '../forms/formLayout';
import LoadRetryButton from '../LoadRetryButton';
import { taskDisplayTitle } from './taskTitles';
import { BOARD_STATUSES } from './taskBoard';

type TaskContext = {
  planContext: { plan: PlantingPlanDetail; projectId: number; seasonLabel: string };
  task: null;
} | {
  planContext?: never;
  task: Task | null;
  initialPlan?: PlantingPlan;
  seasonId: number | undefined;
  crops: Crop[];
  fields: Field[];
  beds: Bed[];
  plans: PlantingPlan[];
  members: ProjectMemberPayload[];
};

type Props = TaskContext & {
  onSave: (payload: TaskWritePayload) => Promise<void>;
  onClose: () => void;
};

function planLabel(plan: PlantingPlan, locale: string) {
  return [formatCropDisplayName(plan), plan.bed_name, plan.planting_date
    ? new Date(`${plan.planting_date}T00:00:00`).toLocaleDateString(locale) : null].filter(Boolean).join(' · ');
}

export default function TaskFormDialog(props: Props) {
  const { task, planContext, onSave, onClose } = props;
  const { t, i18n } = useTranslation(['dashboard', 'common', 'crops', 'plantingPlans', 'projectInvitations']);
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const titleId = useId();
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage);
  const initialPlan = planContext ? planContext.plan : props.initialPlan;
  const initialCrop = planContext && !planContext.plan.crop_available ? null : initialPlan?.crop ?? null;
  const seasonId = planContext ? planContext.plan.season ?? undefined : props.seasonId;
  const projectId = planContext?.projectId;
  const [projectMembers, setProjectMembers] = useState<ProjectMemberPayload[] | null>();
  const [memberAttempt, setMemberAttempt] = useState(0);
  const members = planContext ? projectMembers : props.members;
  useEffect(() => {
    if (projectId === undefined) return;
    const controller = new AbortController();
    void projectAPI.listMembers(projectId, controller.signal).then(({ data }) => {
      if (!controller.signal.aborted) setProjectMembers(data);
    }).catch(() => {
      if (!controller.signal.aborted) setProjectMembers(null);
    });
    return () => controller.abort();
  }, [projectId, memberAttempt]);

  const [initialTitle] = useState(() => task ? taskDisplayTitle(task, t) : '');
  const [draft, setDraft] = useState<TaskWritePayload>(() => ({
    title: initialTitle, description: task?.description ?? '', due_date: task?.due_date ?? null,
    status: task?.status ?? 'pending', planting_plan: task?.planting_plan ?? initialPlan?.id ?? null,
    crop: task?.crop ?? initialCrop,
    field: task?.field ?? (planContext ? null : props.beds.find((bed) =>
      bed.id === props.plans.find((plan) => plan.id === task?.planting_plan)?.bed)?.field) ?? null,
    assigned_to: task?.assigned_to ?? null,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const savingRef = useRef(false);
  const selectedPlan = planContext ? planContext.plan : props.plans.find((plan) => plan.id === draft.planting_plan);
  const planField = planContext ? undefined : props.beds.find((bed) => bed.id === selectedPlan?.bed)?.field;
  const close = () => { if (!savingRef.current) onClose(); };
  const update = (key: keyof TaskWritePayload, value: string | number | null) => setDraft((previous) => ({ ...previous, [key]: value }));
  const selectId = (value: string) => value === '' ? null : Number(value);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || !draft.title.trim() || draft.title.trim().length > 200) return;
    savingRef.current = true;
    setSaving(true);
    setError(false);
    const payload = { ...draft, title: draft.title.trim() };
    // A linked plan owns the location: storing its field would go stale when the bed moves.
    if (payload.planting_plan !== null) payload.field = null;
    if (task?.source_key) {
      delete payload.planting_plan;
      delete payload.crop;
      delete payload.season;
    }
    if (!task) payload.season = seasonId;
    if (task && draft.title === initialTitle) payload.title = task.title;
    // Merely editing a generated task must not mark its unchanged date as overridden.
    if (task && payload.due_date === task.due_date) delete payload.due_date;
    try {
      await onSave(payload);
      onClose();
    } catch {
      setError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return <Dialog open fullScreen={compact} fullWidth maxWidth="md" onClose={close} aria-labelledby={titleId}>
    <Box component="form" onSubmit={(event) => { void submit(event); }} sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <DialogTitle id={titleId}>{t(task ? 'dashboard:form.edit' : 'dashboard:form.add')}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Box sx={formGridSx}>
          <TextField autoFocus required label={t('dashboard:form.title')} value={draft.title} disabled={saving}
            sx={formGridFullRowSx} margin="dense" slotProps={{ htmlInput: { maxLength: 200 } }}
            onChange={(event) => update('title', event.target.value)} />
          <TextField multiline minRows={3} label={t('dashboard:form.description')} value={draft.description}
            disabled={saving} sx={formGridFullRowSx} onChange={(event) => update('description', event.target.value)} />
          <TextField type="date" label={t('dashboard:form.date')} value={draft.due_date ?? ''} disabled={saving}
            sx={formGridFieldSx} slotProps={{ inputLabel: { shrink: true } }}
            onChange={(event) => update('due_date', event.target.value || null)} />
          <TextField select label={t('dashboard:form.status')} value={draft.status} disabled={saving}
            sx={formGridFieldSx} onChange={(event) => update('status', event.target.value)}>
            {BOARD_STATUSES.map((status) => <MenuItem key={status} value={status}>{t(`dashboard:board.status.${status}`)}</MenuItem>)}
          </TextField>
          {task && <TextField label={t('dashboard:form.origin')} value={t(`dashboard:board.origin.${task.origin}`)}
            disabled sx={formGridFieldSx} />}
          <TextField select label={t('dashboard:board.filters.person')} value={draft.assigned_to ?? ''} disabled={saving || !members}
            helperText={members === undefined ? t('common:messages.loading') : undefined}
            sx={formGridFieldSx} onChange={(event) => update('assigned_to', selectId(event.target.value))}>
            <MenuItem value="">{t('dashboard:board.unassigned')}</MenuItem>
            {members?.map((member) => <MenuItem key={member.user} value={member.user}>{member.user_display_name || member.user_email}</MenuItem>)}
          </TextField>
          {members === null && <Alert severity="error" sx={formGridFullRowSx} action={<LoadRetryButton disabled={saving} onClick={() => {
            setProjectMembers(undefined);
            setMemberAttempt(value => value + 1);
          }} />}>{t('projectInvitations:memberListLoadFailed')}</Alert>}
          {planContext ? <>
            <TextField multiline label={t('crops:history.objectTypes.plantingPlan')} value={planLabel(planContext.plan, locale)}
              sx={formGridFullRowSx} slotProps={{ input: { readOnly: true } }} />
            <TextField multiline label={t('plantingPlans:details.season')} value={planContext.seasonLabel}
              sx={formGridFieldSx} slotProps={{ input: { readOnly: true } }} />
            <TextField multiline label={t('dashboard:board.filters.crop')} value={formatCropDisplayName(planContext.plan) || t('dashboard:form.none')}
              sx={formGridFieldSx} slotProps={{ input: { readOnly: true } }} />
            <TextField multiline label={t('dashboard:board.filters.field')} value={planContext.plan.field_name || t('dashboard:form.none')}
              sx={formGridFieldSx} slotProps={{ input: { readOnly: true } }} />
          </> : <>
            <TextField select label={t('dashboard:form.plan')} value={draft.planting_plan ?? ''} disabled={saving || Boolean(task?.source_key)}
              sx={formGridFullRowSx} onChange={(event) => {
                const id = selectId(event.target.value);
                const plan = props.plans.find((row) => row.id === id);
                const bed = props.beds.find((row) => row.id === plan?.bed);
                setDraft((previous) => ({ ...previous, planting_plan: id,
                  ...(plan ? { crop: plan.crop, field: bed?.field ?? null } : {}),
                }));
              }}>
              <MenuItem value="">{t('dashboard:form.none')}</MenuItem>
              {props.plans.map((plan) => <MenuItem key={plan.id} value={plan.id}>{planLabel(plan, locale)}</MenuItem>)}
            </TextField>
            <TextField select label={t('dashboard:board.filters.crop')} value={draft.crop ?? ''}
              disabled={saving || Boolean(selectedPlan) || Boolean(task?.source_key)} sx={formGridFieldSx}
              onChange={(event) => update('crop', selectId(event.target.value))}>
              <MenuItem value="">{t('dashboard:form.none')}</MenuItem>
              {props.crops.map((crop) => <MenuItem key={crop.id} value={crop.id}>{formatCropDisplayName(crop)}</MenuItem>)}
            </TextField>
            <TextField select label={t('dashboard:board.filters.field')} value={selectedPlan ? planField ?? '' : draft.field ?? ''}
              disabled={saving || Boolean(selectedPlan) || Boolean(task?.source_key)} sx={formGridFieldSx}
              onChange={(event) => update('field', selectId(event.target.value))}>
              <MenuItem value="">{t('dashboard:form.none')}</MenuItem>
              {props.fields.map((field) => <MenuItem key={field.id} value={field.id}>{field.name}</MenuItem>)}
            </TextField>
          </>}
        </Box>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{t('dashboard:form.saveError')}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={close}>{t('common:actions.cancel')}</Button>
        <Button type="submit" variant="contained" disabled={saving || !draft.title.trim()}>{t('common:actions.save')}</Button>
      </DialogActions>
    </Box>
  </Dialog>;
}
