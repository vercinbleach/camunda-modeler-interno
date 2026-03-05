import spacetimedb from './schema';
import { t, SenderError } from 'spacetimedb/server';

export { default } from './schema';

function findSharesForFolder(ctx: any, folderId: bigint) {
  const results = [];
  for (const s of ctx.db.FolderShare.iter()) {
    if (s.folderId === folderId) results.push(s);
  }
  return results;
}

function findDiagramsInFolder(ctx: any, folderId: bigint) {
  const results = [];
  for (const d of ctx.db.Diagram.iter()) {
    if (d.folderId === folderId) results.push(d);
  }
  return results;
}

function hasWriteAccess(ctx: any, folderId: bigint, senderHex: string): boolean {
  for (const s of ctx.db.FolderShare.iter()) {
    if (s.folderId === folderId && s.sharedWithIdentity.toHexString() === senderHex && s.permission === 'write') {
      return true;
    }
  }
  return false;
}

function findUserByUsername(ctx: any, username: string) {
  for (const u of ctx.db.User.iter()) {
    if (u.username === username) return u;
  }
  return null;
}

// --- Lifecycle hooks ---

export const init = spacetimedb.init((_ctx) => {
  console.info('Camunda Collaborator module initialized');
});

export const onConnect = spacetimedb.clientConnected((ctx) => {
  const user = ctx.db.User.identity.find(ctx.sender);
  if (user) {
    ctx.db.User.identity.update({ ...user, online: true });
    console.info(`User ${user.username} connected`);
  }
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const user = ctx.db.User.identity.find(ctx.sender);
  if (user) {
    ctx.db.User.identity.update({ ...user, online: false });

    for (const lock of [...ctx.db.DiagramLock.iter()]) {
      if (lock.lockedBy.toHexString() === ctx.sender.toHexString()) {
        ctx.db.DiagramLock.id.delete(lock.id);
      }
    }
    console.info(`User ${user.username} disconnected`);
  }
});

// --- User reducers ---

export const register_user = spacetimedb.reducer(
  { username: t.string(), email: t.string() },
  (ctx, { username, email }) => {
    if (!username || username.trim().length === 0) {
      throw new SenderError('Username is required');
    }
    if (!email || email.trim().length === 0) {
      throw new SenderError('Email is required');
    }

    const existing = ctx.db.User.identity.find(ctx.sender);
    if (existing) {
      throw new SenderError('User already registered');
    }

    ctx.db.User.insert({
      identity: ctx.sender,
      username: username.trim(),
      email: email.trim(),
      online: true,
      createdAt: ctx.timestamp,
    });

    console.info(`User registered: ${username}`);
  }
);

export const update_profile = spacetimedb.reducer(
  { username: t.string(), email: t.string() },
  (ctx, { username, email }) => {
    const user = ctx.db.User.identity.find(ctx.sender);
    if (!user) throw new SenderError('User not found');

    ctx.db.User.identity.update({
      ...user,
      username: username.trim(),
      email: email.trim(),
    });
  }
);

// --- Folder reducers ---

export const create_folder = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    const user = ctx.db.User.identity.find(ctx.sender);
    if (!user) throw new SenderError('Must be registered to create folders');

    if (!name || name.trim().length === 0) {
      throw new SenderError('Folder name is required');
    }

    ctx.db.Folder.insert({
      id: 0n,
      name: name.trim(),
      ownerIdentity: ctx.sender,
      createdAt: ctx.timestamp,
    });
  }
);

export const rename_folder = spacetimedb.reducer(
  { folderId: t.u64(), name: t.string() },
  (ctx, { folderId, name }) => {
    const folder = ctx.db.Folder.id.find(folderId);
    if (!folder) throw new SenderError('Folder not found');

    if (folder.ownerIdentity.toHexString() !== ctx.sender.toHexString()) {
      throw new SenderError('Only folder owner can rename');
    }

    ctx.db.Folder.id.update({ ...folder, name: name.trim() });
  }
);

