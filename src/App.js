import React, { useState } from 'react';
import './App.css';
import LandingPage from './components/LandingPage';
import VideoCall from './components/VideoCall';

function App() {
  const [currentView, setCurrentView] = useState('landing');
  const [meetingId, setMeetingId] = useState('');
  const [username, setUsername] = useState('');

  const handleCreateMeeting = (newMeetingId, newUsername) => {
    setMeetingId(newMeetingId);
    setUsername(newUsername);
    setCurrentView('video-call');
  };

  const handleJoinMeeting = (newMeetingId, newUsername) => {
    setMeetingId(newMeetingId);
    setUsername(newUsername);
    setCurrentView('video-call');
  };

  const handleLeaveCall = () => {
    setCurrentView('landing');
    setMeetingId('');
    setUsername('');
  };

  return (
    <div className="App">
      {currentView === 'landing' && (
        <LandingPage
          onCreateMeeting={handleCreateMeeting}
          onJoinMeeting={handleJoinMeeting}
        />
      )}
      {currentView === 'video-call' && (
        <VideoCall
          meetingId={meetingId}
          username={username}
          onLeaveCall={handleLeaveCall}
        />
      )}
    </div>
  );
}

export default App;
