import AddIcon from '@mui/icons-material/Add';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteIcon from '@mui/icons-material/Delete';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import EditIcon from '@mui/icons-material/Edit';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import NoteAltIcon from '@mui/icons-material/NoteAlt';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import PublicIcon from '@mui/icons-material/Public';
import RemoveIcon from '@mui/icons-material/Remove';
import RoomOutlinedIcon from '@mui/icons-material/RoomOutlined';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import TabIcon from '@mui/icons-material/Tab';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Popover,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme, type Theme } from '@mui/material/styles';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement } from 'react';
import { useTranslation } from '../../i18n';
import HelpIconRow from './HelpIconRow';
import { HierarchyAddIcon } from '../hierarchy/HierarchyAddIcon';
import { AppTooltip } from '../AppTooltip';

export type HelpPageKey =
  | 'dashboard'
  | 'calendar'
  | 'yieldOverview'
  | 'locations'
  | 'fields'
  | 'beds'
  | 'areas'
  | 'crops'
  | 'cropLibrary'
  | 'plantingPlans'
  | 'seedDemand'
  | 'suppliers'
  | 'graphical';

interface PageHelpProps {
  pageKey: HelpPageKey;
  ariaLabel?: string;
  tooltip?: string;
}

interface HelpSection {
  title: string;
  points: string[];
}

interface SymbolDefinition {
  key: string;
  icon: ReactElement;
}