export const delete_folder = spacetimedb.reducer(
  { folderId: t.u64() },
  (ctx, { folderId }) => {
    const folder = ctx.db.Folder.id.find(folderId);
    if (!folder) throw new SenderError('Folder not found');

    if (folder.ownerIdentity.toHexString() !== ctx.sender.toHexString()) {
      throw new SenderError('Only folder owner can delete');
    }

    for (const diagram of findDiagramsInFolder(ctx, folderId)) {
      for (const lock of [...ctx.db.DiagramLock.iter()]) {
        if (lock.diagramId === diagram.id) {
          ctx.db.DiagramLock.id.delete(lock.id);
        }
      }
      ctx.db.Diagram.id.delete(diagram.id);
    }

    for (const share of findSharesForFolder(ctx, folderId)) {
      ctx.db.FolderShare.id.delete(share.id);
    }

    ctx.db.Folder.id.delete(folderId);
  }
);

// --- Folder sharing reducers ---

export const share_folder = spacetimedb.reducer(
  { folderId: t.u64(), targetUsername: t.string(), permission: t.string() },
  (ctx, { folderId, targetUsername, permission }) => {
    const folder = ctx.db.Folder.id.find(folderId);
    if (!folder) throw new SenderError('Folder not found');

    if (folder.ownerIdentity.toHexString() !== ctx.sender.toHexString()) {
      throw new SenderError('Only folder owner can share');
    }

    if (permission !== 'read' && permission !== 'write') {
      throw new SenderError('Permission must be "read" or "write"');
    }

    const targetUser = findUserByUsername(ctx, targetUsername.trim());
    if (!targetUser) throw new SenderError('Target user not found');

    if (targetUser.identity.toHexString() === ctx.sender.toHexString()) {
      throw new SenderError('Cannot share folder with yourself');
    }

    for (const s of findSharesForFolder(ctx, folderId)) {
      if (s.sharedWithIdentity.toHexString() === targetUser.identity.toHexString()) {
        ctx.db.FolderShare.id.update({ ...s, permission });
        return;
      }
    }

    ctx.db.FolderShare.insert({
      id: 0n,
      folderId,
      sharedWithIdentity: targetUser.identity,
      permission,
      createdAt: ctx.timestamp,
    });
  }
);

export const unshare_folder = spacetimedb.reducer(
  { folderId: t.u64(), targetUsername: t.string() },
  (ctx, { folderId, targetUsername }) => {
    const folder = ctx.db.Folder.id.find(folderId);
    if (!folder) throw new SenderError('Folder not found');

    if (folder.ownerIdentity.toHexString() !== ctx.sender.toHexString()) {
      throw new SenderError('Only folder owner can unshare');
    }

    const targetUser = findUserByUsername(ctx, targetUsername.trim());
    if (!targetUser) throw new SenderError('Target user not found');

    for (const s of findSharesForFolder(ctx, folderId)) {
      if (s.sharedWithIdentity.toHexString() === targetUser.identity.toHexString()) {
        ctx.db.FolderShare.id.delete(s.id);
        return;
      }
    }
  }
);

// --- Diagram reducers ---

export const create_diagram = spacetimedb.reducer(
  { folderId: t.u64(), name: t.string(), xmlContent: t.string() },
  (ctx, { folderId, name, xmlContent }) => {
    const user = ctx.db.User.identity.find(ctx.sender);
    if (!user) throw new SenderError('Must be registered');

    const folder = ctx.db.Folder.id.find(folderId);
    if (!folder) throw new SenderError('Folder not found');

    const senderHex = ctx.sender.toHexString();
    const isOwner = folder.ownerIdentity.toHexString() === senderHex;

    if (!isOwner && !hasWriteAccess(ctx, folderId, senderHex)) {
      throw new SenderError('No write access to this folder');
    }

    ctx.db.Diagram.insert({
      id: 0n,
      folderId,
      name: name.trim(),
      xmlContent,
      ownerIdentity: ctx.sender,
      updatedAt: ctx.timestamp,
      updatedBy: ctx.sender,
      createdAt: ctx.timestamp,
    });
  }
);

