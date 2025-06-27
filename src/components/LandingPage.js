import React, { useState } from 'react';
import './LandingPage.css';
import { BACKEND_URL } from '../config';

const LandingPage = ({ onCreateMeeting, onJoinMeeting }) => {
  const [username, setUsername] = useState('');
  const [meetingId, setMeetingId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState('');

  const createMeeting = async () => {
    if (!username.trim()) {
      setError('Please enter your name');
      return;
    }

    setIsCreating(true);
    setError('');

    try {
      const response = await fetch(`${BACKEND_URL}/api/meetings/create?host=${encodeURIComponent(username.trim())}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const meeting = await response.json();
        onCreateMeeting(meeting.meetingId, username.trim());
      } else {
        setError('Failed to create meeting. Please try again.');
      }
    } catch (error) {
      setError('Network error. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const joinMeeting = async () => {
    if (!meetingId.trim() || !username.trim()) {
      setError('Please enter both meeting ID and your name');
      return;
    }

    setIsJoining(true);
    setError('');

    try {
      // First check if meeting exists
      const checkResponse = await fetch(`${BACKEND_URL}/api/meetings/${meetingId.trim()}`);
      
      if (!checkResponse.ok) {
        setError('Meeting not found. Please check the meeting ID.');
        return;
      }

      // Join the meeting
      const joinResponse = await fetch(`${BACKEND_URL}/api/meetings/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetingId: meetingId.trim(),
          username: username.trim()
        })
      });

      if (joinResponse.ok) {
        onJoinMeeting(meetingId.trim(), username.trim());
      } else {
        setError('Failed to join meeting. Please try again.');
      }
    } catch (error) {
      setError('Network error. Please try again.');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="landing-page">
      <div className="landing-container">
        <div className="header">
          <h1>Video Call App</h1>
          <p>Simple, fast, and secure video calling</p>
        </div>

        <div className="meeting-card">
          <div className="input-group">
            <input
              type="text"
              placeholder="Enter your name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input-field"
            />
          </div>

          <div className="meeting-actions">
            <div className="action-section">
              <h3>Create Meeting</h3>
              <p>Start a new video call</p>
              <button 
                onClick={createMeeting} 
                disabled={isCreating}
                className="btn btn-primary"
              >
                {isCreating ? 'Creating...' : 'Create Meeting'}
              </button>
            </div>

            <div className="divider">
              <span>or</span>
            </div>

            <div className="action-section">
              <h3>Join Meeting</h3>
              <p>Join an existing video call</p>
              <input
                type="text"
                placeholder="Enter meeting ID"
                value={meetingId}
                onChange={(e) => setMeetingId(e.target.value)}
                className="input-field"
              />
              <button 
                onClick={joinMeeting} 
                disabled={isJoining}
                className="btn btn-secondary"
              >
                {isJoining ? 'Joining...' : 'Join Meeting'}
              </button>
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}
        </div>
      </div>
    </div>
  );
};

export default LandingPage;