import type { ReactElement } from 'react';

import { EditorProvider } from './state/editor-provider.js';
import { EditorView } from './views/EditorView.js';

export function App(): ReactElement {
  return (
    <EditorProvider>
      <EditorView />
    </EditorProvider>
  );
}
