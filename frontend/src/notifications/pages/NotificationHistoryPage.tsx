import { Alert, Box, Button, CircularProgress, List, ListItemButton, Pagination, Paper } from '@mui/material';
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import { useLocation, useNavigate, useOutletContext } from 'react-router';
import type { ReactElement } from 'react';
import PageContainer from '../../components/layout/PageContainer';
import PageHeader from '../../components/layout/PageHeader';
import EmptyStateCard from '../../components/project/EmptyStateCard';
import { useTranslation } from '../../i18n';
import type { RootLayoutOutletContext } from '../../navigation/topbarTypes';
import { MarkAllNotificationsReadButton } from '../MarkAllNotificationsReadButton';
import { NotificationItemContent } from '../NotificationItemContent';
import { useNotificationHistory } from '../useNotificationHistory';
import { useMarkAllNotificationsRead, useNotificationSelection } from '../useNotifications';
import type { AppNotification } from '../../api/types';

/**
 * The complete notification archive, read and unread alike.
 *
 * The topbar dropdowns are deliberately a "what is new" surface (unread only),
 * so this is where a decision the user already clicked past stays findable.
 * Rows behave exactly like dropdown rows — mark exactly that one as read, then
 * open what it refers to — through the same `useNotificationSelection`.
 */
export default function NotificationHistoryPage(): ReactElement {
  const { t } = useTranslation('notifications');
  const navigate = useNavigate();
  const location = useLocation();
  // The topbar's controller: marking read here has to move the bell's badge
  // too. Optional like every other page's outlet access — the page still marks
  // rows read on its own if it is ever rendered outside the layout.
  const outletContext = useOutletContext<RootLayoutOutletContext | null>();
  const controller = outletContext?.notifications ?? null;
  const history = useNotificationHistory(controller?.allReadVersion);
  const selectNotification = useNotificationSelection(controller);
  const markAllRead = useMarkAllNotificationsRead(controller);
  // The badge's count decides whether there is anything left to mark — the
  // action covers exactly what the badge counts, not just this page's rows.
  const unreadCount = controller?.unreadCount ?? history.unreadCount;

  const handleMarkAllRead = async (): Promise<void> => {
    if (await markAllRead()) {
      history.applyAllRead();
    }
  };

  const handleSelect = (notification: AppNotification): void => {
    history.applyRead(notification);
    selectNotification(notification);
  };

  // The page is opened from a dropdown available on every page, so there is no
  // one destination "back" always means — the previous entry is it. On a direct
  // open (bookmark, link, new tab) there is none: react-router marks that first
  // entry with the key 'default', and the dashboard is the app's home from
  // there, so the control is never dead.
  const handleBack = (): void => {
    if (location.key !== 'default') {
      void navigate(-1);
      return;
    }
    void navigate('/app/dashboard');
  };

  // MUI asks for a label per item type, ellipsis items included; those carry no
  // accessible name of their own, so they must not get a missing translation
  // key as one.
  const getPaginationItemAriaLabel = (
    type: 'page' | 'first' | 'last' | 'next' | 'previous' | 'start-ellipsis' | 'end-ellipsis',
    page: number | null,
  ): string => {
    if (type === 'page' && page !== null) {
      return t('history.pageAriaLabel', { page });
    }
    if (type === 'next' || type === 'previous') {
      return t(`history.${type}PageAriaLabel`);
    }
    return '';
  };

  const isEmpty = !history.isLoading && !history.hasError && history.totalCount === 0;

  return (
    <PageContainer variant="standardCenteredPage">
      <Button
        size="small"
        variant="text"
        startIcon={<ArrowBackOutlinedIcon />}
        sx={{ mb: 1 }}
        onClick={handleBack}
      >
        {t('history.back')}
      </Button>
      <Box sx={{ px: { xs: 2, sm: 0 } }}>
        <PageHeader
          title={t('history.title')}
          description={history.unreadCount > 0
            ? t('history.unreadSubtitle', { unread: history.unreadCount })
            : undefined}
          actions={(
            <MarkAllNotificationsReadButton
              unreadCount={unreadCount}
              isPending={controller?.isMarkingAllRead ?? false}
              onClick={() => { void handleMarkAllRead(); }}
            />
          )}
        />
      </Box>

      {history.hasError ? <Alert severity="error">{t('bell.loadError')}</Alert> : null}

      {history.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </Box>
      ) : null}

      {isEmpty ? (
        <EmptyStateCard
          title={t('history.emptyTitle')}
          description={t('history.emptyDescription')}
        />
      ) : null}

      {!history.isLoading && !history.hasError && history.notifications.length > 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 2 }}>
          <List disablePadding>
            {history.notifications.map((notification) => (
              <ListItemButton
                key={notification.id}
                onClick={() => handleSelect(notification)}
                sx={{
                  alignItems: 'flex-start',
                  px: 2,
                  py: 1.25,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:last-of-type': { borderBottom: 'none' },
                }}
              >
                <NotificationItemContent notification={notification} showUnreadDot />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      ) : null}

      {history.pageCount > 1 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Pagination
            count={history.pageCount}
            page={history.page}
            onChange={(_event, page) => history.goToPage(page)}
            color="primary"
            size="small"
            getItemAriaLabel={getPaginationItemAriaLabel}
          />
        </Box>
      ) : null}
    </PageContainer>
  );
}
