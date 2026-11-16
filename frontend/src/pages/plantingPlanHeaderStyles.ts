export const plantingPlanTableHeaderSx = {
  '& .MuiDataGrid-columnHeaderTitleContainerContent': {
    minWidth: 0,
    flex: '1 1 auto',
  },
  '& .MuiDataGrid-columnHeaderTitleContainerContent > span': {
    minWidth: 0,
    maxWidth: '100%',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflow: 'hidden',
    lineHeight: 1.2,
  },
  '& .MuiDataGrid-iconButtonContainer, & .MuiDataGrid-menuIcon': {
    flexShrink: 0,
  },
} as const;
