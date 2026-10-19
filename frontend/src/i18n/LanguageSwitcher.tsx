/**
 * Language switchers for the public pages and for the signed-in app.
 *
 * Accessibility notes that the design has to keep:
 *  - fully keyboard operable (MUI `Menu`/`Select` handle roving focus);
 *  - an explicit accessible name, never icon-only;
 *  - the current value is conveyed as text and via `aria-checked`, not by
 *    colour alone;
 *  - no flags — a flag is a country, not a language;
 *  - 44px minimum touch targets on the menu items;
 *  - focus returns to the trigger after switching, so the page is not lost.
 */

import { useId, useState } from 'react';
import {
  Button,
  FormControl,
  InputLabel,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  type SelectChangeEvent,
  Typography,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import LanguageIcon from '@mui/icons-material/Language';
import CheckIcon from '@mui/icons-material/Check';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router';

import {
  AUTO_LANGUAGE,
  FALLBACK_LANGUAGE,
  SUPPORTED_LANGUAGES,
  type LanguagePreference,
  type SupportedLanguage,
  getLanguageLabel,
  normalizeLanguageTag,
} from './languages';
import { useLanguagePreference } from './useLanguagePreference';
import { useCurrentPublicPage } from './routeLanguage';

const MIN_TOUCH_TARGET_SX = { minHeight: 44 };

/**
 * Portal target for the public-page language menu. Keeping it inside `#root`
 * means the always-mounted menu (and its crawlable links) is part of the
 * prerendered markup, and React replaces that copy when the bundle boots
 * instead of leaving a stale duplicate under `<body>`.
 */
function appRootContainer(): HTMLElement | null {
  return document.getElementById('root');
}

/**
 * Compact switcher for the landing page header, auth pages and other public
 * pages: a labelled button that opens a menu of language names.
 *
 * On a registered public page (`PUBLIC_PAGES`) each entry is a real link to
 * the page's counterpart URL (`/ueber` <-> `/en/about`) and the menu stays
 * mounted, so crawlers can follow the links without opening it. Elsewhere
 * (auth pages, demo) it only switches the UI language in place, as before.
 */
export function PublicLanguageSwitcher({ dense = false, sx }: { dense?: boolean; sx?: SxProps<Theme> }) {
  const { t } = useTranslation('common');
  const { language, setPreference } = useLanguagePreference();
  const publicPage = useCurrentPublicPage()?.page ?? null;
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const buttonId = useId();

  const closeMenu = () => setAnchorEl(null);
  const choose = (next: LanguagePreference) => {
    setPreference(next);
    closeMenu();
  };

  return (
    <>
      <Button
        id={buttonId}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        startIcon={<LanguageIcon fontSize="small" />}
        endIcon={<KeyboardArrowDownIcon fontSize="small" />}
        size={dense ? 'small' : 'medium'}
        color="inherit"
        aria-haspopup="menu"
        aria-controls={anchorEl ? menuId : undefined}
        aria-expanded={anchorEl ? true : undefined}
        // The visible text is the current language; the accessible name adds
        // what the control does, so it is never just "Deutsch".
        aria-label={t('language.switcherLabel', { language: getLanguageLabel(language) })}
        sx={[
          {
            minWidth: 0,
            minHeight: 44,
            px: dense ? { xs: 0.75, sm: 1 } : undefined,
            textTransform: 'none',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            // On phones the switcher shares its row with the page's centred logo,
            // so the dense variant drops both decorative icons and keeps only the
            // language name - the part that carries the meaning.
            '& .MuiButton-startIcon': {
              display: { xs: 'none', sm: 'inherit' },
              mr: 0.75,
            },
            '& .MuiButton-endIcon': {
              display: dense ? { xs: 'none', sm: 'inherit' } : undefined,
              ml: 0.35,
            },
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        {getLanguageLabel(language)}
      </Button>
      <Menu
        id={menuId}
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={closeMenu}
        keepMounted={publicPage !== null}
        container={publicPage ? appRootContainer : undefined}
        slotProps={{
          list: { 'aria-labelledby': buttonId, role: 'menu' }
        }}
      >
        {SUPPORTED_LANGUAGES.map((entry) => (
          publicPage ? (
            <MenuItem
              key={entry.code}
              component={RouterLink}
              to={publicPage.paths[entry.code]}
              hrefLang={entry.code}
              lang={entry.code}
              role="menuitemradio"
              aria-checked={language === entry.code}
              selected={language === entry.code}
              onClick={() => choose(entry.code)}
              sx={MIN_TOUCH_TARGET_SX}
            >
              <ListItemText primary={entry.label} />
            </MenuItem>
          ) : (
            <MenuItem
              key={entry.code}
              role="menuitemradio"
              aria-checked={language === entry.code}
              selected={language === entry.code}
              onClick={() => choose(entry.code)}
              sx={MIN_TOUCH_TARGET_SX}
            >
              <ListItemText primary={entry.label} />
            </MenuItem>
          )
        ))}
      </Menu>
    </>
  );
}

/**
 * Full switcher for the account settings page, including the "follow the
 * browser" option that maps to the stored `auto` preference.
 */
export function AccountLanguageSelect() {
  const { t } = useTranslation('common');
  const { preference, setPreference } = useLanguagePreference();
  const labelId = useId();

  const handleChange = (event: SelectChangeEvent<string>) => {
    setPreference(event.target.value as LanguagePreference);
  };

  return (
    <FormControl fullWidth sx={{ maxWidth: 360 }}>
      <InputLabel id={labelId}>{t('language.label')}</InputLabel>
      <Select
        labelId={labelId}
        label={t('language.label')}
        value={preference}
        onChange={handleChange}
        inputProps={{ 'aria-label': t('language.label') }}
      >
        <MenuItem value={AUTO_LANGUAGE} sx={MIN_TOUCH_TARGET_SX}>
          {t('language.auto')}
        </MenuItem>
        {SUPPORTED_LANGUAGES.map((entry) => (
          <MenuItem key={entry.code} value={entry.code} sx={MIN_TOUCH_TARGET_SX}>
            {entry.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

/**
 * Development-only language row for the signed-in app's global menu: shows the
 * current language and opens a submenu of all supported languages. It switches
 * only the UI language in place (`i18n.changeLanguage`) and never stores the
 * account preference — users change that on the account settings page.
 * Render it behind `import.meta.env.DEV` so production builds drop it.
 */
export function DevLanguageMenuItem({ label, onSelected }: { label: string; onSelected?: () => void }) {
  const { i18n } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const itemId = useId();
  const menuId = useId();
  const current = normalizeLanguageTag(i18n.resolvedLanguage ?? i18n.language) ?? FALLBACK_LANGUAGE;

  const choose = (code: SupportedLanguage) => {
    void i18n.changeLanguage(code);
    setAnchorEl(null);
    onSelected?.();
  };

  return (
    <>
      <MenuItem
        id={itemId}
        aria-haspopup="menu"
        aria-controls={anchorEl ? menuId : undefined}
        aria-expanded={anchorEl ? true : undefined}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        sx={MIN_TOUCH_TARGET_SX}
      >
        <ListItemIcon sx={{ minWidth: 32, color: 'text.secondary' }}><LanguageIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary={label} />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>{getLanguageLabel(current)}</Typography>
        <ChevronRightIcon fontSize="small" sx={{ ml: 0.5, color: 'text.secondary' }} />
      </MenuItem>
      <Menu
        id={menuId}
        variant="menu"
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ list: { 'aria-labelledby': itemId, role: 'menu' } }}
      >
        {SUPPORTED_LANGUAGES.map((entry) => (
          <MenuItem
            key={entry.code}
            role="menuitemradio"
            lang={entry.code}
            aria-checked={current === entry.code}
            onClick={() => choose(entry.code)}
            sx={MIN_TOUCH_TARGET_SX}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              {current === entry.code ? <CheckIcon fontSize="small" /> : null}
            </ListItemIcon>
            <ListItemText primary={entry.label} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
