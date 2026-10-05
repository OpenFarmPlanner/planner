import { useCallback, useContext } from 'react';
import { useTranslation } from '../i18n';
import { showGlobalSnackbar } from '../utils/globalSnackbar';
import { AuthContext } from './authContextShared';

/** Message keys under `common:guestDemo` that explain a demo restriction. */
export type GuestDemoMessageKey =
  | 'restricted'
  | 'cropLibraryNotice'
  | 'cropLibraryEdit'
  | 'cropLibraryDiscussion'
  | 'publishCrop'
  | 'unlinkPublicCrop'
  | 'accountSettingsNotice'
  | 'createProject'
  | 'inviteMembers'
  | 'noteAttachments';

export interface GuestDemoGuard {
  /** Whether the signed-in user is a temporary, anonymous guest-demo account. */
  isGuestDemo: boolean;
  /** The localized explanation for a demo restriction. */
  restrictionMessage: (messageKey?: GuestDemoMessageKey) => string;
  /**
   * Shows the explanation and returns true when the action is blocked in the
   * guest demo; returns false (and shows nothing) for every other account.
   */
  blockInGuestDemo: (messageKey?: GuestDemoMessageKey) => boolean;
}

/**
 * The frontend side of the backend's `guest_demo_restricted` rule: the
 * anonymous demo cannot reach side effects outside its own throwaway project
 * (public crop library, account, invitations, uploads). Actions stay visible
 * so the demo shows what the app can do; triggering one explains why it is
 * unavailable instead of failing with a generic error.
 */
export function useGuestDemoGuard(): GuestDemoGuard {
  // Read without `useAuth` so shared components (e.g. the notes drawer inside
  // every data grid) also work where no AuthProvider is mounted.
  const user = useContext(AuthContext)?.user;
  const { t } = useTranslation('common');
  const isGuestDemo = Boolean(user?.is_guest_demo);

  const restrictionMessage = useCallback(
    (messageKey: GuestDemoMessageKey = 'restricted'): string => t(`common:guestDemo.${messageKey}`),
    [t],
  );

  const blockInGuestDemo = useCallback((messageKey: GuestDemoMessageKey = 'restricted'): boolean => {
    if (!isGuestDemo) {
      return false;
    }
    showGlobalSnackbar({ message: restrictionMessage(messageKey), severity: 'info' });
    return true;
  }, [isGuestDemo, restrictionMessage]);

  return { isGuestDemo, restrictionMessage, blockInGuestDemo };
}
