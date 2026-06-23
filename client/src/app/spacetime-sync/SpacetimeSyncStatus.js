/**
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH
 * under one or more contributor license agreements. See the NOTICE file
 * distributed with this work for additional information regarding copyright
 * ownership.
 *
 * Camunda licenses this file to you under the MIT; you may not use this file
 * except in compliance with the MIT License.
 */

import React from 'react';

import { Fill } from '../slot-fill';

import * as css from './SpacetimeSyncStatus.less';

const LABELS = {
  disabled: 'Sync disabled',
  ready: 'Sync ready',
  loading: 'Loading sync',
  pending: 'Sync pending',
  syncing: 'Syncing',
  synced: 'Synced',
  offline: 'Sync offline',
  diverged: 'Revision diverged'
};

export default function SpacetimeSyncStatus({ status }) {
  if (!status || status.state === 'disabled') {
    return null;
  }

  const label = LABELS[ status.state ] || status.state;
  const pending = status.pending ? ` (${ status.pending } pending)` : '';

  return (
    <Fill slot="status-bar__app" group="0_spacetime-sync">
      <div className={ css.SpacetimeSyncStatus } title={ `${ label }${ pending }` }>
        { label }{ pending }
      </div>
    </Fill>
  );
}
