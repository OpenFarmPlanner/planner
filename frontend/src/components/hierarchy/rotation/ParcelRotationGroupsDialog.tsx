import { useContext, useRef, useState, type DragEvent } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  MenuItem, Stack, TextField, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloseIcon from '@mui/icons-material/Close';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { parcelRotationAPI } from '../../../api/api';
import type { Bed, Field, ParcelRotationConfiguration, ParcelRotationGroup } from '../../../api/types';
import { useTranslation } from '../../../i18n';
import { formatParcelRotationMembership, ParcelRotationContext } from './parcelRotationContext';

type Member = ParcelRotationConfiguration['parcels'][number];

function move<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function ParcelRotationBadge({ fieldId }: { fieldId: number }) {
  const membership = useContext(ParcelRotationContext).memberships.get(fieldId);
  const { t } = useTranslation('hierarchy');
  if (!membership) return null;
  const label = t('parcelRotation.membership', { ...membership });
  return (
    <Box component="span" role="img" aria-label={label}
      sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        display: 'inline-block', maxWidth: 110, flexShrink: 0,
        px: 0.75, borderRadius: 0.75, bgcolor: 'action.selected', color: 'text.secondary',
        typography: 'caption', ml: 0.75 }} title={label}>
      {formatParcelRotationMembership(membership)}
    </Box>
  );
}

interface Props {
  groups: readonly ParcelRotationGroup[];
  fields: readonly Field[];
  beds: readonly Bed[];
  parcelId?: number;
  onClose: () => void;
  onChanged: () => void;
}

