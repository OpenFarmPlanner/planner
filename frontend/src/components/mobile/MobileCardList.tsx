import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Box, Card, CardActionArea, CardContent, Collapse, Stack, Typography } from '@mui/material';

export interface MobileCardListItem {
  id: string | number;
}

interface MobileCardListProps<T extends MobileCardListItem> {
  items: T[];
  expandedIds: Set<string | number>;
  onToggleExpanded: (id: string | number) => void;
  renderPrimary: (item: T) => React.ReactNode;
  renderSecondary?: (item: T) => React.ReactNode;
  renderDetails: (item: T) => React.ReactNode;
  renderHeaderAction?: (item: T) => React.ReactNode;
  renderActions?: (item: T) => React.ReactNode;
  /** Always-visible line at the bottom of the card, below the collapsible details. */
  renderFooter?: (item: T) => React.ReactNode;
  emptyState?: React.ReactNode;
  detailsShowLabel: string;
  detailsHideLabel: string;
}

export function MobileCardList<T extends MobileCardListItem>({
  items,
  expandedIds,
  onToggleExpanded,
  renderPrimary,
  renderSecondary,
  renderDetails,
  renderHeaderAction,
  renderActions,
  renderFooter,
  emptyState,
  detailsShowLabel,
  detailsHideLabel,
}: MobileCardListProps<T>) {
  if (items.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  return (
    <Stack spacing={1}>
      {items.map((item) => {
        const isExpanded = expandedIds.has(item.id);
        return (
          <Card key={item.id} variant="outlined" data-mobile-card-id={item.id}>
            <CardContent sx={{ px: 1.5, py: 1.25, '&:last-child': { pb: 1.25 } }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "flex-start", }} >
                  <CardActionArea
                    component="button"
                    type="button"
                    onClick={() => onToggleExpanded(item.id)}
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? detailsHideLabel : detailsShowLabel}
                    sx={{
                      display: 'block',
                      borderRadius: 1,
                      minHeight: 44,
                      width: '100%',
                      p: 0.5,
                      mx: -0.5,
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'background-color 120ms ease-in-out',
                      '&:hover': { backgroundColor: 'action.hover' },
                      '&:active': { backgroundColor: 'action.selected' },
                      '&:focus-visible': {
                        outline: (theme) => `2px solid ${theme.palette.primary.main}`,
                        outlineOffset: 1,
                      },
                    }}
                  >
                    <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start",
                      justifyContent: "space-between", }}  >
                      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3, pr: 0.5 }}>
                          {renderPrimary(item)}
                        </Typography>
                        {renderSecondary ? (
                          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35 }}>
                            {renderSecondary(item)}
                          </Typography>
                        ) : null}
                      </Stack>

                      <Box
                        aria-hidden="true"
                        sx={{
                          mt: -0.25,
                          mr: -0.5,
                          flexShrink: 0,
                          display: 'inline-flex',
                          color: 'action.active',
                          transition: 'transform 160ms ease-in-out',
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        }}
                      >
                        <ExpandMoreIcon fontSize="small" />
                      </Box>
                    </Stack>
                  </CardActionArea>
                  {renderHeaderAction ? (
                    <Box sx={{ flexShrink: 0, mt: 0.25 }}>
                      {renderHeaderAction(item)}
                    </Box>
                  ) : null}
                </Stack>

                <Collapse in={isExpanded}>
                  <Box sx={{ pt: 0.25 }}>
                    {renderDetails(item)}
                    {renderActions ? (
                      <Box sx={{ mt: 1 }}>
                        {renderActions(item)}
                      </Box>
                    ) : null}
                  </Box>
                </Collapse>
                {renderFooter ? renderFooter(item) : null}
              </Stack>
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}
