/**
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH
 * under one or more contributor license agreements. See the NOTICE file
 * distributed with this work for additional information regarding copyright
 * ownership.
 *
 * Camunda licenses this file to you under the MIT; you may not use this file
 * except in compliance with the MIT License.
 */

import { isArray } from 'min-dash';

const DEFAULT_CONFLICT_MODE = 'reject';

/**
 * Client side collaboration guard for SpacetimeDB backed diagram sessions.
 *
 * The session tracks the local document revision, annotates outgoing changes
 * with the revision they were based on and applies remote events only in the
 * definitive order assigned by SpacetimeDB.
 */
export default class SpacetimeCollaborationSession {
  constructor(options = {}) {
    const {
      clientId,
      knownRevision = 0,
      conflictMode = DEFAULT_CONFLICT_MODE,
      onApply,
      onConflict
    } = options;

    if (!clientId) {
      throw new Error('clientId is required');
    }

    this._clientId = clientId;
    this._knownRevision = knownRevision;
    this._conflictMode = conflictMode;
    this._onApply = onApply || noop;
    this._onConflict = onConflict || noop;

    this._history = [];
    this._pendingEvents = new Map();
  }

  get clientId() {
    return this._clientId;
  }

  get knownRevision() {
    return this._knownRevision;
  }

  createChange(change) {
    const elementIds = getElementIds(change);

    return {
      ...change,
      element_ids: elementIds,
      client_id: this._clientId,
      base_revision: this._knownRevision
    };
  }

  acceptLocalEvent(event) {
    const accepted = this._acceptEvent(event);

    if (accepted.status !== 'accepted') {
      return accepted;
    }

    this._drainPendingEvents();

    return accepted;
  }

  receiveRemoteEvent(event) {
    if (event.client_id === this._clientId) {
      return this._acceptOwnEvent(event);
    }

    if (event.revision <= this._knownRevision) {
      return { status: 'ignored', reason: 'stale' };
    }

    if (event.revision > this._knownRevision + 1) {
      this._pendingEvents.set(event.revision, event);

      return { status: 'queued', expected_revision: this._knownRevision + 1 };
    }

    return this._acceptEvent(event);
  }

  canSubmit(change) {
    const conflicts = this._getConflictingElementIds(change.base_revision, getElementIds(change));

    if (!conflicts.length) {
      return { status: 'accepted' };
    }

    const result = {
      status: this._conflictMode === 'rebase' ? 'requires_rebase' : 'conflict',
      conflicts
    };

    this._onConflict(result, change);

    return result;
  }

  updatePresence(presenceEvent) {
    return {
      ...presenceEvent,
      client_id: presenceEvent.client_id || this._clientId,
      revision: this._knownRevision
    };
  }

  _acceptOwnEvent(event) {
    if (event.revision <= this._knownRevision) {
      return { status: 'ignored', reason: 'own-event' };
    }

    this._recordEvent(event);
    this._knownRevision = event.revision;
    this._drainPendingEvents();

    return { status: 'acknowledged' };
  }

  _acceptEvent(event) {
    const localDecision = this.canSubmit(event);

    if (localDecision.status !== 'accepted') {
      return localDecision;
    }

    this._recordEvent(event);
    this._knownRevision = event.revision;
    this._onApply(event);

    return { status: 'accepted' };
  }

  _drainPendingEvents() {
    let nextRevision = this._knownRevision + 1;

    while (this._pendingEvents.has(nextRevision)) {
      const event = this._pendingEvents.get(nextRevision);

      this._pendingEvents.delete(nextRevision);
      this._acceptEvent(event);

      nextRevision = this._knownRevision + 1;
    }
  }

  _recordEvent(event) {
    this._history.push({
      revision: event.revision,
      element_ids: getElementIds(event)
    });
  }

  _getConflictingElementIds(baseRevision, elementIds) {
    if (!baseRevision || baseRevision >= this._knownRevision || !elementIds.length) {
      return [];
    }

    const touchedSinceBase = new Set();

    this._history.forEach(event => {
      if (event.revision <= baseRevision) {
        return;
      }

      event.element_ids.forEach(elementId => touchedSinceBase.add(elementId));
    });

    return elementIds.filter(elementId => touchedSinceBase.has(elementId));
  }
}

export function getElementIds(change = {}) {
  if (change.element_id) {
    return [ change.element_id ];
  }

  if (isArray(change.element_ids)) {
    return change.element_ids.filter(Boolean);
  }

  return [];
}

function noop() {}
