import React, { useEffect, useRef, useState, useCallback } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';

interface Diagram {
  id: bigint;
  folderId: bigint;
  name: string;
  xmlContent: string;
  ownerIdentity: any;
  updatedAt: any;
  updatedBy: any;
  createdAt: any;
}

interface Props {
  diagram: Diagram;
  onSave: (xml: string) => void;
  onClose: () => void;
  readOnly: boolean;
  lockedBy: string | null;
  currentUser: { username: string };
}

const EMPTY_DIAGRAM = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
             id="Definitions_1"
             targetNamespace="http://bpmn.io/schema/bpmn"
             exporter="Camunda 7 Collaborator">
  <process id="Process_1" isExecutable="true">
    <startEvent id="StartEvent_1" />
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="_BPMNShape_StartEvent_2" bpmnElement="StartEvent_1">
        <dc:Bounds x="180" y="160" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>`;

export default function BpmnEditor({ diagram, onSave, onClose, readOnly, lockedBy, currentUser }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<any>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const lastXmlRef = useRef<string>(diagram.xmlContent);

  useEffect(() => {
    if (!containerRef.current) return;

    const modeler = new (BpmnModeler as any)({
      container: containerRef.current,
    });

    modelerRef.current = modeler;

    const xmlToLoad = diagram.xmlContent && diagram.xmlContent.includes('<definitions')
      ? diagram.xmlContent
      : EMPTY_DIAGRAM;

    modeler.importXML(xmlToLoad).then(() => {
      const canvas = modeler.get('canvas');
      canvas.zoom('fit-viewport');
    }).catch((err: any) => {
      console.warn('importXML failed, using createDiagram:', err?.message);
      return modeler.createDiagram();
    }).then(() => {
      modeler.on('commandStack.changed', () => {
        setDirty(true);
      });
    });

    return () => {
      modeler.destroy();
      modelerRef.current = null;
    };
  }, [diagram.id.toString()]);

  useEffect(() => {
    if (!modelerRef.current) return;

    if (diagram.xmlContent !== lastXmlRef.current && diagram.xmlContent.includes('<definitions')) {
      lastXmlRef.current = diagram.xmlContent;
      modelerRef.current.importXML(diagram.xmlContent).catch((err: any) => {
        console.error('Failed to update BPMN:', err);
      });
    }
  }, [diagram.xmlContent]);

  const handleSave = useCallback(async () => {
    if (!modelerRef.current) return;
    setSaving(true);
    try {
      const result = await modelerRef.current.saveXML({ format: true });
      if (result.xml) {
        lastXmlRef.current = result.xml;
        onSave(result.xml);
        setDirty(false);
      }
    } catch (err) {
      console.error('Failed to save:', err);
    }
    setSaving(false);
  }, [onSave]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  return (
    <div className="editor-container">
      <div className="toolbar">
        <button className="btn-secondary btn-small" onClick={onClose}>
          ← Back
        </button>
        <h2>{diagram.name}</h2>
        {dirty && <span style={{ color: 'var(--warning)', fontSize: '12px' }}>unsaved</span>}
        <div className="toolbar-right">
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {currentUser.username}
          </span>
          {!readOnly && (
            <button
              className="btn-primary btn-small"
              onClick={handleSave}
              disabled={saving || !dirty}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </div>
      <div className="editor-canvas" ref={containerRef}>
        {lockedBy && (
          <div className="lock-indicator">
            🔒 Locked by {lockedBy}
          </div>
        )}
        {readOnly && !lockedBy && (
          <div className="lock-indicator" style={{ background: 'var(--text-muted)' }}>
            Read-only
          </div>
        )}
      </div>
    </div>
  );
}
