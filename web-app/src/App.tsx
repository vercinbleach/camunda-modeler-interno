import React, { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';
import { tables, reducers } from './module_bindings';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';

const DEFAULT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
             xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
             id="Definitions_1"
             targetNamespace="http://bpmn.io/schema/bpmn"
             exporter="Camunda7Collab">
  <process id="Process_1" isExecutable="true">
    <startEvent id="StartEvent_1" />
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Shape_StartEvent_1" bpmnElement="StartEvent_1">
        <dc:Bounds x="180" y="160" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>`;

function App() {
  const { identity, isActive: connected } = useSpacetimeDB();

  const setName = useReducer(reducers.setName);
  const createFolder = useReducer(reducers.createFolder);
  const deleteFolder = useReducer(reducers.deleteFolder);
  const createDiagram = useReducer(reducers.createDiagram);
  const deleteDiagram = useReducer(reducers.deleteDiagram);
  const updateDiagramXml = useReducer(reducers.updateDiagramXml);
  const shareFolder = useReducer(reducers.shareFolder);
  const unshareFolder = useReducer(reducers.unshareFolder);

  const [users] = useTable(tables.user);
  const [allFolders] = useTable(tables.folder);
  const [allShares] = useTable(tables.folder_share);
  const [allDiagrams] = useTable(tables.diagram);

  const [selectedFolderId, setSelectedFolderId] = useState<bigint | null>(null);
  const [editingDiagramId, setEditingDiagramId] = useState<bigint | null>(null);
  const [newName, setNewName] = useState('');
  const [settingName, setSettingName] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewDiagram, setShowNewDiagram] = useState(false);
  const [newDiagramName, setNewDiagramName] = useState('');
  const [showShare, setShowShare] = useState(false);
  const [shareName, setShareName] = useState('');
  const [sharePerm, setSharePerm] = useState('write');

  if (!connected || !identity) {
    return <div className="loading">Connecting to SpacetimeDB...</div>;
  }

  const myHex = identity.toHexString();
  const me = users.find(u => u.identity.toHexString() === myHex);
  const myName = me?.name || myHex.substring(0, 8);

  if (!me?.name) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Camunda 7 Collaborator</h1>
          <p>Set your username to get started</p>
          <form onSubmit={e => { e.preventDefault(); if (newName.trim()) setName({ name: newName.trim() }); }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Your name" autoFocus />
            <button type="submit">Continue</button>
          </form>
        </div>
      </div>
    );
  }

  const myFolders = allFolders.filter(f => f.ownerIdentity.toHexString() === myHex);
  const sharedWithMe = allShares
    .filter(s => s.sharedWithIdentity.toHexString() === myHex)
    .map(s => ({ share: s, folder: allFolders.find(f => f.id === s.folderId) }))
    .filter(x => x.folder);

  const selectedFolder = allFolders.find(f => f.id === selectedFolderId);
  const folderDiagrams = selectedFolderId != null
    ? allDiagrams.filter(d => d.folderId === selectedFolderId)
    : [];

  const editingDiagram = editingDiagramId != null
    ? allDiagrams.find(d => d.id === editingDiagramId)
    : null;

  const onlineUsers = users.filter(u => u.online);
  const isOwner = selectedFolder?.ownerIdentity.toHexString() === myHex;

  const folderSharesForSelected = selectedFolderId != null
    ? allShares.filter(s => s.folderId === selectedFolderId)
    : [];

  const getUserName = (identHex: string) => {
    const u = users.find(u => u.identity.toHexString() === identHex);
    return u?.name || identHex.substring(0, 8);
  };

  // ── BPMN Editor View ──
  if (editingDiagram) {
    return (
      <BpmnEditorView
        diagram={editingDiagram}
        identity={identity}
        myName={myName}
        onSave={(xml: string) => updateDiagramXml({ diagramId: editingDiagram.id, xml })}
        onClose={() => setEditingDiagramId(null)}
      />
    );
  }

  // ── Dashboard View ──
  return (
    <div className="app-layout">
      <div className="sidebar">
        <div className="sidebar-header">
          <h1>Camunda 7 Collab</h1>
        </div>

        <div className="sidebar-section">
          <h3>MY FOLDERS</h3>
          {myFolders.map(f => (
            <div key={f.id.toString()} className={`folder-item ${selectedFolderId === f.id ? 'active' : ''}`}
                 onClick={() => setSelectedFolderId(f.id)}>
              <span>📁 {f.name}</span>
              <button className="icon-btn" onClick={e => { e.stopPropagation(); deleteFolder({ folderId: f.id }); }}>🗑</button>
            </div>
          ))}
          <button className="btn-small btn-full" onClick={() => setShowNewFolder(true)}>+ New Folder</button>
        </div>

        {sharedWithMe.length > 0 && (
          <div className="sidebar-section">
            <h3>SHARED WITH ME</h3>
            {sharedWithMe.map(({ folder, share }) => (
              <div key={folder!.id.toString()} className={`folder-item ${selectedFolderId === folder!.id ? 'active' : ''}`}
                   onClick={() => setSelectedFolderId(folder!.id)}>
                <span>📂 {folder!.name}</span>
                <span className="badge">{share.permission}</span>
              </div>
            ))}
          </div>
        )}

        <div className="sidebar-section">
          <h3>ONLINE ({onlineUsers.length})</h3>
          {onlineUsers.map(u => (
            <div key={u.identity.toHexString()} className="online-user">
              🟢 {u.name || u.identity.toHexString().substring(0, 8)}
              {u.identity.toHexString() === myHex && ' (you)'}
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="user-badge">{myName[0]?.toUpperCase()}</div>
          <span>{myName}</span>
        </div>
      </div>

      <div className="main">
        <div className="toolbar">
          <h2>{selectedFolder ? selectedFolder.name : 'Select a folder'}</h2>
          {selectedFolder && isOwner && (
            <button className="btn-small" onClick={() => setShowShare(true)}>Share</button>
          )}
          {selectedFolder && (
            <button className="btn-primary btn-small" onClick={() => setShowNewDiagram(true)}>+ New Diagram</button>
          )}
        </div>

        {!selectedFolder ? (
          <div className="empty">
            <p>📁</p>
            <h3>Welcome, {myName}!</h3>
            <p>Select or create a folder to start modeling.</p>
          </div>
        ) : folderDiagrams.length === 0 ? (
          <div className="empty">
            <p>📄</p>
            <h3>No diagrams yet</h3>
            <button className="btn-primary" onClick={() => setShowNewDiagram(true)}>+ New BPMN Diagram</button>
          </div>
        ) : (
          <div className="diagram-grid">
            {folderDiagrams.map(d => (
              <div key={d.id.toString()} className="diagram-card" onClick={() => setEditingDiagramId(d.id)}>
                <div className="diagram-icon">📊</div>
                <h4>{d.name}</h4>
                <p className="meta">by {getUserName(d.ownerIdentity.toHexString())}</p>
                <button className="btn-danger btn-small" onClick={e => { e.stopPropagation(); deleteDiagram({ diagramId: d.id }); }}>Delete</button>
              </div>
            ))}
          </div>
        )}

        {selectedFolder && isOwner && folderSharesForSelected.length > 0 && (
          <div className="share-bar">
            Shared with:{' '}
            {folderSharesForSelected.map(s => (
              <span key={s.id.toString()}>
                {getUserName(s.sharedWithIdentity.toHexString())} ({s.permission})
                <button className="icon-btn" onClick={() => unshareFolder({ folderId: s.folderId, targetName: getUserName(s.sharedWithIdentity.toHexString()) })}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showNewFolder && (
        <Modal onClose={() => setShowNewFolder(false)}>
          <h3>New Folder</h3>
          <form onSubmit={e => { e.preventDefault(); createFolder({ name: newFolderName }); setNewFolderName(''); setShowNewFolder(false); }}>
            <input autoFocus value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="Folder name" />
            <div className="modal-btns">
              <button type="button" onClick={() => setShowNewFolder(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Create</button>
            </div>
          </form>
        </Modal>
      )}

      {showNewDiagram && selectedFolderId != null && (
        <Modal onClose={() => setShowNewDiagram(false)}>
          <h3>New BPMN Diagram</h3>
          <form onSubmit={e => { e.preventDefault(); createDiagram({ folderId: selectedFolderId!, name: newDiagramName, xml: DEFAULT_XML }); setNewDiagramName(''); setShowNewDiagram(false); }}>
            <input autoFocus value={newDiagramName} onChange={e => setNewDiagramName(e.target.value)} placeholder="Diagram name" />
            <div className="modal-btns">
              <button type="button" onClick={() => setShowNewDiagram(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Create</button>
            </div>
          </form>
        </Modal>
      )}

      {showShare && selectedFolderId != null && (
        <Modal onClose={() => setShowShare(false)}>
          <h3>Share Folder</h3>
          <form onSubmit={e => { e.preventDefault(); shareFolder({ folderId: selectedFolderId!, targetName: shareName, permission: sharePerm }); setShareName(''); setShowShare(false); }}>
            <input autoFocus value={shareName} onChange={e => setShareName(e.target.value)} placeholder="Username" />
            <select value={sharePerm} onChange={e => setSharePerm(e.target.value)}>
              <option value="write">Write</option>
              <option value="read">Read</option>
            </select>
            <div className="modal-btns">
              <button type="button" onClick={() => setShowShare(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Share</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────────

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  );
}

// ── BPMN Editor with Properties Panel ───────────────────────────────────────

function BpmnEditorView({ diagram, identity, myName, onSave, onClose }: {
  diagram: any;
  identity: any;
  myName: string;
  onSave: (xml: string) => void;
  onClose: () => void;
}) {
  const diagramRef = useRef<HTMLDivElement>(null);
  const propertiesPanelRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<any>(null);
  const lastXmlRef = useRef<string>('');
  const [dirty, setDirty] = useState(false);
  const timerRef = useRef<any>(null);
  const [showXml, setShowXml] = useState(false);
  const [xmlSource, setXmlSource] = useState('');

  useEffect(() => {
    if (!diagramRef.current || !propertiesPanelRef.current) return;
    let destroyed = false;

    import('camunda-bpmn-js/lib/camunda-platform/Modeler').then(({ default: Modeler }) => {
      if (destroyed) return;

      const modeler = new Modeler({
        position: 'absolute',
        propertiesPanel: {},
        keyboard: { bind: false },
      });

      modelerRef.current = modeler;

      // Attach diagram canvas
      modeler.attachTo(diagramRef.current!);

      // Attach properties panel (right side, like Camunda Modeler)
      const propertiesPanel = modeler.get('propertiesPanel') as any;
      propertiesPanel.attachTo(propertiesPanelRef.current!);

      const xml = diagram.xml || DEFAULT_XML;
      lastXmlRef.current = xml;

      modeler.importXML(xml).then(() => {
        if (destroyed) return;
        modeler.get('canvas').zoom('fit-viewport');
      }).catch((e: any) => console.error('importXML error', e));

      // Auto-save to SpacetimeDB on every change
      modeler.on('commandStack.changed', () => {
        setDirty(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(async () => {
          if (!modelerRef.current || destroyed) return;
          try {
            const { xml: newXml } = await modelerRef.current.saveXML({ format: true });
            if (newXml && newXml !== lastXmlRef.current) {
              lastXmlRef.current = newXml;
              onSave(newXml);
              setDirty(false);
            }
          } catch (e) { console.error('autosave err', e); }
        }, 1200);
      });
    });

    return () => {
      destroyed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (modelerRef.current) {
        try { modelerRef.current.get('propertiesPanel').detach(); } catch (_) {}
        modelerRef.current.detach();
        modelerRef.current.destroy();
        modelerRef.current = null;
      }
    };
  }, [diagram.id.toString()]);

  // Real-time sync: when another user updates the diagram, reimport
  useEffect(() => {
    if (!modelerRef.current) return;
    if (diagram.xml &&
        diagram.xml !== lastXmlRef.current &&
        diagram.updatedBy?.toHexString?.() !== identity?.toHexString?.()) {
      lastXmlRef.current = diagram.xml;
      modelerRef.current.importXML(diagram.xml).catch((e: any) => console.error('sync import err', e));
    }
  }, [diagram.xml, diagram.updatedBy]);

  const manualSave = async () => {
    if (!modelerRef.current) return;
    const { xml } = await modelerRef.current.saveXML({ format: true });
    if (xml) { lastXmlRef.current = xml; onSave(xml); setDirty(false); }
  };

  const toggleXmlView = async () => {
    if (!showXml && modelerRef.current) {
      const { xml } = await modelerRef.current.saveXML({ format: true });
      setXmlSource(xml || '');
    }
    setShowXml(!showXml);
  };

  return (
    <div className="editor-full">
      <div className="toolbar">
        <button className="btn-back" onClick={onClose}>← Back</button>
        <h2>{diagram.name}</h2>
        {dirty && <span className="dirty-badge">auto-saving...</span>}
        <div className="toolbar-right">
          <button className="btn-small btn-xml" onClick={toggleXmlView}>{showXml ? 'Diagram' : 'XML'}</button>
          <span className="user-label">{myName}</span>
          <button className="btn-primary btn-small" onClick={manualSave} disabled={!dirty}>Save</button>
        </div>
      </div>
      <div className="editor-body">
        {showXml ? (
          <div className="xml-view">
            <textarea value={xmlSource} readOnly spellCheck={false} />
          </div>
        ) : (
          <>
            <div className="diagram-container" ref={diagramRef} />
            <div className="properties-panel-container" ref={propertiesPanelRef} />
          </>
        )}
      </div>
    </div>
  );
}

export default App;
