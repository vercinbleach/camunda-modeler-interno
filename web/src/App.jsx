import React, { useEffect, useMemo, useState } from 'react';

import BpmnProcessEditor from './features/bpmn/BpmnProcessEditor.jsx';
import {
  loadProcessDocument,
  saveProcessDocument
} from './services/processDocumentService.js';

function parseWorkspaceRoute(pathname) {
  const match = pathname.match(/^\/workspaces\/([^/]+)\/processes\/([^/]+)\/?$/);

  if (!match) {
    return null;
  }

  return {
    workspaceId: decodeURIComponent(match[1]),
    processId: decodeURIComponent(match[2])
  };
}

export default function App() {
  const route = useMemo(() => parseWorkspaceRoute(window.location.pathname), []);
  const [ document, setDocument ] = useState(null);
  const [ error, setError ] = useState(null);

  useEffect(() => {
    if (!route) {
      return;
    }

    loadProcessDocument(route)
      .then(setDocument)
      .catch((error) => setError(error.message));
  }, [ route ]);

  if (!route) {
    return (
      <main className="emptyState">
        <h1>Camunda Modeler Web MVP</h1>
        <p>Open a BPMN process document using this route shape:</p>
        <code>/workspaces/:workspaceId/processes/:processId</code>
        <p><a href="/workspaces/demo/processes/invoice-process">Open demo process</a></p>
      </main>
    );
  }

  if (error) {
    return <main className="emptyState" role="alert">{error}</main>;
  }

  if (!document) {
    return <main className="emptyState">Loading process document...</main>;
  }

  return (
    <main className="app">
      <BpmnProcessEditor
        document={ document }
        onSave={ (xml) => saveProcessDocument({ ...route, xml }) }
      />
    </main>
  );
}
