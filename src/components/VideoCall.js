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
  const [isConnecting, setIsConnecting] = useState(false);

  const localVideoRef = useRef(null);
  const chatEndRef = useRef(null);
  const screenStreamRef = useRef(null);
  const hasJoinedRef = useRef(false);

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
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // WebRTC signaling handlers
  const handleOffer = useCallback(async (from, offer) => {
    if (peers[from]) {
      console.log('Peer connection already exists for:', from);
      return;
    }

    const pc = createPeerConnection(from);
    setPeers(prev => ({ ...prev, [from]: pc }));

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      stompClient?.publish({
        destination: '/app/signal',
        body: JSON.stringify({
          from: username,
          to: from,
          type: 'answer',
          payload: answer
        })
      });
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  }, [peers, username, stompClient]);

  const handleAnswer = useCallback(async (from, answer) => {
    const pc = peers[from];
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    }
  }, [peers]);

  const handleIceCandidate = useCallback(async (from, candidate) => {
    const pc = peers[from];
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    }
  }, [peers]);

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
      default:
        console.log('Unknown signal type:', type);
    }
  }, [username, handleOffer, handleAnswer, handleIceCandidate]);

  const createPeerConnection = useCallback((userId) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && stompClient) {
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

    pc.oniceconnectionstatechange = () => {
      console.log(`ICE connection state for ${userId}:`, pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        setPeers(prev => {
          const newPeers = { ...prev };
          delete newPeers[userId];
          return newPeers;
        });
        setRemoteStreams(prev => {
          const newStreams = { ...prev };
          delete newStreams[userId];
          return newStreams;
        });
      }
    };

    // Add local stream tracks
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    return pc;
  }, [localStream, username, stompClient]);

  // Connect to new users
  const connectToUser = useCallback(async (userId) => {
    if (userId === username || peers[userId] || !stompClient) return;

    const pc = createPeerConnection(userId);
    setPeers(prev => ({ ...prev, [userId]: pc }));

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      stompClient.publish({
        destination: '/app/signal',
        body: JSON.stringify({
          from: username,
          to: userId,
          type: 'offer',
          payload: offer
        })
      });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  }, [username, peers, stompClient, createPeerConnection]);

  // Connect to WebSocket
  useEffect(() => {
    if (hasJoinedRef.current) return;
    hasJoinedRef.current = true;

    const wsUrl = BACKEND_URL.replace(/^https?:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
    const client = Stomp.over(new SockJS(`${wsUrl}/ws`));
    
    client.connect({}, () => {
      setStompClient(client);
      setIsConnecting(false);
      
      // Subscribe to signaling
      client.subscribe('/topic/signal', (message) => {
        try {
          const data = JSON.parse(message.body);
          handleSignal(data);
        } catch (error) {
          console.error('Error parsing signal message:', error);
        }
      });

      // Subscribe to chat
      client.subscribe('/topic/chat', (message) => {
        try {
          const data = JSON.parse(message.body);
          setChatMessages(prev => [...prev, data]);
        } catch (error) {
          console.error('Error parsing chat message:', error);
        }
      });

      // Subscribe to user join/leave
      client.subscribe('/topic/join', (message) => {
        const newUser = message.body;
        if (newUser !== username) {
          setUserList(prev => prev.includes(newUser) ? prev : [...prev, newUser]);
          connectToUser(newUser);
        }
      });

      client.subscribe('/topic/leave', (message) => {
        const leftUser = message.body;
        setUserList(prev => prev.filter(user => user !== leftUser));
        
        // Clean up peer connection
        if (peers[leftUser]) {
          peers[leftUser].close();
          setPeers(prev => {
            const newPeers = { ...prev };
            delete newPeers[leftUser];
            return newPeers;
          });
        }
        
        // Clean up remote stream
        setRemoteStreams(prev => {
          const newStreams = { ...prev };
          delete newStreams[leftUser];
          return newStreams;
        });
      });

      // Join the meeting
      client.publish({ destination: '/app/join', body: username });
    }, (error) => {
      console.error('WebSocket connection error:', error);
      setIsConnecting(false);
    });

    return () => {
      if (client.connected) {
        client.publish({ destination: '/app/leave', body: username });
        client.disconnect();
      }
    };
  }, [meetingId, username, handleSignal, connectToUser, peers]);

  // Connect to existing users when userList changes
  useEffect(() => {
    userList.forEach(userId => {
      if (userId !== username) {
        connectToUser(userId);
      }
    });
  }, [userList, connectToUser, username]);

  // Controls
  const toggleMute = useCallback(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  }, [localStream, isMuted]);

  const toggleVideo = useCallback(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  }, [localStream, isVideoOff]);

  const toggleScreenShare = useCallback(async () => {
    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true
        });
        
        screenStreamRef.current = screenStream;
        const videoTrack = screenStream.getVideoTracks()[0];
        
        // Replace video track in all peer connections
        Object.values(peers).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(videoTrack);
          }
        });

        setIsScreenSharing(true);
        
        videoTrack.onended = () => {
          toggleScreenShare();
        };
      } catch (error) {
        console.error('Error sharing screen:', error);
      }
    } else {
      if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        
        Object.values(peers).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(videoTrack);
          }
        });
      }

      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
        screenStreamRef.current = null;
      }

      setIsScreenSharing(false);
    }
  }, [isScreenSharing, peers, localStream]);

  const sendChatMessage = useCallback(() => {
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
  }, [chatInput, stompClient, username]);

  const handleLeaveCall = useCallback(() => {
    // Stop all media streams
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    // Close all peer connections
    Object.values(peers).forEach(pc => pc.close());
    
    // Disconnect WebSocket
    if (stompClient && stompClient.connected) {
      stompClient.publish({ destination: '/app/leave', body: username });
      stompClient.disconnect();
    }
    
    onLeaveCall();
  }, [localStream, peers, stompClient, username, onLeaveCall]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Update local video when stream changes
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  return (
    <div className="video-call">
      {isConnecting && (
        <div className="connecting-overlay">
          <div className="connecting-spinner">Connecting...</div>
        </div>
      )}
      
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
              {isScreenSharing && <span className="screen-share-indicator">🖥️</span>}
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