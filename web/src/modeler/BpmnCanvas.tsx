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

type BpmnCanvasProps = {
  xml: string;
  onCommand?: (commandEvent: CommandEvent) => void;
  onXmlSnapshot?: (xml: string, metadata: XmlSnapshotMetadata) => void;
  readonly?: boolean;
  collaborationState?: unknown;
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

const BpmnCanvas = forwardRef<BpmnCanvasHandle, BpmnCanvasProps>(function BpmnCanvas(props, ref) {
  const {
    xml,
    onCommand,
    onXmlSnapshot,
    readonly = false,
    collaborationState
  } = props;

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const propertiesPanelRef = useRef<HTMLDivElement | null>(null);
  const modelerRef = useRef<BpmnModeler | null>(null);
  const remoteSelectionOverlaysRef = useRef<string[]>([]);
  const collaborationStateRef = useRef(collaborationState);

  collaborationStateRef.current = collaborationState;

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
    };

    eventBus.on('commandStack.changed', handleCommandStackChanged);

    importXML(xml);

    return () => {
      eventBus.off('commandStack.changed', handleCommandStackChanged);
      remoteSelectionOverlaysRef.current = [];
      modeler.destroy();
      modelerRef.current = null;
    };
  }, []);

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
