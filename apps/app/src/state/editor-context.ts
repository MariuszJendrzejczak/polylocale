import { createContext, useContext, type Dispatch } from 'react';

import type { EditorAction, EditorState } from './editor-state.js';

export interface EditorContextValue {
  readonly state: EditorState;
  readonly dispatch: Dispatch<EditorAction>;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (ctx === null) {
    throw new Error('useEditor must be used within an EditorProvider');
  }
  return ctx;
}
