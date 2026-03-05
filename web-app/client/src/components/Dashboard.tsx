import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { DbConnection } from '../module_bindings';
import { Identity } from 'spacetimedb';
import BpmnEditor from './BpmnEditor';

interface User {
  identity: Identity;
  username: string;
  email: string;
  online: boolean;
  createdAt: any;
}

interface Folder {
  id: bigint;
  name: string;
  ownerIdentity: Identity;
  createdAt: any;
}

interface Diagram {
  id: bigint;
  folderId: bigint;
  name: string;
  xmlContent: string;
  ownerIdentity: Identity;
  updatedAt: any;
  updatedBy: Identity;
  createdAt: any;
}

interface FolderShare {
  id: bigint;
  folderId: bigint;
  sharedWithIdentity: Identity;
  permission: string;
  createdAt: any;
}

interface DiagramLock {
  id: bigint;
  diagramId: bigint;
  lockedBy: Identity;
  lockedAt: any;
}

interface Props {
  conn: DbConnection;
  identity: Identity;
  currentUser: User;
  setError: (e: string | null) => void;
  error: string | null;
}

const NEW_BPMN_XML = `<?xml version="1.0" encoding="UTF-8"?>
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

export default function Dashboard({ conn, identity, currentUser, setError, error }: Props) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [diagrams, setDiagrams] = useState<Diagram[]>([]);
  const [folderShares, setFolderShares] = useState<FolderShare[]>([]);
  const [diagramLocks, setDiagramLocks] = useState<DiagramLock[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<bigint | null>(null);
  const [editingDiagram, setEditingDiagram] = useState<Diagram | null>(null);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [showNewDiagramModal, setShowNewDiagramModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newDiagramName, setNewDiagramName] = useState('');
  const [shareUsername, setShareUsername] = useState('');
  const [sharePermission, setSharePermission] = useState('write');

  const refreshData = useCallback(() => {
    const f: Folder[] = [];
    for (const row of conn.db.Folder.iter()) f.push(row as Folder);
    setFolders(f);

    const d: Diagram[] = [];
    for (const row of conn.db.Diagram.iter()) d.push(row as Diagram);
    setDiagrams(d);

    const fs: FolderShare[] = [];
    for (const row of conn.db.FolderShare.iter()) fs.push(row as FolderShare);
    setFolderShares(fs);

    const dl: DiagramLock[] = [];
    for (const row of conn.db.DiagramLock.iter()) dl.push(row as DiagramLock);
    setDiagramLocks(dl);

    const u: User[] = [];
    for (const row of conn.db.User.iter()) u.push(row as User);
    setUsers(u);
  }, [conn]);

  useEffect(() => {
    refreshData();

    const intervals = [
      conn.db.Folder.onInsert(() => refreshData()),
      conn.db.Folder.onUpdate(() => refreshData()),
      conn.db.Folder.onDelete(() => refreshData()),
      conn.db.Diagram.onInsert(() => refreshData()),
      conn.db.Diagram.onUpdate((ctx, oldRow, newRow) => {
        refreshData();
        if (editingDiagram && newRow.id === editingDiagram.id) {
          if (newRow.updatedBy.toHexString() !== identity.toHexString()) {
            setEditingDiagram(newRow as Diagram);
          }
        }
      }),
      conn.db.Diagram.onDelete(() => refreshData()),
      conn.db.FolderShare.onInsert(() => refreshData()),
      conn.db.FolderShare.onDelete(() => refreshData()),
      conn.db.DiagramLock.onInsert(() => refreshData()),
      conn.db.DiagramLock.onDelete(() => refreshData()),
      conn.db.User.onInsert(() => refreshData()),
      conn.db.User.onUpdate(() => refreshData()),
    ];

    return () => {};
  }, [conn, refreshData, identity]);

  const myHex = identity.toHexString();

  const myFolders = folders.filter(f => f.ownerIdentity.toHexString() === myHex);
  const sharedWithMe = folderShares
    .filter(s => s.sharedWithIdentity.toHexString() === myHex)
    .map(s => {
      const folder = folders.find(f => f.id === s.folderId);
      return folder ? { ...folder, permission: s.permission } : null;
    })
    .filter(Boolean) as (Folder & { permission: string })[];

  const selectedFolder = folders.find(f => f.id === selectedFolderId) || null;
  const folderDiagrams = selectedFolderId != null
    ? diagrams.filter(d => d.folderId === selectedFolderId)
    : [];

  const isOwnerOfSelected = selectedFolder?.ownerIdentity.toHexString() === myHex;
  const selectedFolderPermission = isOwnerOfSelected
    ? 'owner'
    : folderShares.find(
        s => s.folderId === selectedFolderId && s.sharedWithIdentity.toHexString() === myHex
      )?.permission || 'none';

  const canWrite = selectedFolderPermission === 'owner' || selectedFolderPermission === 'write';

  const getUsernameByIdentity = (ident: Identity) => {
    const user = users.find(u => u.identity.toHexString() === ident.toHexString());
    return user?.username || ident.toHexString().slice(0, 8);
  };

  const getLockForDiagram = (diagramId: bigint) => {
    return diagramLocks.find(l => l.diagramId === diagramId) || null;
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    conn.reducers.createFolder({ name: newFolderName });
    setNewFolderName('');
    setShowNewFolderModal(false);
  };

  const handleDeleteFolder = (folderId: bigint) => {
    if (confirm('Delete this folder and all its diagrams?')) {
      conn.reducers.deleteFolder({ folderId });
      if (selectedFolderId === folderId) setSelectedFolderId(null);
    }
  };

  const handleShareFolder = () => {
    if (!shareUsername.trim() || !selectedFolderId) return;
    conn.reducers.shareFolder({
      folderId: selectedFolderId,
      targetUsername: shareUsername,
      permission: sharePermission,
    });
    setShareUsername('');
    setShowShareModal(false);
  };

  const handleCreateDiagram = () => {
    if (!newDiagramName.trim() || !selectedFolderId) return;
    conn.reducers.createDiagram({
      folderId: selectedFolderId,
      name: newDiagramName,
      xmlContent: NEW_BPMN_XML,
    });
    setNewDiagramName('');
    setShowNewDiagramModal(false);
  };

  const handleOpenDiagram = (diagram: Diagram) => {
    conn.reducers.lockDiagram({ diagramId: diagram.id });
    setEditingDiagram(diagram);
  };

  const handleCloseDiagram = () => {
    if (editingDiagram) {
      conn.reducers.unlockDiagram({ diagramId: editingDiagram.id });
    }
    setEditingDiagram(null);
  };

  const handleSaveDiagram = (xml: string) => {
    if (!editingDiagram) return;
    conn.reducers.updateDiagram({
      diagramId: editingDiagram.id,
      xmlContent: xml,
    });
  };

  const handleDeleteDiagram = (diagramId: bigint) => {
    if (confirm('Delete this diagram?')) {
      conn.reducers.deleteDiagram({ diagramId });
    }
  };

  const onlineUsers = users.filter(u => u.online);
  const selectedFolderShares = selectedFolderId
    ? folderShares.filter(s => s.folderId === selectedFolderId)
    : [];

  if (editingDiagram) {
    const lock = getLockForDiagram(editingDiagram.id);
    const lockedByOther = lock && lock.lockedBy.toHexString() !== myHex;
    const lockedByUser = lock ? getUsernameByIdentity(lock.lockedBy) : null;

    return (
      <BpmnEditor
        diagram={editingDiagram}
        onSave={handleSaveDiagram}
        onClose={handleCloseDiagram}
        readOnly={!!lockedByOther || !canWrite}
        lockedBy={lockedByOther ? lockedByUser : null}
        currentUser={currentUser}
      />
    );
  }

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h1>Camunda 7 Collab</h1>
          <p>Collaborative BPMN Modeler</p>
        </div>

        <div className="sidebar-section">
          <h3>My Folders</h3>
          {myFolders.map(f => (
            <div
              key={f.id.toString()}
              className={`folder-item ${selectedFolderId === f.id ? 'active' : ''}`}
              onClick={() => setSelectedFolderId(f.id)}
            >
              <span className="folder-icon">📁</span>
              <span>{f.name}</span>
              <div className="folder-actions">
                <button onClick={(e) => { e.stopPropagation(); handleDeleteFolder(f.id); }} title="Delete">🗑</button>
              </div>
            </div>
          ))}
          <button
            className="btn-primary btn-small"
            style={{ marginTop: '8px', width: '100%' }}
            onClick={() => setShowNewFolderModal(true)}
          >
            + New Folder
          </button>
        </div>

        {sharedWithMe.length > 0 && (
          <div className="sidebar-section">
            <h3>Shared with Me</h3>
            {sharedWithMe.map(f => (
              <div
                key={f.id.toString()}
                className={`folder-item ${selectedFolderId === f.id ? 'active' : ''}`}
                onClick={() => setSelectedFolderId(f.id)}
              >
                <span className="folder-icon">📂</span>
                <span>{f.name}</span>
                <span className={`badge ${f.permission === 'write' ? 'badge-owner' : 'badge-shared'}`}>
                  {f.permission}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="sidebar-section">
          <h3>Online ({onlineUsers.length})</h3>
          {onlineUsers.map(u => (
            <div key={u.identity.toHexString()} style={{ fontSize: '13px', padding: '4px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="online-dot" />
              {u.username}
              {u.identity.toHexString() === myHex && ' (you)'}
            </div>
          ))}
        </div>

        <div className="sidebar-user">
          <div className="user-avatar">
            {currentUser.username[0]?.toUpperCase()}
          </div>
          <div className="user-info">
            <div className="username">{currentUser.username}</div>
            <div className="status">Online</div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="main-content">
        <div className="toolbar">
          <h2>{selectedFolder ? selectedFolder.name : 'Select a folder'}</h2>
          {selectedFolder && isOwnerOfSelected && (
            <span className="badge badge-owner">Owner</span>
          )}
          {selectedFolder && !isOwnerOfSelected && selectedFolderPermission !== 'none' && (
            <span className="badge badge-shared">{selectedFolderPermission}</span>
          )}
          <div className="toolbar-right">
            {selectedFolder && isOwnerOfSelected && (
              <button className="btn-secondary btn-small" onClick={() => setShowShareModal(true)}>
                Share
              </button>
            )}
            {selectedFolder && canWrite && (
              <button className="btn-primary btn-small" onClick={() => setShowNewDiagramModal(true)}>
                + New Diagram
              </button>
            )}
          </div>
        </div>

        <div className="content-area">
          {!selectedFolder ? (
            <div className="empty-state">
              <div className="empty-icon">📁</div>
              <h3>Welcome, {currentUser.username}!</h3>
              <p>Select a folder from the sidebar or create a new one to get started.</p>
              <button className="btn-primary" onClick={() => setShowNewFolderModal(true)}>
                Create your first folder
              </button>
            </div>
          ) : folderDiagrams.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📄</div>
              <h3>No diagrams yet</h3>
              <p>Create a BPMN diagram to start modeling.</p>
              {canWrite && (
                <button className="btn-primary" onClick={() => setShowNewDiagramModal(true)}>
                  + New BPMN Diagram
                </button>
              )}
            </div>
          ) : (
            <div className="diagram-grid">
              {folderDiagrams.map(d => {
                const lock = getLockForDiagram(d.id);
                return (
                  <div key={d.id.toString()} className="diagram-card" onClick={() => handleOpenDiagram(d)}>
                    <div className="diagram-icon">📊</div>
                    <h4>{d.name}</h4>
                    <div className="diagram-meta">
                      by {getUsernameByIdentity(d.ownerIdentity)}
                      {lock && (
                        <span style={{ color: 'var(--warning)', marginLeft: '8px' }}>
                          🔒 {getUsernameByIdentity(lock.lockedBy)}
                        </span>
                      )}
                    </div>
                    <div className="diagram-card-actions">
                      {canWrite && (
                        <button
                          className="btn-danger btn-small"
                          onClick={(e) => { e.stopPropagation(); handleDeleteDiagram(d.id); }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Shared users for selected folder */}
        {selectedFolder && isOwnerOfSelected && selectedFolderShares.length > 0 && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--card-bg)', fontSize: '13px' }}>
            <strong>Shared with: </strong>
            {selectedFolderShares.map(s => (
              <span key={s.id.toString()} style={{ marginRight: '12px' }}>
                {getUsernameByIdentity(s.sharedWithIdentity)} ({s.permission})
                <button
                  className="btn-small"
                  style={{ marginLeft: '4px', background: 'transparent', color: 'var(--danger)', padding: '0 4px' }}
                  onClick={() => conn.reducers.unshareFolder({ folderId: s.folderId, targetUsername: getUsernameByIdentity(s.sharedWithIdentity) })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showNewFolderModal && (
        <div className="modal-overlay" onClick={() => setShowNewFolderModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>New Folder</h3>
            <div className="form-group">
              <label>Folder Name</label>
              <input
                autoFocus
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                placeholder="My Project"
                onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowNewFolderModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateFolder}>Create</button>
            </div>
          </div>
        </div>
      )}

      {showNewDiagramModal && (
        <div className="modal-overlay" onClick={() => setShowNewDiagramModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>New BPMN Diagram</h3>
            <div className="form-group">
              <label>Diagram Name</label>
              <input
                autoFocus
                value={newDiagramName}
                onChange={e => setNewDiagramName(e.target.value)}
                placeholder="Order Process"
                onKeyDown={e => e.key === 'Enter' && handleCreateDiagram()}
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowNewDiagramModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateDiagram}>Create</button>
            </div>
          </div>
        </div>
      )}

      {showShareModal && selectedFolderId && (
        <div className="modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Share Folder</h3>
            <div className="form-group">
              <label>Username</label>
              <input
                autoFocus
                value={shareUsername}
                onChange={e => setShareUsername(e.target.value)}
                placeholder="Enter username to share with"
              />
            </div>
            <div className="form-group">
              <label>Permission</label>
              <select value={sharePermission} onChange={e => setSharePermission(e.target.value)}>
                <option value="write">Write (can edit diagrams)</option>
                <option value="read">Read (view only)</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowShareModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleShareFolder}>Share</button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
}
