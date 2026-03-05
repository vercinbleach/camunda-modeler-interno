import { schema, t, table, SenderError } from 'spacetimedb/server';

// ── Tables ──────────────────────────────────────────────────────────────────

const user = table(
  { name: 'user', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string().optional(),
    online: t.bool(),
  }
);

const folder = table(
  { name: 'folder', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    ownerIdentity: t.identity(),
    createdAt: t.timestamp(),
  }
);

const folder_share = table(
  { name: 'folder_share', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    folderId: t.u64(),
    sharedWithIdentity: t.identity(),
    permission: t.string(),
  }
);

const diagram = table(
  { name: 'diagram', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    folderId: t.u64(),
    name: t.string(),
    xml: t.string(),
    ownerIdentity: t.identity(),
    updatedBy: t.identity(),
    updatedAt: t.timestamp(),
  }
);

const spacetimedb = schema({ user, folder, folder_share, diagram });
export default spacetimedb;

// ── Lifecycle ───────────────────────────────────────────────────────────────

export const init = spacetimedb.init(_ctx => {});

export const onConnect = spacetimedb.clientConnected(ctx => {
  const u = ctx.db.user.identity.find(ctx.sender);
  if (u) {
    ctx.db.user.identity.update({ ...u, online: true });
  } else {
    ctx.db.user.insert({ identity: ctx.sender, name: undefined, online: true });
  }
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const u = ctx.db.user.identity.find(ctx.sender);
  if (u) ctx.db.user.identity.update({ ...u, online: false });
});

// ── User ────────────────────────────────────────────────────────────────────

export const set_name = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    if (!name) throw new SenderError('Name must not be empty');
    const u = ctx.db.user.identity.find(ctx.sender);
    if (!u) throw new SenderError('Unknown user');
    ctx.db.user.identity.update({ ...u, name });
  }
);

// ── Folder ──────────────────────────────────────────────────────────────────

export const create_folder = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    if (!name) throw new SenderError('Folder name required');
    ctx.db.folder.insert({
      id: 0n,
      name,
      ownerIdentity: ctx.sender,
      createdAt: ctx.timestamp,
    });
  }
);

export const delete_folder = spacetimedb.reducer(
  { folderId: t.u64() },
  (ctx, { folderId }) => {
    const f = ctx.db.folder.id.find(folderId);
    if (!f) throw new SenderError('Folder not found');
    if (f.ownerIdentity.toHexString() !== ctx.sender.toHexString())
      throw new SenderError('Only owner can delete');
    for (const d of [...ctx.db.diagram.iter()]) {
      if (d.folderId === folderId) ctx.db.diagram.id.delete(d.id);
    }
    for (const s of [...ctx.db.folder_share.iter()]) {
      if (s.folderId === folderId) ctx.db.folder_share.id.delete(s.id);
    }
    ctx.db.folder.id.delete(folderId);
  }
);

// ── Sharing ─────────────────────────────────────────────────────────────────

export const share_folder = spacetimedb.reducer(
  { folderId: t.u64(), targetName: t.string(), permission: t.string() },
  (ctx, { folderId, targetName, permission }) => {
    const f = ctx.db.folder.id.find(folderId);
    if (!f) throw new SenderError('Folder not found');
    if (f.ownerIdentity.toHexString() !== ctx.sender.toHexString())
      throw new SenderError('Only owner can share');
    if (permission !== 'read' && permission !== 'write')
      throw new SenderError('Permission must be read or write');

    let target = null;
    for (const u of ctx.db.user.iter()) {
      if (u.name === targetName) { target = u; break; }
    }
    if (!target) throw new SenderError('User not found');

    for (const s of ctx.db.folder_share.iter()) {
      if (s.folderId === folderId &&
          s.sharedWithIdentity.toHexString() === target.identity.toHexString()) {
        ctx.db.folder_share.id.update({ ...s, permission });
        return;
      }
    }
    ctx.db.folder_share.insert({
      id: 0n, folderId,
      sharedWithIdentity: target.identity, permission,
    });
  }
);

export const unshare_folder = spacetimedb.reducer(
  { folderId: t.u64(), targetName: t.string() },
  (ctx, { folderId, targetName }) => {
    const f = ctx.db.folder.id.find(folderId);
    if (!f) throw new SenderError('Folder not found');
    if (f.ownerIdentity.toHexString() !== ctx.sender.toHexString())
      throw new SenderError('Only owner can unshare');
    let target = null;
    for (const u of ctx.db.user.iter()) {
      if (u.name === targetName) { target = u; break; }
    }
    if (!target) return;
    for (const s of [...ctx.db.folder_share.iter()]) {
      if (s.folderId === folderId &&
          s.sharedWithIdentity.toHexString() === target.identity.toHexString()) {
        ctx.db.folder_share.id.delete(s.id);
      }
    }
  }
);

// ── Diagram ─────────────────────────────────────────────────────────────────

export const create_diagram = spacetimedb.reducer(
  { folderId: t.u64(), name: t.string(), xml: t.string() },
  (ctx, { folderId, name, xml }) => {
    if (!name) throw new SenderError('Diagram name required');
    const f = ctx.db.folder.id.find(folderId);
    if (!f) throw new SenderError('Folder not found');
    ctx.db.diagram.insert({
      id: 0n, folderId, name, xml,
      ownerIdentity: ctx.sender,
      updatedBy: ctx.sender,
      updatedAt: ctx.timestamp,
    });
  }
);

export const update_diagram_xml = spacetimedb.reducer(
  { diagramId: t.u64(), xml: t.string() },
  (ctx, { diagramId, xml }) => {
    const d = ctx.db.diagram.id.find(diagramId);
    if (!d) throw new SenderError('Diagram not found');
    ctx.db.diagram.id.update({
      ...d, xml,
      updatedBy: ctx.sender,
      updatedAt: ctx.timestamp,
    });
  }
);

export const delete_diagram = spacetimedb.reducer(
  { diagramId: t.u64() },
  (ctx, { diagramId }) => {
    const d = ctx.db.diagram.id.find(diagramId);
    if (!d) throw new SenderError('Diagram not found');
    ctx.db.diagram.id.delete(diagramId);
  }
);
