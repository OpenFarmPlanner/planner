import { createContext, forwardRef, useContext, type ReactNode, type RefObject } from 'react';
import { Box, Button, Paper, type PaperProps } from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutlineOutlined';

interface Action {
  label: string;
  name: string;
  disabled?: boolean;
  onClick: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  testId?: string;
}

const ActionContext = createContext<Action | null>(null);

export function AutocompleteActionProvider({ action, children }: { action: Action | null; children: ReactNode }) {
  return <ActionContext.Provider value={action}>{children}</ActionContext.Provider>;
}

/** The list scrolls independently; the suggestion action stays reachable below it. */
export const AutocompleteActionPaper = forwardRef<HTMLDivElement, PaperProps>(function AutocompleteActionPaper({ children, ...props }, ref) {
  const action = useContext(ActionContext);
  return <Paper {...props} ref={ref}>
    {children}
    {action ? <Box sx={{ borderTop: '1px solid', borderColor: 'divider', p: 1 }}>
      <Button fullWidth startIcon={<AddCircleOutlineIcon />} aria-label={action.label}
        disabled={action.disabled} ref={action.buttonRef} data-testid={action.testId}
        onMouseDown={event => event.preventDefault()} onClick={action.onClick}
        sx={{ justifyContent: 'flex-start', whiteSpace: 'normal', overflowWrap: 'anywhere', textAlign: 'left' }}>
        {action.name}
      </Button>
    </Box> : null}
  </Paper>;
});