export const update_diagram = spacetimedb.reducer(
  { diagramId: t.u64(), xmlContent: t.string() },
  (ctx, { diagramId, xmlContent }) => {
    const diagram = ctx.db.Diagram.id.find(diagramId);
    if (!diagram) throw new SenderError('Diagram not found');

    const senderHex = ctx.sender.toHexString();
    const folder = ctx.db.Folder.id.find(diagram.folderId);
    if (!folder) throw new SenderError('Parent folder not found');

    const isOwner = folder.ownerIdentity.toHexString() === senderHex;
    if (!isOwner && !hasWriteAccess(ctx, diagram.folderId, senderHex)) {
      throw new SenderError('No write access');
    }

    ctx.db.Diagram.id.update({
      ...diagram,
      xmlContent,
      updatedAt: ctx.timestamp,
      updatedBy: ctx.sender,
    });
  }
);

export const rename_diagram = spacetimedb.reducer(
  { diagramId: t.u64(), name: t.string() },
  (ctx, { diagramId, name }) => {
    const diagram = ctx.db.Diagram.id.find(diagramId);
    if (!diagram) throw new SenderError('Diagram not found');

    const senderHex = ctx.sender.toHexString();
    const folder = ctx.db.Folder.id.find(diagram.folderId);
    if (!folder) throw new SenderError('Parent folder not found');

    const isOwner = folder.ownerIdentity.toHexString() === senderHex;
    if (!isOwner && diagram.ownerIdentity.toHexString() !== senderHex) {
      throw new SenderError('Only folder/diagram owner can rename');
    }

    ctx.db.Diagram.id.update({ ...diagram, name: name.trim() });
  }
);

export const delete_diagram = spacetimedb.reducer(
  { diagramId: t.u64() },
  (ctx, { diagramId }) => {
    const diagram = ctx.db.Diagram.id.find(diagramId);
    if (!diagram) throw new SenderError('Diagram not found');

    const senderHex = ctx.sender.toHexString();
    const folder = ctx.db.Folder.id.find(diagram.folderId);

    if (folder) {
      const isOwner = folder.ownerIdentity.toHexString() === senderHex;
      if (!isOwner && diagram.ownerIdentity.toHexString() !== senderHex) {
        throw new SenderError('Only folder/diagram owner can delete');
      }
    }

    for (const lock of [...ctx.db.DiagramLock.iter()]) {
      if (lock.diagramId === diagramId) {
        ctx.db.DiagramLock.id.delete(lock.id);
      }
    }

    ctx.db.Diagram.id.delete(diagramId);
  }
);

// --- Lock reducers ---

export const lock_diagram = spacetimedb.reducer(
  { diagramId: t.u64() },
  (ctx, { diagramId }) => {
    const diagram = ctx.db.Diagram.id.find(diagramId);
    if (!diagram) throw new SenderError('Diagram not found');

    for (const lock of ctx.db.DiagramLock.iter()) {
      if (lock.diagramId === diagramId) {
        if (lock.lockedBy.toHexString() === ctx.sender.toHexString()) {
          return;
        }
        const lockUser = ctx.db.User.identity.find(lock.lockedBy);
        throw new SenderError(`Diagram is locked by ${lockUser?.username ?? 'another user'}`);
      }
    }

    ctx.db.DiagramLock.insert({
      id: 0n,
      diagramId,
      lockedBy: ctx.sender,
      lockedAt: ctx.timestamp,
    });
  }
);

export const unlock_diagram = spacetimedb.reducer(
  { diagramId: t.u64() },
  (ctx, { diagramId }) => {
    for (const lock of [...ctx.db.DiagramLock.iter()]) {
      if (lock.diagramId === diagramId && lock.lockedBy.toHexString() === ctx.sender.toHexString()) {
        ctx.db.DiagramLock.id.delete(lock.id);
        return;
      }
    }
  }
);
