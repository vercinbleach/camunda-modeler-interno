import React, { useEffect, useMemo, useRef } from 'react';

const SNAPSHOT_EVERY_COMMANDS = 25;
const SNAPSHOT_EVERY_MS = 30000;

type Serializable = null | boolean | number | string | Serializable[] | { [key: string]: Serializable };

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

type BpmnModelerLike = {
  get: (name: string, strict?: boolean) => any;
  on?: (event: string, priorityOrCallback: number | ((event: any) => void), callback?: (event: any) => void) => void;
  off?: (event: string, callback: (event: any) => void) => void;
  importXML?: (xml: string) => Promise<any>;
  saveXML?: (options?: { format?: boolean }) => Promise<{ xml?: string }>;
};

type Props = {
  modeler: BpmnModelerLike;
  spacetime: SpacetimeClient;
  documentId: string;
  clientId: string;
  userId: string;
  baseRevision: number;
  snapshotEveryCommands?: number;
  snapshotEveryMs?: number;
};

function unsubscribe(subscription: RemoteSubscription) {
  if (typeof subscription === 'function') {
    subscription();
  } else if (subscription?.unsubscribe) {
    subscription.unsubscribe();
  }
}

function isSerializable(value: unknown): value is Serializable {
  if (value === null) {
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

function applyRemoteEvent(modeler: BpmnModelerLike, event: CollaborationEvent) {
  const commandStack = modeler.get('commandStack', false);

  if (
    event.command_type === 'snapshot.xml' &&
    event.payload &&
    typeof event.payload === 'object' &&
    'xml' in event.payload &&
    typeof event.payload.xml === 'string'
  ) {
    return modeler.importXML?.(event.payload.xml);
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

export default function BpmnCanvas({
  modeler,
  spacetime,
  documentId,
  clientId,
  userId,
  baseRevision,
  snapshotEveryCommands = SNAPSHOT_EVERY_COMMANDS,
  snapshotEveryMs = SNAPSHOT_EVERY_MS
}: Props) {
  const localSequence = useRef(0);
  const commandsSinceSnapshot = useRef(0);
  const applyingRemote = useRef(false);
  const baseRevisionRef = useRef(baseRevision);

  const makeEvent = useMemo(() => (command_type: string, payload: Serializable): CollaborationEvent => ({
    document_id: documentId,
    client_id: clientId,
    user_id: userId,
    base_revision: baseRevisionRef.current,
    local_sequence: ++localSequence.current,
    command_type,
    payload,
    created_at: new Date().toISOString()
  }), [ clientId, documentId, userId ]);

  useEffect(() => {
    baseRevisionRef.current = baseRevision;
  }, [ baseRevision ]);

  useEffect(() => {
    const eventBus = modeler.get('eventBus', false);

    if (!eventBus) {
      return;
    }

    const publishSnapshot = async () => {
      if (!modeler.saveXML || !spacetime.sendSnapshot) {
        return;
      }

      const { xml } = await modeler.saveXML({ format: true });

      if (!xml) {
        return;
      }

      commandsSinceSnapshot.current = 0;
      await spacetime.sendSnapshot(makeEvent('snapshot.xml', { xml }));
    };

    const publishCommand = async (event: any) => {
      if (applyingRemote.current) {
        return;
      }

      const { command_type, payload } = serializeCommand(event);
      const collaborationEvent = makeEvent(command_type, payload);

      await spacetime.sendEvent?.(collaborationEvent);

      commandsSinceSnapshot.current += 1;

      if (
        command_type === 'commandStack.changed' ||
        (payload && typeof payload === 'object' && 'fallback' in payload) ||
        commandsSinceSnapshot.current >= snapshotEveryCommands
      ) {
        await publishSnapshot();
      }
    };

    const commandEvents = [
      'commandStack.changed',
      'commandStack.executed',
      'commandStack.postExecute',
      'commandStack.reverted'
    ];

    commandEvents.forEach((eventName) => eventBus.on(eventName, publishCommand));

    const timer = window.setInterval(publishSnapshot, snapshotEveryMs);

    return () => {
      window.clearInterval(timer);
      commandEvents.forEach((eventName) => eventBus.off(eventName, publishCommand));
    };
  }, [ makeEvent, modeler, snapshotEveryCommands, snapshotEveryMs, spacetime ]);

  useEffect(() => {
    const subscription = spacetime.subscribeToDocumentEvents?.(documentId, async (event) => {
      if (event.client_id === clientId) {
        return;
      }

      applyingRemote.current = true;

      try {
        await applyRemoteEvent(modeler, event);
      } finally {
        applyingRemote.current = false;
      }
    });

    return () => unsubscribe(subscription);
  }, [ clientId, documentId, modeler, spacetime ]);

  return <div className="bpmn-canvas" />;
}