const PAGE_SYMBOL_DEFINITIONS: Partial<Record<HelpPageKey, SymbolDefinition[]>> = {
  locations: [
    { key: 'add', icon: <AddIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
    { key: 'edit', icon: <EditOutlinedIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
    { key: 'delete', icon: <DeleteOutlineIcon fontSize="small" sx={{ color: 'error.main' }} /> },
    { key: 'map', icon: <RoomOutlinedIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
  ],
  areas: [
    { key: 'add', icon: <AddIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
    { key: 'createPlan', icon: <AgricultureIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
    {
      key: 'expandToggle',
      icon: (
        <Stack direction="row" spacing={0.1} sx={{ alignItems: "center", }} >
          <ChevronRightIcon fontSize="small" />
          <ExpandMoreIcon fontSize="small" />
        </Stack>
      ),
    },
    {
      key: 'dimensions',
      icon: (
        <Stack direction="row" spacing={0.25} sx={{ alignItems: "center", }} >
          <SwapVertIcon fontSize="small" />
          <SwapHorizIcon fontSize="small" />
        </Stack>
      ),
    },
    { key: 'delete', icon: <DeleteIcon fontSize="small" sx={{ color: 'error.main' }} /> },
  ],
  crops: [
    { key: 'add', icon: <AddIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
    { key: 'library', icon: <PublicIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
    { key: 'createPlan', icon: <AgricultureIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
    { key: 'edit', icon: <EditIcon fontSize="small" sx={{ color: (theme: Theme) => alpha(theme.palette.primary.main, 0.86) }} /> },
    { key: 'more', icon: <MoreVertIcon fontSize="small" sx={{ color: 'text.secondary' }} /> },
  ],
  plantingPlans: [
    { key: 'add', icon: <AddIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
    { key: 'mobileAdd', icon: <AddIcon fontSize="small" sx={{ color: 'primary.main', bgcolor: 'action.hover', borderRadius: '50%' }} /> },
    { key: 'edit', icon: <EditIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
    { key: 'notes', icon: <NoteAltIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
  ],
  calendar: [
    { key: 'tabs', icon: <TabIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
    { key: 'tooltip', icon: <InfoOutlinedIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
  ],
  seedDemand: [
    { key: 'supplierSelect', icon: <ArrowDropDownIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
    { key: 'packageInfo', icon: <OpenInFullIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
  ],
  suppliers: [
    { key: 'add', icon: <AddIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
    { key: 'edit', icon: <EditIcon fontSize="small" sx={{ color: 'primary.main' }} /> },
    { key: 'delete', icon: <DeleteIcon fontSize="small" sx={{ color: 'error.main' }} /> },
  ],
  graphical: [
    {
      key: 'panArrows',
      icon: (
        <Stack direction="row" spacing={0.25} sx={{ alignItems: "center", }} >
          <KeyboardArrowUpIcon fontSize="small" />
          <KeyboardArrowLeftIcon fontSize="small" />
          <KeyboardArrowRightIcon fontSize="small" />
          <KeyboardArrowDownIcon fontSize="small" />
        </Stack>
      ),
    },
    { key: 'zoomIn', icon: <AddIcon fontSize="small" /> },
    { key: 'zoomOut', icon: <RemoveIcon fontSize="small" /> },
    { key: 'fit', icon: <FitScreenIcon fontSize="small" /> },
    { key: 'fullscreen', icon: <FullscreenIcon fontSize="small" /> },
    { key: 'editToggle', icon: <EditOutlinedIcon fontSize="small" sx={{ color: 'success.dark' }} /> },
  ],
};

/**
 * Displays the page-specific help content for the given page key.
 *
 * @remarks
 * Used in page headers to keep the previous contextual help texts available.
 *
 * @param props - Component properties.
 * @param props.pageKey - The help page key to render.
 * @returns JSX element with the page help entry point and content.
 */
export default function PageHelp({ pageKey, ariaLabel, tooltip }: PageHelpProps): ReactElement | null {
  const { t, i18n } = useTranslation('help');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const hasI18nKey = useCallback(
    (key: string): boolean => (typeof i18n?.exists === 'function' ? i18n.exists(key) : false),
    [i18n],
  );

  const points = useMemo(() => {
    if (!hasI18nKey(`help:pages.${pageKey}.points`)) {
      return [];
    }
    const translated = t(`pages.${pageKey}.points`, { returnObjects: true });
    if (!Array.isArray(translated)) {
      return [];
    }
    return translated.map((point) => String(point));
  }, [hasI18nKey, pageKey, t]);

  const intro = t(`pages.${pageKey}.intro`, { defaultValue: '' });

  const sections = useMemo(() => {
    if (!hasI18nKey(`help:pages.${pageKey}.sections`)) {
      return null;
    }
    const translated = t(`pages.${pageKey}.sections`, { returnObjects: true });
    if (!Array.isArray(translated)) {
      return null;
    }
    return translated
      .map((section) => {
        if (!section || typeof section !== 'object') {
          return null;
        }
        const item = section as { title?: unknown; points?: unknown };
        if (typeof item.title !== 'string') {
          return null;
        }
        const sectionPoints = Array.isArray(item.points)
          ? item.points.map((point) => String(point))
          : [];
        return { title: item.title, points: sectionPoints } as HelpSection;
      })
      .filter((section): section is HelpSection => section !== null);
  }, [hasI18nKey, pageKey, t]);

  const title = t(`pages.${pageKey}.title`);
  const symbolsTitle = t(`pages.${pageKey}.symbolsTitle`, { defaultValue: '' });
  const symbolRows = useMemo(() => {
    const symbolDefinitions = PAGE_SYMBOL_DEFINITIONS[pageKey];
    if (!symbolDefinitions || symbolDefinitions.length === 0) {
      return [];
    }

    return symbolDefinitions
      .map((definition) => {
        if (!hasI18nKey(`help:pages.${pageKey}.symbols.${definition.key}`)) {
          return null;
        }
        const translated = t(`pages.${pageKey}.symbols.${definition.key}`);
        if (!translated) {
          return null;
        }
        return { icon: definition.icon, text: translated };
      })
      .filter((item): item is { icon: ReactElement; text: string } => item !== null);
  }, [hasI18nKey, pageKey, t]);

  const handleOpen = (event: MouseEvent<HTMLElement>): void => {
    if (isMobile) {
      setMobileOpen(true);
      return;
    }
    setAnchorEl(event.currentTarget);
  };

  const handleClose = (): void => {
    setAnchorEl(null);
    setMobileOpen(false);
  };

  const renderHelpTextContent = (text: string): ReactElement | string => {
    const tokens = text.split(/({{addIcon}}|{{moreIcon}}|{{createPlanIcon}})/);
    if (tokens.length === 1) {
      return text;
    }

    return (
      <>
        {tokens.map((token, index) => {
          if (token === '{{addIcon}}') {
            return (
              <HierarchyAddIcon
                key={`${token}-${index}`}
                interactive={false}
                ariaHidden
                sx={{
                  mx: 0.25,
                  verticalAlign: 'text-bottom',
                }}
              />
            );
          }
          if (token === '{{moreIcon}}') {
            return (
              <MoreVertIcon
                key={`${token}-${index}`}
                aria-hidden
                fontSize="small"
                sx={{
                  mx: 0.25,
                  color: 'text.secondary',
                  verticalAlign: 'text-bottom',
                }}
              />
            );
          }
          if (token === '{{createPlanIcon}}') {
            return (
              <AgricultureIcon
                key={`${token}-${index}`}
                aria-hidden
                fontSize="small"
                sx={{
                  mx: 0.25,
                  color: 'primary.main',
                  verticalAlign: 'text-bottom',
                }}
              />
            );
          }
          return token;
        })}
      </>
    );
  };

  const renderIntro = (): ReactElement | null => {
    if (!intro) {
      return null;
    }

    return (
      <Stack spacing={1} sx={{ mb: 1.5 }}>
        {intro.split(/\n{2,}/).map((paragraph) => (
          <Typography key={paragraph} variant="body2">
            {renderHelpTextContent(paragraph)}
          </Typography>
        ))}
      </Stack>
    );
  };

  const renderSection = (section: HelpSection, key: string): ReactElement => (
    <Box key={key} sx={{ mb: 1.25 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {section.title}
      </Typography>
      <List dense disablePadding>
        {section.points.map((point, pointIndex) => (
          <ListItem key={`${key}-${pointIndex}`} sx={{ py: 0.15, px: 0 }}>
            <ListItemText
              slotProps={{ primary: { variant: 'body2' } }}
              primary={(
                <>
                  {'• '}
                  {renderHelpTextContent(point)}
                </>
              )}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );

  const renderFallbackPoints = (keyPrefix: string): ReactElement | null => {
    if (points.length === 0) {
      return null;
    }

    return (
      <List dense disablePadding>
        {points.map((point, index) => (
          <ListItem key={`${keyPrefix}-${index}`} sx={{ py: 0.25, px: 0 }}>
            <ListItemText slotProps={{ primary: { variant: 'body2' } }} primary={`• ${point}`} />
          </ListItem>
        ))}
      </List>
    );
  };

  useEffect(() => {
    const handleOpenPageHelp = (): void => {
      if (isMobile) {
        setMobileOpen(true);
        return;
      }
      if (triggerButtonRef.current) {
        setAnchorEl(triggerButtonRef.current);
      }
    };

    window.addEventListener('ofp:open-page-help', handleOpenPageHelp);
    return () => {
      window.removeEventListener('ofp:open-page-help', handleOpenPageHelp);
    };
  }, [isMobile]);

  const renderGraphicalHelpContent = (): ReactElement => (
    <Stack spacing={2}>
      {renderIntro()}
      {sections?.map((section, sectionIndex) => (
        renderSection(section, `${pageKey}-graphical-section-${sectionIndex}`)
      ))}

      <Box>
        <Typography variant="body1" sx={{ fontWeight: 600, mb: 1 }}>
          {t('pages.graphical.symbolsTitle')}
        </Typography>
        <Stack spacing={1}>
          {symbolRows.map((row, index) => (
            <HelpIconRow key={`${pageKey}-symbol-row-${index}`} icon={row.icon} text={row.text} />
          ))}
        </Stack>
      </Box>
    </Stack>
  );

  const renderSymbolsContent = (): ReactElement => (
    <Box>
      <Typography variant="body1" sx={{ fontWeight: 600, mb: 0.75 }}>
        {symbolsTitle}
      </Typography>
      <Stack spacing={1}>
        {symbolRows.map((row, index) => (
          <HelpIconRow key={`${pageKey}-symbol-${index}`} icon={row.icon} text={row.text} />
        ))}
      </Stack>
    </Box>
  );

  return (
    <>
      <AppTooltip title={tooltip ?? t('showTooltip')}>
        <IconButton ref={triggerButtonRef} aria-label={ariaLabel ?? t('showTooltip')} onClick={handleOpen} size={isMobile ? 'medium' : 'small'} sx={{ color: 'text.secondary' }}>
          <HelpOutlineIcon fontSize="small" />
        </IconButton>
      </AppTooltip>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ maxWidth: 720, width: { xs: 1, sm: 680 }, p: 2.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{title}</Typography>
          {pageKey === 'graphical' ? renderGraphicalHelpContent() : sections && sections.length > 0 ? (
            <>
              {renderIntro()}
              {sections.map((section, sectionIndex) => (
                renderSection(section, `${pageKey}-section-${sectionIndex}`)
              ))}
            </>
          ) : null}

          {sections && sections.length > 0 && pageKey !== 'graphical' && symbolRows.length > 0 ? (
            <Box sx={{ mt: 1.5 }}>
              {renderSymbolsContent()}
            </Box>
          ) : (
            pageKey !== 'graphical' && (!sections || sections.length === 0) ? (
              <>
                {renderIntro()}
                {renderFallbackPoints(pageKey)}
              </>
            ) : null
          )}
        </Box>
      </Popover>

      <Dialog
        open={mobileOpen}
        onClose={handleClose}
        fullWidth
        maxWidth="md"
        slotProps={{
          paper: {
              sx: {
              m: 0,
              mt: 'auto',
              borderRadius: '16px 16px 0 0',
              maxHeight: '85vh',
            },
          }
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          {pageKey === 'graphical' ? renderGraphicalHelpContent() : sections && sections.length > 0 ? (
            <>
              {renderIntro()}
              {sections.map((section, sectionIndex) => (
                renderSection(section, `${pageKey}-mobile-section-${sectionIndex}`)
              ))}
            </>
          ) : null}

          {sections && sections.length > 0 && pageKey !== 'graphical' && symbolRows.length > 0 ? (
            <Box sx={{ mt: 1.5 }}>
              {renderSymbolsContent()}
            </Box>
          ) : (
            pageKey !== 'graphical' && (!sections || sections.length === 0) ? (
              <>
                {renderIntro()}
                {renderFallbackPoints(`${pageKey}-mobile`)}
              </>
            ) : null
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
