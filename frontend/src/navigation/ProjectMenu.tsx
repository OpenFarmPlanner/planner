import { Divider, ListItemIcon, Menu, MenuItem, Stack } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import AddIcon from '@mui/icons-material/Add';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutlineOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { ACTION_MENU_ICON_PROPS, ACTION_MENU_ITEM_ICON_SX } from './topbarMenuStyles';

interface ProjectMenuProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  memberships: { project_id: number; project_name: string; role: 'admin' | 'member' }[];
  activeProjectId: number | null;
  isSwitchingProject: boolean;
  isCreatingDemoProject: boolean;
  deletedProjectsCount: number;
  onClose: () => void;
  onSwitchProject: (projectId: number) => Promise<void>;
  onOpenProjectSettings: () => void;
  onOpenProjectSelection: () => void;
  onOpenCreateProject: () => void;
  onCreateDemoProject: () => void;
  onOpenProjectTrash: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function ProjectMenu(props: ProjectMenuProps) {
  const {
    anchorEl,
    open,
    memberships,
    activeProjectId,
    isSwitchingProject,
    isCreatingDemoProject,
    deletedProjectsCount,
    onClose,
    onSwitchProject,
    onOpenProjectSettings,
    onOpenProjectSelection,
    onOpenCreateProject,
    onCreateDemoProject,
    onOpenProjectTrash,
    t,
  } = props;

  return (
    <Menu
      id="project-switcher-menu"
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
    >
      {memberships.length === 0 ? (
        <MenuItem disabled>{t('projectSwitcher.zeroProjects')}</MenuItem>
      ) : (
        memberships.map((membership) => (
          <MenuItem
            key={membership.project_id}
            onClick={() => void onSwitchProject(membership.project_id)}
            selected={membership.project_id === activeProjectId}
            disabled={isSwitchingProject}
          >
            <Stack direction="row" sx={{ width: '100%',
              alignItems: "center", }}  spacing={1} >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{membership.project_name}</span>
              {membership.project_id === activeProjectId ? <CheckIcon fontSize="small" /> : null}
            </Stack>
          </MenuItem>
        ))
      )}
      <Divider />
      <MenuItem onClick={onOpenProjectSelection}>
        <ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><SwapHorizIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>
        {t('project.switch')}
      </MenuItem>
      <MenuItem onClick={onOpenProjectSettings}>
        <ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><SettingsOutlinedIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>
        {t('project.settings')}
      </MenuItem>
      <Divider />
      <MenuItem onClick={onOpenCreateProject}>
        <ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><AddIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>
        {t('project.create')}
      </MenuItem>
      <MenuItem onClick={onCreateDemoProject} disabled={isCreatingDemoProject}>
        <ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><PlayCircleOutlineIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>
        {t('projectSwitcher.loadDemoProject')}
      </MenuItem>
      {deletedProjectsCount > 0 ? (
        <MenuItem onClick={onOpenProjectTrash}>
          <ListItemIcon sx={ACTION_MENU_ITEM_ICON_SX}><DeleteOutlineIcon {...ACTION_MENU_ICON_PROPS} /></ListItemIcon>
          {t('projectSwitcher.trash', { count: deletedProjectsCount })}
        </MenuItem>
      ) : null}
    </Menu>
  );
}
