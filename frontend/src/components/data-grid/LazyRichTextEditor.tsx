import { Box, CircularProgress } from '@mui/material';
import { lazy, Suspense } from 'react';
import type { RichTextEditorProps } from './RichTextEditor';

const RichTextEditor = lazy(() => import('./RichTextEditor').then(({ RichTextEditor: Editor }) => ({ default: Editor })));

/** The rich-text editor is by far the largest dependency and only opens on demand. */
export function LazyRichTextEditor(props: RichTextEditorProps) {
  return (
    <Suspense
      fallback={(
        <Box sx={{ minHeight: props.minHeight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress size={24} />
        </Box>
      )}
    >
      <RichTextEditor {...props} />
    </Suspense>
  );
}
