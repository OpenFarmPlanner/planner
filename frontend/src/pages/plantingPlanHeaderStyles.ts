export const plantingPlanTableHeaderSx = {
  '& .MuiDataGrid-columnHeaderTitleContainerContent': { minWidth: 0 },
  '& .MuiDataGrid-columnHeaderTitleContainerContent > span': {
    minWidth: 0,
    maxWidth: '100%',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    display: 'block',
    overflow: 'hidden',
    lineHeight: 1.2,
  },
  '& .MuiDataGrid-iconButtonContainer, & .MuiDataGrid-menuIcon': {
    flexShrink: 0,
  },
} as const;
