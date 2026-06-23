/**
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH
 * under one or more contributor license agreements. See the NOTICE file
 * distributed with this work for additional information regarding copyright
 * ownership.
 *
 * Camunda licenses this file to you under the MIT; you may not use this file
 * except in compliance with the MIT License.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef
} from 'react';

import BpmnModeler from 'camunda-bpmn-js/lib/camunda-platform/Modeler';

import addExporterModule from '@bpmn-io/add-exporter';

import lintingAnnotationsModule from '@camunda/linting/modeler';

import { BpmnJSTracking as bpmnJSTracking } from 'bpmn-js-tracking';

import contextPadTracking from 'bpmn-js-tracking/lib/features/context-pad';
import elementTemplatesTracking from 'bpmn-js-tracking/lib/features/element-templates';
import modelingTracking from 'bpmn-js-tracking/lib/features/modeling';
import popupMenuTracking from 'bpmn-js-tracking/lib/features/popup-menu';
import paletteTracking from 'bpmn-js-tracking/lib/features/palette';

import initialDiagramXML from '../../../client/src/app/tabs/bpmn/diagram.bpmn';

const SNAPSHOT_EVERY_COMMANDS = 25;
const SNAPSHOT_EVERY_MS = 30000;

type Serializable = null | boolean | number | string | Serializable[] | { [key: string]: Serializable };

type CommandEvent = {
  type: string;
  commandStack?: unknown;
  event?: unknown;
  xml?: string;
  metadata?: XmlSnapshotMetadata;
};

type XmlSnapshotMetadata = {
  reason: string;
  commandStackIndex?: number;
  warnings?: unknown[];
  collaborationState?: unknown;
};

type RemoteChange = string | {
  xml?: string;
  metadata?: XmlSnapshotMetadata;
};

type RemoteSelection = {
  userId?: string;
  elementIds?: string[];
  elements?: string[];
};

type CollaborationEvent = {
  document_id: string;
  client_id: string;
  user_id: string;
  base_revision: number;
  local_sequence: number;
  command_type: string;
  payload: Serializable;
  created_at: string;
};

type RemoteSubscription = { unsubscribe?: () => void } | (() => void) | void;

type SpacetimeClient = {
  sendEvent?: (event: CollaborationEvent) => Promise<void> | void;
  sendSnapshot?: (snapshot: CollaborationEvent) => Promise<void> | void;
  subscribeToDocumentEvents?: (
    documentId: string,
    onEvent: (event: CollaborationEvent) => void
  ) => RemoteSubscription;
};

type BpmnCanvasProps = {
  xml: string;
  onCommand?: (commandEvent: CommandEvent) => void;
  onXmlSnapshot?: (xml: string, metadata: XmlSnapshotMetadata) => void;
  readonly?: boolean;
  collaborationState?: unknown;
  spacetime?: SpacetimeClient;
  documentId?: string;
  clientId?: string;
  userId?: string;
  baseRevision?: number;
  snapshotEveryCommands?: number;
  snapshotEveryMs?: number;
};

export type BpmnCanvasHandle = {
  importXML: (xml?: string) => Promise<unknown>;
  saveXML: () => Promise<string>;
  applyRemoteChange: (change: RemoteChange) => Promise<unknown>;
  setRemoteSelections: (selections: RemoteSelection[] | Record<string, RemoteSelection>) => void;
};

const modelerModules = [
  addExporterModule,
  lintingAnnotationsModule,
  bpmnJSTracking,
  contextPadTracking,
  elementTemplatesTracking,
  modelingTracking,
  popupMenuTracking,
  paletteTracking
];

const commandMetadata = (reason: string, modeler: BpmnModeler | null, collaborationState: unknown): XmlSnapshotMetadata => {
  const commandStack = modeler && modeler.get('commandStack', false);

  return {
    reason,
    commandStackIndex: commandStack && commandStack._stackIdx,
    collaborationState
  };
};

const normalizeXML = (xml?: string) => xml || initialDiagramXML;

function unsubscribe(subscription: RemoteSubscription) {
  if (typeof subscription === 'function') {
    subscription();
  } else if (subscription?.unsubscribe) {
    subscription.unsubscribe();
  }
}

function isSerializable(value: unknown): value is Serializable {
  if (value === null || value === undefined) {
    return true;
  }

  if ([ 'string', 'number', 'boolean' ].includes(typeof value)) {
    return Number.isFinite(value as number) || typeof value !== 'number';
  }

  if (Array.isArray(value)) {
    return value.every(isSerializable);
  }

  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(isSerializable);
  }

  return false;
}

function serializeCommand(event: any): { command_type: string; payload: Serializable } {
  const command = event?.command || event?.context?.command;
  const context = event?.context || event?.command?.context || {};
  const commandType = typeof command === 'string' ? command : event?.type || 'commandStack.changed';

  const payloadCandidate = {
    id: context?.id,
    elementId: context?.element?.id,
    elements: Array.isArray(context?.elements) ? context.elements.map(({ id }) => id) : undefined,
    hints: context?.hints,
    properties: context?.properties,
    businessObjectId: context?.businessObject?.id
  };

  if (!isSerializable(payloadCandidate)) {
    return {
      command_type: commandType,
      payload: {
        fallback: 'snapshot_xml_required',
        reason: 'command_payload_not_safely_serializable'
      }
    };
  }

  return {
    command_type: commandType,
    payload: payloadCandidate as Serializable
  };
}

function applyRemoteEvent(modeler: BpmnModeler, event: CollaborationEvent) {
  const commandStack = modeler.get('commandStack', false);

  if (
    event.command_type === 'snapshot.xml' &&
    event.payload &&
    typeof event.payload === 'object' &&
    'xml' in event.payload &&
    typeof event.payload.xml === 'string'
  ) {
    return modeler.importXML(event.payload.xml);
  }

  if (
    commandStack &&
    typeof commandStack.execute === 'function' &&
    event.payload &&
    typeof event.payload === 'object' &&
    !('fallback' in event.payload)
  ) {
    commandStack.execute(event.command_type, event.payload);
  }
}

const BpmnCanvas = forwardRef<BpmnCanvasHandle, BpmnCanvasProps>(function BpmnCanvas(props, ref) {
  const {
    xml,
    onCommand,
    onXmlSnapshot,
    readonly = false,
    collaborationState,
    spacetime,
    documentId,
    clientId,
    userId,
    baseRevision = 0,
    snapshotEveryCommands = SNAPSHOT_EVERY_COMMANDS,
    snapshotEveryMs = SNAPSHOT_EVERY_MS
  } = props;

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const propertiesPanelRef = useRef<HTMLDivElement | null>(null);
  const modelerRef = useRef<BpmnModeler | null>(null);
  const remoteSelectionOverlaysRef = useRef<string[]>([]);
  const collaborationStateRef = useRef(collaborationState);
  const localSequenceRef = useRef(0);
  const commandsSinceSnapshotRef = useRef(0);
  const applyingRemoteRef = useRef(false);
  const baseRevisionRef = useRef(baseRevision);

  collaborationStateRef.current = collaborationState;
  baseRevisionRef.current = baseRevision;

  const collaborationEnabled = Boolean(spacetime && documentId && clientId && userId);

  const makeCollaborationEvent = useMemo(() => (command_type: string, payload: Serializable): CollaborationEvent | null => {
    if (!documentId || !clientId || !userId) {
      return null;
    }

    return {
      document_id: documentId,
      client_id: clientId,
      user_id: userId,
      base_revision: baseRevisionRef.current,
      local_sequence: ++localSequenceRef.current,
      command_type,
      payload,
      created_at: new Date().toISOString()
    };
  }, [ clientId, documentId, userId ]);

  const emitXmlSnapshot = useCallback(async (reason: string, warnings: unknown[] = []) => {
    const modeler = modelerRef.current;

    if (!modeler || !onXmlSnapshot) {
      return;
    }

    const { xml: savedXML } = await modeler.saveXML({ format: true });

    onXmlSnapshot(savedXML, {
      ...commandMetadata(reason, modeler, collaborationStateRef.current),
      warnings
    });
  }, [ onXmlSnapshot ]);

  const publishCollaborationSnapshot = useCallback(async () => {
    const modeler = modelerRef.current;

    if (!modeler || !spacetime?.sendSnapshot || !collaborationEnabled) {
      return;
    }

    const { xml: savedXML } = await modeler.saveXML({ format: true });

    if (!savedXML) {
      return;
    }

    const event = makeCollaborationEvent('snapshot.xml', { xml: savedXML });

    if (!event) {
      return;
    }

    commandsSinceSnapshotRef.current = 0;
    await spacetime.sendSnapshot(event);
  }, [ collaborationEnabled, makeCollaborationEvent, spacetime ]);

  const importXML = useCallback(async (nextXML?: string) => {
    const modeler = modelerRef.current;

    if (!modeler) {
      return;
    }

    const result = await modeler.importXML(normalizeXML(nextXML));

    const canvas = modeler.get('canvas', false);
    canvas && canvas.zoom('fit-viewport');

    await emitXmlSnapshot('import', result && result.warnings || []);

    return result;
  }, [ emitXmlSnapshot ]);

  useEffect(() => {
    if (!canvasRef.current || !propertiesPanelRef.current) {
      return;
    }

    const modeler = new BpmnModeler({
      container: canvasRef.current,
      position: 'absolute',
      additionalModules: modelerModules,
      changeTemplateCommand: 'propertiesPanel.camunda.changeTemplate',
      propertiesPanel: {
        parent: propertiesPanelRef.current
      },
      keyboard: {
        bind: false
      }
    });

    modelerRef.current = modeler;

    const eventBus = modeler.get('eventBus');
    const commandStack = modeler.get('commandStack');

    const handleCommandStackChanged = async (event: unknown) => {
      const metadata = commandMetadata('command', modeler, collaborationStateRef.current);

      onCommand && onCommand({
        type: 'commandStack.changed',
        commandStack,
        event,
        metadata
      });

      await emitXmlSnapshot('command');

      if (!spacetime?.sendEvent || applyingRemoteRef.current || !collaborationEnabled) {
        return;
      }

      const { command_type, payload } = serializeCommand(event);
      const collaborationEvent = makeCollaborationEvent(command_type, payload);

      if (!collaborationEvent) {
        return;
      }

      await spacetime.sendEvent(collaborationEvent);

      commandsSinceSnapshotRef.current += 1;

      if (
        command_type === 'commandStack.changed' ||
        (payload && typeof payload === 'object' && 'fallback' in payload) ||
        commandsSinceSnapshotRef.current >= snapshotEveryCommands
      ) {
        await publishCollaborationSnapshot();
      }
    };

    eventBus.on('commandStack.changed', handleCommandStackChanged);
    const snapshotTimer = collaborationEnabled ? window.setInterval(publishCollaborationSnapshot, snapshotEveryMs) : undefined;

    importXML(xml);

    return () => {
      eventBus.off('commandStack.changed', handleCommandStackChanged);
      snapshotTimer && window.clearInterval(snapshotTimer);
      remoteSelectionOverlaysRef.current = [];
      modeler.destroy();
      modelerRef.current = null;
    };
  }, [
    collaborationEnabled,
    emitXmlSnapshot,
    importXML,
    makeCollaborationEvent,
    onCommand,
    publishCollaborationSnapshot,
    snapshotEveryCommands,
    snapshotEveryMs,
    spacetime,
    xml
  ]);

  useEffect(() => {
    importXML(xml);
  }, [ xml, importXML ]);

  useEffect(() => {
    const modeler = modelerRef.current;

    if (!modeler) {
      return;
    }

    const palette = modeler.get('palette', false);
    const contextPad = modeler.get('contextPad', false);

    if (readonly) {
      palette && palette.close();
      contextPad && contextPad.close();
    }
  }, [ readonly ]);

  useEffect(() => {
    if (!spacetime?.subscribeToDocumentEvents || !documentId || !clientId) {
      return;
    }

    const subscription = spacetime.subscribeToDocumentEvents(documentId, async (event) => {
      const modeler = modelerRef.current;

      if (!modeler || event.client_id === clientId) {
        return;
      }

      applyingRemoteRef.current = true;

      try {
        await applyRemoteEvent(modeler, event);
      } finally {
        applyingRemoteRef.current = false;
      }
    });

    return () => unsubscribe(subscription);
  }, [ clientId, documentId, spacetime ]);

  useImperativeHandle(ref, () => ({
    importXML,

    async saveXML() {
      const modeler = modelerRef.current;

      if (!modeler) {
        return normalizeXML(xml);
      }

      const { xml: savedXML } = await modeler.saveXML({ format: true });

      return savedXML;
    },

    async applyRemoteChange(change: RemoteChange) {
      const nextXML = typeof change === 'string' ? change : change && change.xml;

      const result = await importXML(nextXML);

      onCommand && onCommand({
        type: 'remote.change.applied',
        xml: nextXML,
        metadata: typeof change === 'string' ? commandMetadata('remote-change', modelerRef.current, collaborationStateRef.current) : change.metadata
      });

      return result;
    },

    setRemoteSelections(selections) {
      const modeler = modelerRef.current;

      if (!modeler) {
        return;
      }

      const overlays = modeler.get('overlays', false);

      if (!overlays) {
        return;
      }

      remoteSelectionOverlaysRef.current.forEach((overlayId) => overlays.remove(overlayId));
      remoteSelectionOverlaysRef.current = [];

      const normalizedSelections = Array.isArray(selections) ? selections : Object.values(selections || {});

      normalizedSelections.forEach((selection) => {
        const elementIds = selection.elementIds || selection.elements || [];

        elementIds.forEach((elementId) => {
          const overlayId = overlays.add(elementId, 'remote-selection', {
            position: {
              top: -4,
              left: -4
            },
            html: `<div data-remote-user="${ selection.userId || '' }" style="border:2px solid #10b981;border-radius:4px;box-sizing:border-box;height:100%;pointer-events:none;width:100%;"></div>`
          });

          remoteSelectionOverlaysRef.current.push(overlayId);
        });
      });
    }
  }), [ importXML, onCommand, xml ]);

  return (
    <div style={ { display: 'flex', height: '100%', minHeight: 0, width: '100%' } }>
      <div ref={ canvasRef } style={ { flex: 1, minWidth: 0, position: 'relative' } } />
      <div ref={ propertiesPanelRef } style={ { borderLeft: '1px solid #d0d7de', flex: '0 0 320px', overflow: 'auto' } } />
    </div>
  );
});

export default BpmnCanvas;
