/**
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH
 * under one or more contributor license agreements. See the NOTICE file
 * distributed with this work for additional information regarding copyright
 * ownership.
 *
 * Camunda licenses this file to you under the MIT; you may not use this file
 * except in compliance with the MIT License.
 */

const DEFAULT_SNAPSHOT_EVENT_INTERVAL = 25;
const DEFAULT_SNAPSHOT_TIME_INTERVAL = 5 * 60 * 1000;
const DEFAULT_RETRY_INTERVAL = 2000;

export default class SpacetimeDocumentSync {
  constructor(options = {}) {
    const {
      client,
      onStatusChange = () => {},
      snapshotEventInterval = DEFAULT_SNAPSHOT_EVENT_INTERVAL,
      snapshotTimeInterval = DEFAULT_SNAPSHOT_TIME_INTERVAL,
      retryInterval = DEFAULT_RETRY_INTERVAL,
      now = () => Date.now()
    } = options;

    this.client = client;
    this.onStatusChange = onStatusChange;
    this.snapshotEventInterval = snapshotEventInterval;
    this.snapshotTimeInterval = snapshotTimeInterval;
    this.retryInterval = retryInterval;
    this.now = now;

    this.pendingEvents = [];
    this.revisions = {};
    this.eventsSinceSnapshot = {};
    this.lastSnapshotAt = {};
    this.blockedDocuments = {};
    this.retryTimer = null;

    this.status = {
      connected: !!client,
      pending: 0,
      state: client ? 'ready' : 'disabled'
    };

    this._bindClient(client);
  }

  isEnabled() {
    return !!this.client;
  }

  isBlocked(documentId) {
    return !!this.blockedDocuments[ documentId ];
  }

  getStatus() {
    return { ...this.status };
  }

  async loadDocument(documentId) {
    if (!this.client || !documentId) {
      return null;
    }

    this._setStatus({ state: 'loading' });

    const snapshot = await this._call('getLatestSnapshot', documentId);
    const snapshotRevision = snapshot?.revision || 0;
    const events = await this._call('getDocumentEventsAfter', documentId, snapshotRevision) || [];

    const revision = events.reduce((revision, event) => Math.max(revision, event.revision || 0), snapshotRevision);

    this.revisions[ documentId ] = revision;
    this.eventsSinceSnapshot[ documentId ] = events.length;
    this.lastSnapshotAt[ documentId ] = this.now();

    this._setStatus({ state: 'ready' });

    return {
      snapshot,
      events,
      revision
    };
  }

  async recordLocalChange(tab, xml) {
    if (!this.client || !tab || !xml) {
      return;
    }

    const documentId = this._getDocumentId(tab);

    if (this.isBlocked(documentId)) {
      return;
    }

    const baseRevision = this.revisions[ documentId ] || tab.revision || 0;

    const event = {
      id: `${ documentId }:${ baseRevision + 1 }:${ this.now() }`,
      documentId,
      type: 'xml.changed',
      xml,
      baseRevision,
      createdAt: new Date(this.now()).toISOString()
    };

    this.pendingEvents.push(event);
    this._setStatus({ pending: this.pendingEvents.length, state: 'pending' });

    await this.flushPendingEvents();
  }

  async flushPendingEvents() {
    if (!this.client || !this.pendingEvents.length || this.status.state === 'syncing') {
      return;
    }

    this._setStatus({ state: 'syncing' });

    while (this.pendingEvents.length) {
      const event = this.pendingEvents[0];

      try {
        const result = await this._call('insertDocumentEvent', event);
        const revision = result?.revision || event.baseRevision + 1;

        this.revisions[ event.documentId ] = revision;
        this.pendingEvents.shift();

        await this._maybeCreateSnapshot(event.documentId, event.xml, revision);

        this._setStatus({ pending: this.pendingEvents.length, state: this.pendingEvents.length ? 'pending' : 'synced' });
      } catch (error) {
        if (error && (error.code === 'REVISION_DIVERGENCE' || error.name === 'RevisionDivergenceError')) {
          this.blockedDocuments[ event.documentId ] = true;
          this._setStatus({ state: 'diverged', error });
          return;
        }

        this._setStatus({ state: 'offline', error });
        this._scheduleRetry();
        return;
      }
    }
  }

  async _maybeCreateSnapshot(documentId, xml, revision) {
    const eventsSinceSnapshot = (this.eventsSinceSnapshot[ documentId ] || 0) + 1;
    const lastSnapshotAt = this.lastSnapshotAt[ documentId ] || 0;
    const shouldSnapshot = eventsSinceSnapshot >= this.snapshotEventInterval || this.now() - lastSnapshotAt >= this.snapshotTimeInterval;

    this.eventsSinceSnapshot[ documentId ] = eventsSinceSnapshot;

    if (!shouldSnapshot) {
      return;
    }

    await this._call('insertDocumentSnapshot', {
      documentId,
      revision,
      xml,
      createdAt: new Date(this.now()).toISOString()
    });

    this.eventsSinceSnapshot[ documentId ] = 0;
    this.lastSnapshotAt[ documentId ] = this.now();
  }

  _scheduleRetry() {
    if (this.retryTimer) {
      return;
    }

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.flushPendingEvents();
    }, this.retryInterval);
  }

  _bindClient(client) {
    if (!client || !client.on) {
      return;
    }

    client.on('connect', () => this._setStatus({ connected: true, state: 'ready' }));
    client.on('disconnect', () => {
      this._setStatus({ connected: false, state: 'offline' });
      this._scheduleRetry();
    });
  }

  _call(method, ...args) {
    if (!this.client || !this.client[ method ]) {
      return Promise.resolve(null);
    }

    return Promise.resolve(this.client[ method ](...args));
  }

  _getDocumentId(tab) {
    return tab.file?.path || tab.file?.name || tab.id;
  }

  _setStatus(patch) {
    this.status = {
      ...this.status,
      ...patch,
      pending: this.pendingEvents.length
    };

    this.onStatusChange(this.getStatus());
  }
}
