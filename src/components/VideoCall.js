import React, { useState, useEffect, useRef, useCallback } from 'react';
import SockJS from 'sockjs-client';
import { Stomp } from '@stomp/stompjs';
import './VideoCall.css';
import { BACKEND_URL } from '../config';

const VideoCall = ({ meetingId, username, onLeaveCall }) => {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [peers, setPeers] = useState({});
  const [userList, setUserList] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [stompClient, setStompClient] = useState(null);

  const localVideoRef = useRef(null);
  const chatEndRef = useRef(null);

  // Initialize media stream
  useEffect(() => {
    const initMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Unable to access camera/microphone. Please check permissions.');
      }
    };

    initMedia();

    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Connect to WebSocket
  useEffect(() => {
    const client = Stomp.over(new SockJS(`${BACKEND_URL.replace('http', 'ws')}/ws`));
    
    client.connect({}, () => {
      setStompClient(client);
      
      // Subscribe to signaling
      client.subscribe('/topic/signal', (message) => {
        const data = JSON.parse(message.body);
        handleSignal(data);
      });

      // Subscribe to chat
      client.subscribe('/topic/chat', (message) => {
        const data = JSON.parse(message.body);
        setChatMessages(prev => [...prev, data]);
      });

      // Subscribe to user join/leave
      client.subscribe('/topic/join', (message) => {
        const newUser = message.body;
        setUserList(prev => prev.includes(newUser) ? prev : [...prev, newUser]);
      });

      client.subscribe('/topic/leave', (message) => {
        const leftUser = message.body;
        setUserList(prev => prev.filter(user => user !== leftUser));
        if (remoteStreams[leftUser]) {
          setRemoteStreams(prev => {
            const newStreams = { ...prev };
            delete newStreams[leftUser];
            return newStreams;
          });
        }
      });

      // Join the meeting
      client.publish({ destination: '/app/join', body: username });
    });

    return () => {
      if (client.connected) {
        client.publish({ destination: '/app/leave', body: username });
        client.disconnect();
      }
    };
  }, [meetingId, username]);

  // WebRTC signaling
  const handleSignal = useCallback((data) => {
    const { from, to, type, payload } = data;
    
    if (to !== username) return;

    switch (type) {
      case 'offer':
        handleOffer(from, payload);
        break;
      case 'answer':
        handleAnswer(from, payload);
        break;
      case 'ice-candidate':
        handleIceCandidate(from, payload);
        break;
    }
  }, [username]);

  const createPeerConnection = (userId) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        stompClient.publish({
          destination: '/app/signal',
          body: JSON.stringify({
            from: username,
            to: userId,
            type: 'ice-candidate',
            payload: event.candidate
          })
        });
      }
    };

    pc.ontrack = (event) => {
      setRemoteStreams(prev => ({
        ...prev,
        [userId]: event.streams[0]
      }));
    };

    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    return pc;
  };

  const handleOffer = async (from, offer) => {
    const pc = createPeerConnection(from);
    setPeers(prev => ({ ...prev, [from]: pc }));

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    stompClient.publish({
      destination: '/app/signal',
      body: JSON.stringify({
        from: username,
        to: from,
        type: 'answer',
        payload: answer
      })
    });
  };

  const handleAnswer = async (from, answer) => {
    const pc = peers[from];
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  };

  const handleIceCandidate = async (from, candidate) => {
    const pc = peers[from];
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  };

  // Connect to new users
  useEffect(() => {
    userList.forEach(userId => {
      if (userId !== username && !peers[userId]) {
        const pc = createPeerConnection(userId);
        setPeers(prev => ({ ...prev, [userId]: pc }));

        pc.createOffer().then(offer => {
          return pc.setLocalDescription(offer);
        }).then(() => {
          stompClient.publish({
            destination: '/app/signal',
            body: JSON.stringify({
              from: username,
              to: userId,
              type: 'offer',
              payload: pc.localDescription
            })
          });
        });
      }
    });
  }, [userList, username, peers, stompClient, localStream]);

  // Controls
  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true
        });
        
        const videoTrack = screenStream.getVideoTracks()[0];
        const senders = Object.values(peers).map(pc => 
          pc.getSenders().find(sender => sender.track?.kind === 'video')
        );

        senders.forEach(sender => {
          if (sender) sender.replaceTrack(videoTrack);
        });

        setIsScreenSharing(true);
        
        videoTrack.onended = () => {
          toggleScreenShare();
        };
      } catch (error) {
        console.error('Error sharing screen:', error);
      }
    } else {
      const videoTrack = localStream.getVideoTracks()[0];
      const senders = Object.values(peers).map(pc => 
        pc.getSenders().find(sender => sender.track?.kind === 'video')
      );

      senders.forEach(sender => {
        if (sender) sender.replaceTrack(videoTrack);
      });

      setIsScreenSharing(false);
    }
  };

  const sendChatMessage = () => {
    if (chatInput.trim() && stompClient) {
      const message = {
        username,
        message: chatInput.trim(),
        timestamp: new Date().toISOString()
      };
      
      stompClient.publish({
        destination: '/app/chat',
        body: JSON.stringify(message)
      });
      
      setChatInput('');
    }
  };

  const handleLeaveCall = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    Object.values(peers).forEach(pc => pc.close());
    
    if (stompClient && stompClient.connected) {
      stompClient.publish({ destination: '/app/leave', body: username });
      stompClient.disconnect();
    }
    
    onLeaveCall();
  };

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  return (
    <div className="video-call">
      <div className="video-container">
        <div className="video-grid">
          <div className="video-item local">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="video-stream"
            />
            <div className="video-label">
              {username} (You)
              {isMuted && <span className="mute-indicator">🔇</span>}
              {isVideoOff && <span className="video-off-indicator">📷</span>}
            </div>
          </div>
          
          {Object.entries(remoteStreams).map(([userId, stream]) => (
            <div key={userId} className="video-item remote">
              <video
                autoPlay
                playsInline
                className="video-stream"
                ref={el => {
                  if (el) el.srcObject = stream;
                }}
              />
              <div className="video-label">{userId}</div>
            </div>
          ))}
        </div>

        <div className="controls">
          <button 
            className={`control-btn ${isMuted ? 'active' : ''}`}
            onClick={toggleMute}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? '🔇' : '🎤'}
          </button>
          
          <button 
            className={`control-btn ${isVideoOff ? 'active' : ''}`}
            onClick={toggleVideo}
            title={isVideoOff ? 'Turn on video' : 'Turn off video'}
          >
            {isVideoOff ? '📷' : '📹'}
          </button>
          
          <button 
            className={`control-btn ${isScreenSharing ? 'active' : ''}`}
            onClick={toggleScreenShare}
            title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
          >
            {isScreenSharing ? '🖥️' : '🖥️'}
          </button>
          
          <button 
            className={`control-btn ${showChat ? 'active' : ''}`}
            onClick={() => setShowChat(!showChat)}
            title="Chat"
          >
            💬
          </button>
          
          <button 
            className="control-btn leave-btn"
            onClick={handleLeaveCall}
            title="Leave call"
          >
            ❌
          </button>
        </div>
      </div>

      {showChat && (
        <div className="chat-panel">
          <div className="chat-header">
            <h3>Chat</h3>
            <button onClick={() => setShowChat(false)}>✕</button>
          </div>
          
          <div className="chat-messages">
            {chatMessages.map((msg, index) => (
              <div key={index} className={`chat-message ${msg.username === username ? 'own' : ''}`}>
                <div className="message-header">
                  <span className="message-username">{msg.username}</span>
                  <span className="message-time">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="message-text">{msg.message}</div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          
          <div className="chat-input">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
              placeholder="Type a message..."
            />
            <button onClick={sendChatMessage}>Send</button>
          </div>
        </div>
      )}

      <div className="meeting-info">
        <div className="meeting-id">
          Meeting ID: {meetingId}
          <button 
            onClick={() => navigator.clipboard.writeText(meetingId)}
            title="Copy meeting ID"
          >
            📋
          </button>
        </div>
        <div className="participant-count">
          {userList.length + 1} participant{userList.length !== 0 ? 's' : ''}
        </div>
      </div>
    </div>
  );
};

export default VideoCall;