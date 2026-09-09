import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  List,
  ListSubheader,
  ListItemButton,
  TextField,
  Typography,
  Box,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from '../i18n';
import type { CommandSpec } from './types';
import { addGroupOffsets, filterCommands } from './commandPaletteUtils';

interface CommandPaletteProps {
  open: boolean;
  commands: CommandSpec[];
  onClose: () => void;
}

interface GroupedCommands {
  group: string;
  commands: CommandSpec[];
}

function groupCommands(commands: CommandSpec[]): GroupedCommands[] {
  const grouped = new Map<string, CommandSpec[]>();
  commands.forEach((command) => {
    const existing = grouped.get(command.group) ?? [];
    grouped.set(command.group, [...existing, command]);
  });

  return Array.from(grouped.entries()).map(([group, groupCommands]) => ({ group, commands: groupCommands }));
}

export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const { t } = useTranslation('navigation');
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredCommands = useMemo(() => filterCommands(commands, query), [commands, query]);
  const groupedCommands = useMemo(() => groupCommands(filteredCommands), [filteredCommands]);
  const groupedWithOffsets = useMemo(() => addGroupOffsets(groupedCommands), [groupedCommands]);
  // Grouping reorders commands (all "navigation"-group items together, etc.),
  // so a flatIndex from groupedWithOffsets does NOT line up with the same
  // index in filteredCommands whenever a group's members aren't contiguous
  // there. Execution and bounds-checks must use this visual order instead.
  const orderedCommands = useMemo(
    () => groupedWithOffsets.flatMap((group) => group.commands),
    [groupedWithOffsets],
  );

  useEffect(() => {
    if (!open) {
      queueMicrotask(() => {
        setQuery('');
        setSelectedIndex(0);
      });
      return;
    }

    queueMicrotask(() => {
      setSelectedIndex(0);
    });
  }, [open]);

  useEffect(() => {
    if (selectedIndex > Math.max(orderedCommands.length - 1, 0)) {
      queueMicrotask(() => {
        setSelectedIndex(0);
      });
    }
  }, [orderedCommands.length, selectedIndex]);

  const runCommand = (index: number) => {
    const command = orderedCommands[index];
    if (!command) {
      return;
    }

    void command.action();
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((current) => Math.min(current + 1, Math.max(orderedCommands.length - 1, 0)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      runCommand(selectedIndex);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{
        backdrop: {
          sx: { backgroundColor: (theme) => alpha(theme.palette.common.black, 0.22) },
        },

        transition: { onEntered: () => { inputRef.current?.focus(); } }
      }}>
      <DialogContent>
        <TextField
          autoFocus
          inputRef={inputRef}
          fullWidth
          label={t('commandPalette.label')}
          placeholder={t('commandPalette.placeholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label={t('commandPalette.label')}
          sx={{ mb: 2 }}
        />
        {filteredCommands.length === 0 ? (
          <Box sx={{ py: 2 }}>
            <Typography color="text.secondary">{t('commandPalette.emptyTitle')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t('commandPalette.emptyDescription')}
            </Typography>
          </Box>
        ) : (
          <List>
            {groupedWithOffsets.map((group) => (
              <li key={group.group}>
                <ul style={{ padding: 0 }}>
                  <ListSubheader disableSticky sx={{ px: 0, bgcolor: 'transparent', lineHeight: 2.5 }}>
                    {t(`commandGroups.${group.group}`)}
                  </ListSubheader>
                  {group.commands.map((command, indexInGroup) => {
                    const flatIndex = group.startIndex + indexInGroup;
                    return (
                      <ListItemButton
                        key={command.id}
                        selected={selectedIndex === flatIndex}
                        onClick={() => runCommand(flatIndex)}
                        sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, borderRadius: 1 }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography noWrap>{command.label}</Typography>
                        </Box>
                        {command.shortcutHint ? (
                          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                            {command.shortcutHint}
                          </Typography>
                        ) : null}
                      </ListItemButton>
                    );
                  })}
                </ul>
              </li>
            ))}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
}
