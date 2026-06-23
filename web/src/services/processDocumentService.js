import initialDiagramTemplate from '../features/bpmn/diagram.bpmn?raw';

const STORAGE_PREFIX = 'camunda-modeler-web:process:';

function getDocumentKey({ workspaceId, processId }) {
  return `${STORAGE_PREFIX}${workspaceId}:${processId}`;
}

function fillTemplate({ processId }) {
  const safeId = processId.replace(/[^A-Za-z0-9_]/g, '_') || 'process';
  const version = '7.22.0';

  return initialDiagramTemplate
    .replaceAll('{{ ID }}', safeId)
    .replaceAll('{{ ID:process }}', safeId)
    .replaceAll('{{ EXPORTER_NAME }}', 'Camunda Modeler Web MVP')
    .replaceAll('{{ EXPORTER_VERSION }}', '0.1.0')
    .replaceAll('{{ CAMUNDA_PLATFORM_VERSION }}', version)
    .replaceAll('{{ DEFAULT_HTTL }}', '180');
}

export async function loadProcessDocument({ workspaceId, processId }) {
  const key = getDocumentKey({ workspaceId, processId });
  const storedXml = window.localStorage.getItem(key);

  return {
    workspaceId,
    processId,
    xml: storedXml || fillTemplate({ processId })
  };
}

export async function saveProcessDocument({ workspaceId, processId, xml }) {
  const key = getDocumentKey({ workspaceId, processId });

  window.localStorage.setItem(key, xml);

  return {
    workspaceId,
    processId,
    savedAt: new Date().toISOString()
  };
}
