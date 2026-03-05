import React, { useState } from 'react';

interface Props {
  onRegister: (username: string, email: string) => void;
  error: string | null;
}

export default function AuthPage({ onRegister, error }: Props) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && email.trim()) {
      onRegister(username, email);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Camunda 7 Collaborator</h1>
        <p>Collaborative BPMN modeling platform. Register to get started.</p>

        {error && (
          <div style={{ background: '#fef2f2', color: '#dc2626', padding: '10px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              required
            />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
            />
          </div>
          <button type="submit" className="btn-primary">
            Create Account
          </button>
        </form>
      </div>
    </div>
  );
}
