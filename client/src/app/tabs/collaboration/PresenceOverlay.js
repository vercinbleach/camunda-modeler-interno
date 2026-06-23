/**
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH
 * under one or more contributor license agreements. See the NOTICE file
 * distributed with this work for additional information regarding copyright
 * ownership.
 *
 * Camunda licenses this file to you under the MIT; you may not use this file
 * except in compliance with the MIT License.
 */

import './PresenceOverlay.less';

/**
 * Minimal diagram-js overlay adapter that renders remote editors and selectors
 * on top of the elements they currently touch.
 */
export default class PresenceOverlay {
  constructor(overlays) {
    this._overlays = overlays;
    this._overlayIdsByClient = new Map();
  }

  update(presence = []) {
    this.clear();

    presence.forEach(entry => {
      const elementIds = entry.element_ids || (entry.element_id ? [ entry.element_id ] : []);

      elementIds.forEach(elementId => {
        const overlayId = this._overlays.add(elementId, 'collaboration-presence', {
          position: { top: -18, right: 0 },
          html: createPresenceBadge(entry)
        });

        this._rememberOverlay(entry.client_id, overlayId);
      });
    });
  }

  clear(clientId) {
    if (clientId) {
      this._removeClientOverlays(clientId);
      return;
    }

    Array.from(this._overlayIdsByClient.keys()).forEach(id => this._removeClientOverlays(id));
  }

  _rememberOverlay(clientId, overlayId) {
    const overlayIds = this._overlayIdsByClient.get(clientId) || [];

    overlayIds.push(overlayId);
    this._overlayIdsByClient.set(clientId, overlayIds);
  }

  _removeClientOverlays(clientId) {
    const overlayIds = this._overlayIdsByClient.get(clientId) || [];

    overlayIds.forEach(overlayId => this._overlays.remove(overlayId));
    this._overlayIdsByClient.delete(clientId);
  }
}

function createPresenceBadge(entry) {
  const badge = document.createElement('span');

  badge.className = `collaboration-presence-badge collaboration-presence-badge--${ entry.type || 'selection' }`;
  badge.textContent = `${ entry.user_name || entry.client_id } ${ entry.type === 'editing' ? 'editing' : 'selected' }`;
  badge.title = badge.textContent;

  return badge;
}
