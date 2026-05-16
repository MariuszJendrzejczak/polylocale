import { useReducer, type ReactElement, type ReactNode } from 'react';

import { EditorContext } from './editor-context.js';
import { editorReducer, initialEditorState } from './editor-state.js';

export function EditorProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  return <EditorContext.Provider value={{ state, dispatch }}>{children}</EditorContext.Provider>;
}
