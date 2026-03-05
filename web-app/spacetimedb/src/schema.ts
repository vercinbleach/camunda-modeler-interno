import { schema, table, t } from 'spacetimedb/server';

export const User = table(
  { name: 'user', public: true },
  {
    identity: t.identity().primaryKey(),
    username: t.string().unique(),
    email: t.string(),
    online: t.bool(),
    createdAt: t.timestamp(),
  }
);

export const Folder = table(
  { name: 'folder', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    ownerIdentity: t.identity(),
    createdAt: t.timestamp(),
  }
);

export const FolderShare = table(
  { name: 'folder_share', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    folderId: t.u64(),
    sharedWithIdentity: t.identity(),
    permission: t.string(),
    createdAt: t.timestamp(),
  }
);

export const Diagram = table(
  { name: 'diagram', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    folderId: t.u64(),
    name: t.string(),
    xmlContent: t.string(),
    ownerIdentity: t.identity(),
    updatedAt: t.timestamp(),
    updatedBy: t.identity(),
    createdAt: t.timestamp(),
  }
);

export const DiagramLock = table(
  { name: 'diagram_lock', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    diagramId: t.u64(),
    lockedBy: t.identity(),
    lockedAt: t.timestamp(),
  }
);

const spacetimedb = schema({ User, Folder, FolderShare, Diagram, DiagramLock });
export default spacetimedb;
