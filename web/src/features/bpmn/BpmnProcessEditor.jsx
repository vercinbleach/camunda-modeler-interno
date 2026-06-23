import React, { useEffect, useRef, useState } from 'react';

import BpmnModeler from 'camunda-bpmn-js/lib/camunda-platform/Modeler';
import camundaModdleDescriptor from 'camunda-bpmn-moddle/resources/camunda.json';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';

export default function BpmnProcessEditor({ document, onSave }) {
  const canvasRef = useRef(null);
  const modelerRef = useRef(null);
  const [ status, setStatus ] = useState('Loading BPMN editor...');
  const [ saving, setSaving ] = useState(false);

  useEffect(() => {
    const modeler = new BpmnModeler({
      container: canvasRef.current,
      keyboard: {
        bindTo: window
      },
      moddleExtensions: {
        camunda: camundaModdleDescriptor
      }
    });

    modelerRef.current = modeler;

    modeler.importXML(document.xml)
      .then(({ warnings }) => {
        setStatus(warnings?.length ? `Imported with ${warnings.length} warning(s).` : 'Ready');
      })
      .catch((error) => {
        setStatus(`Failed to import BPMN: ${error.message}`);
      });

    return () => {
      modeler.destroy();
      modelerRef.current = null;
    };
  }, [ document.xml ]);

  const handleSave = async () => {
    if (!modelerRef.current) {
      return;
    }

    setSaving(true);

    try {
      const { xml } = await modelerRef.current.saveXML({ format: true });
      const result = await onSave(xml);
      setStatus(`Saved through web process service at ${result.savedAt}.`);
    } catch (error) {
      setStatus(`Failed to save BPMN: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="editorShell" aria-label="Camunda 7 BPMN editor">
      <header className="editorToolbar">
        <div>
          <strong>Process:</strong> {document.processId}
        </div>
        <button type="button" onClick={ handleSave } disabled={ saving }>
          {saving ? 'Saving...' : 'Save via web service'}
        </button>
      </header>
      <div className="editorCanvas" ref={ canvasRef } />
      <footer className="editorStatus" role="status">{status}</footer>
    </section>
  );
}
