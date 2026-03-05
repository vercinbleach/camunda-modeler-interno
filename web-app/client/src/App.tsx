import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DbConnection } from './module_bindings';
import { Identity } from 'spacetimedb';
import AuthPage from './components/AuthPage';
import Dashboard from './components/Dashboard';

const SPACETIMEDB_URI = 'ws://localhost:3000';
const MODULE_NAME = 'camunda-collab';

type User = {
  identity: Identity;
  username: string;
  email: string;
  online: boolean;
  createdAt: any;
};

export default function App() {
  const [conn, setConn] = useState<DbConnection | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionReady, setSubscriptionReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('stdb_token') || undefined;

    const connection = DbConnection.builder()
      .withUri(SPACETIMEDB_URI)
      .withDatabaseName(MODULE_NAME)
      .withToken(token)
      .onConnect((dbConn, ident, tok) => {
        console.log('Connected to SpacetimeDB', ident.toHexString());
        localStorage.setItem('stdb_token', tok);
        setIdentity(ident);
        setConnected(true);
        setError(null);
        setConn(dbConn);

        dbConn.subscriptionBuilder()
          .onApplied(() => {
            console.log('Subscription applied');
            setSubscriptionReady(true);
          })
          .onError((e: any) => {
            console.error('Subscription error:', e);
          })
          .subscribeToAllTables();
      })
      .onConnectError((_ctx: any, e: any) => {
        console.error('Connection error:', e);
        if (!connected) {
          setError('Failed to connect to SpacetimeDB');
        }
      })
      .onDisconnect(() => {
        console.log('Disconnected');
        setConnected(false);
      })
      .build();

    return () => {
      connection.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!conn || !identity || !subscriptionReady) return;

    const checkUser = () => {
      const identHex = identity.toHexString();
      for (const u of conn.db.User.iter()) {
        if (u.identity.toHexString() === identHex) {
          setCurrentUser(u as User);
          return;
        }
      }
      setCurrentUser(null);
    };

    checkUser();

    conn.db.User.onInsert((_ctx, row) => {
      if (row.identity.toHexString() === identity!.toHexString()) {
        setCurrentUser(row as User);
      }
    });

    conn.db.User.onUpdate((_ctx, _oldRow, newRow) => {
      if (newRow.identity.toHexString() === identity!.toHexString()) {
        setCurrentUser(newRow as User);
      }
    });
  }, [conn, identity, subscriptionReady]);

  const handleRegister = useCallback((username: string, email: string) => {
    if (!conn) return;
    try {
      conn.reducers.registerUser({ username, email });
    } catch (e: any) {
      setError(e.message || 'Registration failed');
    }
  }, [conn]);

  if (!connected || !subscriptionReady) {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h1>Camunda 7 Collaborator</h1>
          <p>Connecting to SpacetimeDB...</p>
          {error && <p style={{ color: 'red' }}>{error}</p>}
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <AuthPage onRegister={handleRegister} error={error} />;
  }

  return (
    <Dashboard
      conn={conn!}
      identity={identity!}
      currentUser={currentUser}
      setError={setError}
      error={error}
    />
  );
}
