/**
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH
 * under one or more contributor license agreements. See the NOTICE file
 * distributed with this work for additional information regarding copyright
 * ownership.
 *
 * Camunda licenses this file to you under the MIT; you may not use this file
 * except in compliance with the MIT License.
 */

import { expect } from 'chai';

import SpacetimeCollaborationSession from '../SpacetimeCollaborationSession';

describe('SpacetimeCollaborationSession', function() {

  it('should include client and base revision in outgoing changes', function() {
    const session = new SpacetimeCollaborationSession({ clientId: 'client-a', knownRevision: 3 });

    const change = session.createChange({ element_id: 'Task_1', payload: { name: 'Updated' } });

    expect(change).to.include({
      client_id: 'client-a',
      base_revision: 3
    });
    expect(change.element_ids).to.eql([ 'Task_1' ]);
  });


  it('should apply remote events in strict revision order', function() {
    const applied = [];
    const session = new SpacetimeCollaborationSession({
      clientId: 'client-a',
      knownRevision: 1,
      onApply: event => applied.push(event.revision)
    });

    expect(session.receiveRemoteEvent(createEvent(3, 'client-b', 'Task_3', 2))).to.include({ status: 'queued' });
    expect(session.receiveRemoteEvent(createEvent(2, 'client-b', 'Task_2', 1))).to.include({ status: 'accepted' });

    expect(applied).to.eql([ 2, 3 ]);
    expect(session.knownRevision).to.equal(3);
  });


  it('should not reapply events produced by the current client', function() {
    const applied = [];
    const session = new SpacetimeCollaborationSession({
      clientId: 'client-a',
      knownRevision: 1,
      onApply: event => applied.push(event)
    });

    expect(session.receiveRemoteEvent(createEvent(2, 'client-a', 'Task_1', 1))).to.include({ status: 'acknowledged' });

    expect(applied).to.eql([]);
    expect(session.knownRevision).to.equal(2);
  });


  it('should accept late non-conflicting changes', function() {
    const session = new SpacetimeCollaborationSession({ clientId: 'client-a', knownRevision: 1 });

    session.receiveRemoteEvent(createEvent(2, 'client-b', 'Task_1', 1));

    const result = session.receiveRemoteEvent(createEvent(3, 'client-c', 'Task_2', 1));

    expect(result).to.include({ status: 'accepted' });
    expect(session.knownRevision).to.equal(3);
  });


  it('should reject late conflicting changes by element id', function() {
    const conflicts = [];
    const session = new SpacetimeCollaborationSession({
      clientId: 'client-a',
      knownRevision: 1,
      onConflict: conflict => conflicts.push(conflict)
    });

    session.receiveRemoteEvent(createEvent(2, 'client-b', 'Task_1', 1));

    const result = session.receiveRemoteEvent(createEvent(3, 'client-c', 'Task_1', 1));

    expect(result).to.eql({
      status: 'conflict',
      conflicts: [ 'Task_1' ]
    });
    expect(conflicts).to.have.length(1);
  });


  it('should mark conflicts as requiring rebase if configured', function() {
    const session = new SpacetimeCollaborationSession({
      clientId: 'client-a',
      knownRevision: 1,
      conflictMode: 'rebase'
    });

    session.receiveRemoteEvent(createEvent(2, 'client-b', 'Task_1', 1));

    expect(session.receiveRemoteEvent(createEvent(3, 'client-c', 'Task_1', 1))).to.eql({
      status: 'requires_rebase',
      conflicts: [ 'Task_1' ]
    });
  });
});

function createEvent(revision, clientId, elementId, baseRevision) {
  return {
    revision,
    client_id: clientId,
    base_revision: baseRevision,
    element_id: elementId
  };
}