export function ParcelRotationGroupsDialog({ groups, fields, beds, parcelId, onClose, onChanged }: Props) {
  const { t } = useTranslation(['hierarchy', 'common']);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const initialGroup = groups.find(group => group.parcels.some(parcel => parcel.id === parcelId));
  const [groupId, setGroupId] = useState<number | ''>(initialGroup?.id ?? '');
  const [name, setName] = useState(initialGroup?.name ?? '');
  const defaultMember = (id: number): Member => ({
    id, bed_ids: beds.flatMap(bed => bed.field === id && (bed.id ?? 0) > 0 ? [bed.id!] : []),
  });
  const toMembers = (group: ParcelRotationGroup): Member[] =>
    group.parcels.map(parcel => ({ id: parcel.id, bed_ids: parcel.beds.map(bed => bed.id) }));
  const [members, setMembers] = useState<Member[]>(() => initialGroup ? toMembers(initialGroup)
    : parcelId === undefined ? [] : [defaultMember(parcelId)]);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const dragStart = useRef<number | null>(null);
  const active = useRef(false);
  const fieldById = new Map(fields.map(field => [field.id, field]));
  const bedById = new Map(beds.map(bed => [bed.id, bed]));
  const names = members.map(member => fieldById.get(member.id)?.name ?? groups.flatMap(group => group.parcels)
    .find(parcel => parcel.id === member.id)?.name ?? '');
  const countMatches = new Set(members.map(member => member.bed_ids.length)).size <= 1;
  const available = fields.filter(field => (field.id ?? 0) > 0
    && !members.some(member => member.id === field.id)
    && !groups.some(group => group.id !== groupId && group.parcels.some(parcel => parcel.id === field.id)));

  const selectGroup = (id: number | '') => {
    const current = groups.find(group => group.id === id);
    setGroupId(id);
    setName(current?.name ?? '');
    setMembers(current ? toMembers(current) : []);
    setConfirmDelete(false);
    setError('');
  };

  const save = async (remove = false) => {
    if (active.current) return;
    active.current = true;
    setSaving(true);
    setError('');
    try {
      if (remove && groupId !== '') await parcelRotationAPI.remove(groupId);
      else if (groupId !== '') await parcelRotationAPI.update(groupId, { name: name.trim(), parcels: members });
      else await parcelRotationAPI.create({ name: name.trim(), parcels: members });
      onChanged();
      onClose();
    } catch {
      setError(t('parcelRotation.saveError'));
    } finally {
      active.current = false;
      setSaving(false);
    }
  };

  const reorderParcel = (from: number, to: number) => {
    if (from !== to && to >= 0 && to < members.length) setMembers(current => move(current, from, to));
  };

  const dropParcel = (event: DragEvent, to: number) => {
    event.preventDefault();
    if (!saving && dragStart.current !== null) reorderParcel(dragStart.current, to);
    dragStart.current = null;
  };

  const reorderBed = (memberId: number, from: number, to: number) => {
    setMembers(current => current.map(member => member.id === memberId
      ? { ...member, bed_ids: move(member.bed_ids, from, to) } : member));
  };

  return (
    <Dialog open fullWidth fullScreen={fullScreen} maxWidth="sm" onClose={saving ? undefined : onClose}
      aria-labelledby="parcel-rotation-dialog-title">
      <DialogTitle id="parcel-rotation-dialog-title">{t('parcelRotation.manage')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1, overflowWrap: 'anywhere' }}>
          {groups.length > 0 && (
            <TextField select fullWidth label={t('parcelRotation.group')} value={groupId}
              disabled={saving} onChange={event => selectGroup(event.target.value === '' ? '' : Number(event.target.value))}>
              <MenuItem value="">{t('parcelRotation.newGroup')}</MenuItem>
              {groups.map(group => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>)}
            </TextField>
          )}
          <TextField required fullWidth label={t('parcelRotation.name')} value={name}
            slotProps={{ htmlInput: { maxLength: 200 } }} disabled={saving}
            onChange={event => setName(event.target.value)} />
          <TextField select fullWidth label={t('parcelRotation.addParcel')} value=""
            disabled={saving || available.length === 0} onChange={event => {
              setMembers(current => [...current, defaultMember(Number(event.target.value))]);
            }}>
            {available.map(field => <MenuItem key={field.id} value={field.id}>{field.name}</MenuItem>)}
          </TextField>
          {members.length > 0 && (
            <Stack component="ol" aria-label={t('parcelRotation.parcelOrder')} spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
              {members.map((member, index) => (
                <Box component="li" key={member.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, pl: 1, pr: 0.25 }}
                    onDragOver={event => event.preventDefault()} onDrop={event => dropParcel(event, index)}>
                    <Box draggable={!saving} sx={{ display: { xs: 'none', sm: 'flex' }, cursor: 'grab' }}
                      onDragStart={event => {
                        dragStart.current = index;
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', String(member.id));
                      }} onDragEnd={() => { dragStart.current = null; }}>
                      <DragIndicatorIcon fontSize="small" aria-hidden />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{index + 1}. {names[index]}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('parcelRotation.bedCount', { count: member.bed_ids.length })}
                      </Typography>
                    </Box>
                    <IconButton aria-label={t('parcelRotation.moveUp', { item: names[index] })}
                      disabled={saving || index === 0} onClick={() => reorderParcel(index, index - 1)}>
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton aria-label={t('parcelRotation.moveDown', { item: names[index] })}
                      disabled={saving || index === members.length - 1} onClick={() => reorderParcel(index, index + 1)}>
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton aria-label={t('parcelRotation.removeParcel', { item: names[index] })}
                      disabled={saving} onClick={() => setMembers(current => current.filter(item => item.id !== member.id))}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                  {member.bed_ids.length > 0 && (
                    <Box component="details" sx={{ px: 1.5, pb: 1 }}>
                      <Box component="summary" sx={{ cursor: 'pointer', typography: 'body2' }}>{t('parcelRotation.bedOrder')}</Box>
                      <Stack component="ol" sx={{ p: 0, listStyle: 'none' }}>
                        {member.bed_ids.map((id, position) => {
                          const bedName = bedById.get(id)?.name ?? groups.flatMap(group => group.parcels)
                            .flatMap(parcel => parcel.beds).find(bed => bed.id === id)?.name ?? '';
                          return (
                            <Stack direction="row" sx={{ alignItems: 'center' }} component="li" key={id}>
                              <Typography variant="body2" sx={{ flex: 1 }}>{position + 1}. {bedName}</Typography>
                              <IconButton aria-label={t('parcelRotation.moveUp', { item: bedName })}
                                disabled={saving || position === 0} onClick={() => reorderBed(member.id, position, position - 1)}>
                                <ArrowUpwardIcon fontSize="small" />
                              </IconButton>
                              <IconButton aria-label={t('parcelRotation.moveDown', { item: bedName })}
                                disabled={saving || position === member.bed_ids.length - 1}
                                onClick={() => reorderBed(member.id, position, position + 1)}>
                                <ArrowDownwardIcon fontSize="small" />
                              </IconButton>
                            </Stack>
                          );
                        })}
                      </Stack>
                    </Box>
                  )}
                </Box>
              ))}
            </Stack>
          )}
          {!countMatches && <Alert severity="warning">{t('parcelRotation.unequal', {
            group: name, counts: members.map((member, index) => `${names[index]} (${member.bed_ids.length})`).join(', '),
          })}</Alert>}
          {confirmDelete && <Alert severity="warning" action={
            <Button color="inherit" onClick={() => void save(true)} disabled={saving}>{t('common:actions.delete')}</Button>
          }>{t('parcelRotation.deleteConfirm', { group: name })}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap' }}>
        {groupId !== '' && <Button color="error" sx={{ mr: 'auto' }}
          onClick={() => setConfirmDelete(value => !value)} disabled={saving}>{t('parcelRotation.deleteGroup')}</Button>}
        <Button onClick={onClose} disabled={saving}>{t('common:actions.cancel')}</Button>
        <Button variant="contained" disabled={saving || !name.trim() || !members.length || !countMatches}
          onClick={() => void save()}>{t('common:actions.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}
