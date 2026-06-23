use spacetimedb::{reducer, table, Identity, ReducerContext, Table, Timestamp};

const ROLE_OWNER: &str = "owner";
const ROLE_ADMIN: &str = "admin";
const ROLE_EDITOR: &str = "editor";
const ENGINE_CAMUNDA7: &str = "camunda7";
const DOCUMENT_TYPE_BPMN: &str = "bpmn";

#[table(name = workspace, public)]
pub struct Workspace {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub name: String,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

#[table(name = user_workspace_role, public, index(name = user_workspace, btree(columns = [user_identity, workspace_id])))]
pub struct UserWorkspaceRole {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub workspace_id: u64,
    #[index(btree)]
    pub user_identity: Identity,
    pub role: String,
    pub granted_by: Identity,
    pub granted_at: Timestamp,
}

#[table(name = project, public)]
pub struct Project {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub workspace_id: u64,
    pub name: String,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

#[table(name = process, public)]
pub struct Process {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub project_id: u64,
    pub name: String,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

#[table(name = process_document, public)]
pub struct ProcessDocument {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub process_id: u64,
    pub name: String,
    pub engine: String,
    pub document_type: String,
    pub current_revision: u64,
    pub published_revision: u64,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[table(name = document_event, public)]
pub struct DocumentEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub document_id: u64,
    pub revision: u64,
    pub author: Identity,
    pub event_type: String,
    pub payload: String,
    pub created_at: Timestamp,
}

#[table(name = document_snapshot, public)]
pub struct DocumentSnapshot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub document_id: u64,
    pub revision: u64,
    pub xml: String,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

#[table(name = document_presence, public)]
pub struct DocumentPresence {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub document_id: u64,
    #[index(btree)]
    pub user_identity: Identity,
    pub selection: String,
    pub activity: String,
    pub joined_at: Timestamp,
    pub updated_at: Timestamp,
}

fn role_can_edit(role: &str) -> bool {
    matches!(role, ROLE_OWNER | ROLE_ADMIN | ROLE_EDITOR)
}

fn ensure_workspace_exists(ctx: &ReducerContext, workspace_id: u64) -> Result<(), String> {
    ctx.db
        .workspace()
        .id()
        .find(workspace_id)
        .map(|_| ())
        .ok_or_else(|| format!("workspace {workspace_id} does not exist"))
}

fn workspace_for_document(ctx: &ReducerContext, document_id: u64) -> Result<u64, String> {
    let document = ctx
        .db
        .process_document()
        .id()
        .find(document_id)
        .ok_or_else(|| format!("document {document_id} does not exist"))?;
    let process = ctx
        .db
        .process()
        .id()
        .find(document.process_id)
        .ok_or_else(|| format!("process {} does not exist", document.process_id))?;
    let project = ctx
        .db
        .project()
        .id()
        .find(process.project_id)
        .ok_or_else(|| format!("project {} does not exist", process.project_id))?;

    Ok(project.workspace_id)
}

fn has_edit_permission(ctx: &ReducerContext, workspace_id: u64, user: Identity) -> bool {
    ctx.db
        .user_workspace_role()
        .user_workspace()
        .filter((user, workspace_id))
        .any(|membership| role_can_edit(&membership.role))
}

fn require_workspace_editor(ctx: &ReducerContext, workspace_id: u64) -> Result<(), String> {
    ensure_workspace_exists(ctx, workspace_id)?;
    if has_edit_permission(ctx, workspace_id, ctx.sender) {
        Ok(())
    } else {
        Err(format!(
            "user {} cannot edit workspace {workspace_id}",
            ctx.sender
        ))
    }
}

fn require_document_editor(ctx: &ReducerContext, document_id: u64) -> Result<(), String> {
    let workspace_id = workspace_for_document(ctx, document_id)?;
    require_workspace_editor(ctx, workspace_id)
}

#[reducer]
pub fn create_workspace(ctx: &ReducerContext, name: String) -> Result<(), String> {
    let workspace = ctx.db.workspace().insert(Workspace {
        id: 0,
        name,
        created_by: ctx.sender,
        created_at: ctx.timestamp,
    });

    ctx.db.user_workspace_role().insert(UserWorkspaceRole {
        id: 0,
        workspace_id: workspace.id,
        user_identity: ctx.sender,
        role: ROLE_OWNER.to_string(),
        granted_by: ctx.sender,
        granted_at: ctx.timestamp,
    });

    Ok(())
}

#[reducer]
pub fn grant_workspace_role(
    ctx: &ReducerContext,
    workspace_id: u64,
    user_identity: Identity,
    role: String,
) -> Result<(), String> {
    require_workspace_editor(ctx, workspace_id)?;
    if !matches!(
        role.as_str(),
        ROLE_OWNER | ROLE_ADMIN | ROLE_EDITOR | "viewer"
    ) {
        return Err(format!("unsupported workspace role: {role}"));
    }

    for existing in ctx
        .db
        .user_workspace_role()
        .user_workspace()
        .filter((user_identity, workspace_id))
    {
        ctx.db.user_workspace_role().id().delete(&existing.id);
    }

    ctx.db.user_workspace_role().insert(UserWorkspaceRole {
        id: 0,
        workspace_id,
        user_identity,
        role,
        granted_by: ctx.sender,
        granted_at: ctx.timestamp,
    });

    Ok(())
}

#[reducer]
pub fn create_project(ctx: &ReducerContext, workspace_id: u64, name: String) -> Result<(), String> {
    require_workspace_editor(ctx, workspace_id)?;
    ctx.db.project().insert(Project {
        id: 0,
        workspace_id,
        name,
        created_by: ctx.sender,
        created_at: ctx.timestamp,
    });
    Ok(())
}

#[reducer]
pub fn create_process(ctx: &ReducerContext, project_id: u64, name: String) -> Result<(), String> {
    let project = ctx
        .db
        .project()
        .id()
        .find(project_id)
        .ok_or_else(|| format!("project {project_id} does not exist"))?;
    require_workspace_editor(ctx, project.workspace_id)?;
    ctx.db.process().insert(Process {
        id: 0,
        project_id,
        name,
        created_by: ctx.sender,
        created_at: ctx.timestamp,
    });
    Ok(())
}

#[reducer]
pub fn create_process_document(
    ctx: &ReducerContext,
    process_id: u64,
    name: String,
) -> Result<(), String> {
    let process = ctx
        .db
        .process()
        .id()
        .find(process_id)
        .ok_or_else(|| format!("process {process_id} does not exist"))?;
    let project = ctx
        .db
        .project()
        .id()
        .find(process.project_id)
        .ok_or_else(|| format!("project {} does not exist", process.project_id))?;
    require_workspace_editor(ctx, project.workspace_id)?;

    ctx.db.process_document().insert(ProcessDocument {
        id: 0,
        process_id,
        name,
        engine: ENGINE_CAMUNDA7.to_string(),
        document_type: DOCUMENT_TYPE_BPMN.to_string(),
        current_revision: 0,
        published_revision: 0,
        created_by: ctx.sender,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });

    Ok(())
}

#[reducer]
pub fn join_document(
    ctx: &ReducerContext,
    document_id: u64,
    selection: String,
    activity: String,
) -> Result<(), String> {
    workspace_for_document(ctx, document_id)?;

    for existing in ctx.db.document_presence().document_id().filter(document_id) {
        if existing.user_identity == ctx.sender {
            ctx.db.document_presence().id().delete(&existing.id);
        }
    }

    ctx.db.document_presence().insert(DocumentPresence {
        id: 0,
        document_id,
        user_identity: ctx.sender,
        selection,
        activity,
        joined_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });

    Ok(())
}

#[reducer]
pub fn leave_document(ctx: &ReducerContext, document_id: u64) -> Result<(), String> {
    workspace_for_document(ctx, document_id)?;

    for existing in ctx.db.document_presence().document_id().filter(document_id) {
        if existing.user_identity == ctx.sender {
            ctx.db.document_presence().id().delete(&existing.id);
        }
    }

    Ok(())
}

#[reducer]
pub fn submit_document_event(
    ctx: &ReducerContext,
    document_id: u64,
    event_type: String,
    payload: String,
    selection: String,
    activity: String,
) -> Result<(), String> {
    require_document_editor(ctx, document_id)?;

    let mut document = ctx
        .db
        .process_document()
        .id()
        .find(document_id)
        .ok_or_else(|| format!("document {document_id} does not exist"))?;
    document.current_revision += 1;
    document.updated_at = ctx.timestamp;
    let revision = document.current_revision;
    ctx.db.process_document().id().update(document);

    ctx.db.document_event().insert(DocumentEvent {
        id: 0,
        document_id,
        revision,
        author: ctx.sender,
        event_type,
        payload,
        created_at: ctx.timestamp,
    });

    join_document(ctx, document_id, selection, activity)?;

    Ok(())
}

#[reducer]
pub fn create_snapshot(
    ctx: &ReducerContext,
    document_id: u64,
    revision: u64,
    xml: String,
) -> Result<(), String> {
    require_document_editor(ctx, document_id)?;
    let document = ctx
        .db
        .process_document()
        .id()
        .find(document_id)
        .ok_or_else(|| format!("document {document_id} does not exist"))?;
    if revision == 0 || revision > document.current_revision {
        return Err(format!(
            "snapshot revision {revision} is outside document revision range 1..={}",
            document.current_revision
        ));
    }

    ctx.db.document_snapshot().insert(DocumentSnapshot {
        id: 0,
        document_id,
        revision,
        xml,
        created_by: ctx.sender,
        created_at: ctx.timestamp,
    });

    Ok(())
}

#[reducer]
pub fn publish_version(
    ctx: &ReducerContext,
    document_id: u64,
    revision: u64,
) -> Result<(), String> {
    require_document_editor(ctx, document_id)?;
    let mut document = ctx
        .db
        .process_document()
        .id()
        .find(document_id)
        .ok_or_else(|| format!("document {document_id} does not exist"))?;
    if revision == 0 || revision > document.current_revision {
        return Err(format!(
            "cannot publish revision {revision}; current revision is {}",
            document.current_revision
        ));
    }
    document.published_revision = revision;
    document.updated_at = ctx.timestamp;
    ctx.db.process_document().id().update(document);

    Ok(())
}
