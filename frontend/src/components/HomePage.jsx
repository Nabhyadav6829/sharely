import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';

const BACKEND_URL = 'https://sharely-backend-fvi8.onrender.com';
const CHUNK = 256 * 1024; // 256KB
const MAX_BUFFERED = 1 * 1024 * 1024; // 1MB

export default function HomePage() {
  const navigate = useNavigate();
  const [myName, setMyName] = useState(defaultName());
  const [devices, setDevices] = useState({});
  const [targetId, setTargetId] = useState(null);
  const [status, setStatus] = useState('idle');
  const [sendProgress, setSendProgress] = useState(0);
  const [recvProgress, setRecvProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);
  const [downloads, setDownloads] = useState([]);
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const incomingRef = useRef({ meta: null, received: 0, buffers: [] });
  const iceCandidatesBuffer = useRef([]);

  // --- Core Logic & Functions (No Changes Made Here) ---
  useEffect(() => {
    const socket = io(BACKEND_URL);
    socketRef.current = socket;
    socket.on('connect', () => {
      socket.emit('register', { name: myName });
      socket.emit('who');
    });
    socket.on('devices', (list) => setDevices(list));
    socket.on('signal', async ({ from, data }) => {
      if (!pcRef.current) setupPeer(from);
      try {
        if (data.type === 'offer') {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const answer = await pcRef.current.createAnswer();
          await pcRef.current.setLocalDescription(answer);
          socket.emit('signal', { to: from, data: { type: 'answer', sdp: answer } });
          setTargetId(from);
          while (iceCandidatesBuffer.current.length > 0) {
            const candidate = iceCandidatesBuffer.current.shift();
            await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          }
        } else if (data.type === 'answer') {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
          while (iceCandidatesBuffer.current.length > 0) {
            const candidate = iceCandidatesBuffer.current.shift();
            await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          }
        } else if (data.type === 'ice') {
          if (pcRef.current.remoteDescription) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
          } else {
            iceCandidatesBuffer.current.push(data.candidate);
          }
        } else if (data.type === 'cancel') {
          closePeer();
          setStatus('idle');
          setTargetId(null);
        }
      } catch {}
    });
    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('register', { name: myName });
    }
  }, [myName]);

  function setupPeer(peerId) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: ['stun:stun1.l.google.com:19302'] },
      ],
    });
    pcRef.current = pc;
    if (!peerId) {
      const dc = pc.createDataChannel('file');
      attachDataChannel(dc);
      dcRef.current = dc;
    }
    pc.onicecandidate = (e) => {
      if (e.candidate && (peerId || targetId)) {
        socketRef.current.emit('signal', {
          to: peerId || targetId,
          data: { type: 'ice', candidate: e.candidate },
        });
      }
    };
    pc.ondatachannel = (e) => {
      dcRef.current = e.channel;
      attachDataChannel(dcRef.current);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setStatus('connected');
      else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        setStatus('idle');
        setTargetId(null);
        closePeer();
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
        setStatus('idle');
        setTargetId(null);
        closePeer();
      }
    };
  }

  function attachDataChannel(dc) {
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => setStatus('connected');
    dc.onclose = () => setStatus('idle');
    dc.onmessage = (e) => handleIncoming(e.data);
  }

  function handleIncoming(data) {
    const incoming = incomingRef.current;
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);
        if (msg.kind === 'meta') {
          incoming.meta = msg;
          incoming.received = 0;
          incoming.buffers = [];
          setRecvProgress(0);
        }
      } catch {}
      return;
    }
    incoming.buffers.push(data);
    incoming.received += data.byteLength;
    if (incoming.meta?.size) setRecvProgress(Math.round((incoming.received * 100) / incoming.meta.size));
    if (incoming.meta && incoming.received >= incoming.meta.size) {
      const blob = new Blob(incoming.buffers, { type: incoming.meta.type || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const fileName = incoming.meta.name || 'received_file';
      setDownloads((d) => [{ name: fileName, url, size: incoming.meta.size }, ...d]);
      incomingRef.current = { meta: null, received: 0, buffers: [] };
      setRecvProgress(0);
    }
  }

  async function callPeer(peerId) {
    if (status !== 'idle') return;
    setTargetId(peerId);
    setStatus('connecting');
    setupPeer(null);
    try {
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      socketRef.current.emit('signal', { to: peerId, data: { type: 'offer', sdp: offer } });
    } catch {
      setStatus('idle');
      setTargetId(null);
      closePeer();
    }
  }

  async function sendFile() {
    const file = selectedFile;
    const dc = dcRef.current;
    if (!file || !dc || dc.readyState !== 'open') return;
    dc.send(JSON.stringify({ kind: 'meta', name: file.name, size: file.size, type: file.type || 'application/octet-stream' }));
    const reader = file.stream().getReader();
    let sent = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let offset = 0; offset < value.byteLength; offset += CHUNK) {
        const slice = value.buffer.slice(offset, Math.min(value.byteLength, offset + CHUNK));
        while (dc.bufferedAmount > MAX_BUFFERED) {
          await new Promise((r) => setTimeout(r, 10));
        }
        dc.send(slice);
        sent += slice.byteLength;
        setSendProgress(Math.round((sent * 100) / file.size));
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    setSendProgress(0);
  }

  function hangup() {
    if (targetId && socketRef.current) {
      socketRef.current.emit('signal', { to: targetId, data: { type: 'cancel' } });
    }
    closePeer();
    setStatus('idle');
    setTargetId(null);
  }

  function closePeer() {
    try { dcRef.current?.close(); } catch {}
    try { pcRef.current?.close(); } catch {}
    dcRef.current = null;
    pcRef.current = null;
    iceCandidatesBuffer.current = [];
  }
  // --- End of Unchanged Logic ---

  const deviceEntries = useMemo(() => {
    const myId = socketRef.current?.id;
    return Object.entries(devices)
      .filter(([id]) => id !== myId)
      .map(([id, info]) => {
        const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return {
          id,
          name: info.name || 'Device',
          angle: (hash % 360),
          radius: 120 + ((hash % 100)),
        };
      });
  }, [devices, socketRef.current?.id]);

  // --- NEW & IMPROVED ANIMATIONS ---
  const animationStyles = `
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(187, 134, 252, 0.7); }
      70% { box-shadow: 0 0 0 20px rgba(187, 134, 252, 0); }
      100% { box-shadow: 0 0 0 0 rgba(187, 134, 252, 0); }
    }
    @keyframes radar-scan {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes fade-in {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes node-appear {
        from { opacity: 0; transform: scale(0.5); }
        to { opacity: 1; transform: scale(1); }
    }
  `;

  // --- REFINED & ENHANCED STYLES ---
  const styles = {
    pageContainer: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '2rem', background: 'linear-gradient(135deg, #121212 0%, #1a1a2e 100%)', color: '#e0e0e0', fontFamily: 'system-ui, sans-serif' },
    appContainer: { width: '100%', maxWidth: '1200px', backgroundColor: 'rgba(30, 30, 30, 0.8)', padding: '2.5rem', borderRadius: '24px', border: '1px solid #333', backdropFilter: 'blur(10px)', animation: 'fade-in 0.5s ease-out' },
    header: { textAlign: 'center' },
    title: { color: '#bb86fc', margin: '0', fontSize: '2.8rem', fontWeight: '700', textShadow: '0 0 10px rgba(187, 134, 252, 0.3)' },
    subtitle: { color: '#b0b0b0', margin: '8px 0 0', fontSize: '1.1rem' },
    input: { width: '100%', maxWidth: '400px', margin: '1.5rem auto', backgroundColor: '#333', border: '2px solid #555', color: '#e0e0e0', padding: '16px', borderRadius: '12px', fontSize: '1rem', boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.3s ease, box-shadow 0.3s ease' },
    button: { width: '100%', backgroundColor: '#bb86fc', color: '#121212', border: 'none', padding: '16px 1.5rem', borderRadius: '12px', cursor: 'pointer', fontWeight: '700', fontSize: '1rem', transition: 'background-color 0.3s ease, transform 0.2s ease', textTransform: 'uppercase', letterSpacing: '1px' },
    buttonHover: { backgroundColor: '#a874e8', transform: 'translateY(-2px)' },
    buttonDisabled: { backgroundColor: '#4a4a4a', cursor: 'not-allowed', opacity: '0.6' },
    section: { display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'rgba(44, 44, 44, 0.5)', padding: '1.5rem', borderRadius: '16px', border: '1px solid #444' },
    sectionTitle: { color: '#e0e0e0', margin: '0 0 1rem 0', fontSize: '1.4rem', fontWeight: '600', borderBottom: '2px solid #bb86fc', paddingBottom: '0.5rem' },
    
    // --- Radar Styles ---
    radarContainer: { position: 'relative', width: '100%', maxWidth: '500px', aspectRatio: '1', display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '2rem auto', overflow: 'hidden' },
    radarCircle: { position: 'absolute', borderRadius: '50%', border: '1px solid rgba(3, 218, 198, 0.2)', transition: 'all 0.5s ease' },
    radarScanner: { position: 'absolute', width: '100%', height: '100%', background: 'linear-gradient(to top, rgba(3, 218, 198, 0.4) 0%, transparent 50%)', animation: 'radar-scan 4s linear infinite' },
    radarCenter: { position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: '120px', height: '120px', borderRadius: '50%', backgroundColor: '#bb86fc', color: '#121212', cursor: 'pointer', animation: 'pulse 2s infinite', textAlign: 'center', border: '4px solid #121212', zIndex: 2 },
    deviceNode: { position: 'absolute', width: '80px', height: '80px', backgroundColor: '#2c2c2c', border: '3px solid #03dac6', borderRadius: '50%', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', transition: 'transform 0.3s ease, box-shadow 0.3s ease', animation: 'node-appear 0.5s ease-out forwards', zIndex: 1 },
    deviceName: { color: '#e0e0e0', fontSize: '1.5rem', fontWeight: 'bold', pointerEvents: 'none' },
    deviceNameTooltip: { position: 'absolute', bottom: '-35px', backgroundColor: '#121212', padding: '6px 12px', borderRadius: '8px', color: '#bb86fc', fontSize: '0.9rem', opacity: 0, transition: 'opacity 0.3s ease, transform 0.3s ease', transform: 'translateY(10px)', pointerEvents: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.5)', zIndex: 10 },
    
    // --- File Transfer & Download Styles ---
    transferContainer: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', alignItems: 'start' },
    fileInputContainer: { border: '2px dashed #555', borderRadius: '16px', padding: '2rem', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.3s ease, background-color 0.3s ease', backgroundColor: '#2c2c2c', color: '#aaaaaa' },
    fileInput: { display: 'none' },
    progressContainer: { width: '100%', backgroundColor: '#333', borderRadius: '8px', overflow: 'hidden', height: '16px', border: '1px solid #555' },
    progressBar: { height: '100%', background: 'linear-gradient(90deg, #bb86fc, #03dac6)', transition: 'width 0.3s ease-in-out' },
    downloadsList: { listStyle: 'none', padding: '0', margin: '0', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto' },
    downloadItem: { backgroundColor: 'rgba(44, 44, 44, 0.8)', padding: '1.2rem', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #333', transition: 'transform 0.2s ease, box-shadow 0.2s ease' },
    downloadLink: { textDecoration: 'none', backgroundColor: '#03dac6', color: '#121212', padding: '10px 18px', borderRadius: '8px', fontWeight: '600', transition: 'background-color 0.3s ease, transform 0.2s ease' },
  };

  return (
    <div style={styles.pageContainer}>
      <style>{animationStyles}</style> {/* Injecting keyframes */}
      {status !== 'connected' ? (
        // --- Discovery View ---
        <div style={{textAlign: 'center', width: '100%', animation: 'fade-in 0.5s ease-out' }}>
          <h1 style={styles.title}>SnapDrop LAN 🚀</h1>
          <p style={styles.subtitle}>Discover other devices on your local network</p>
          <input
            type="text"
            value={myName}
            onChange={(e) => setMyName(e.target.value)}
            placeholder="Enter Your Device Name"
            style={styles.input}
            onFocus={(e) => { e.target.style.borderColor = '#bb86fc'; e.target.style.boxShadow = '0 0 10px rgba(187, 134, 252, 0.4)'; }}
            onBlur={(e) => { e.target.style.borderColor = '#555'; e.target.style.boxShadow = 'none'; }}
          />
          <div style={styles.radarContainer}>
            {/* NEW: Radar Scanner Animation */}
            <div style={styles.radarScanner}></div>
            
            {/* Concentric Circles */}
            <div style={{...styles.radarCircle, width: '250px', height: '250px'}}></div>
            <div style={{...styles.radarCircle, width: '500px', height: '500px'}}></div>
            
            {/* Center Node (You) */}
            <div style={styles.radarCenter}>
                <div style={{fontWeight: 'bold'}}>You</div>
                <div style={{fontSize: '0.8rem', opacity: 0.8}}>{myName}</div>
            </div>

            {/* Discovered Devices */}
            {deviceEntries.map(device => (
              <div
                key={device.id}
                style={{ ...styles.deviceNode, transform: `rotate(${device.angle}deg) translate(${device.radius}px) rotate(-${device.angle}deg)` }}
                onClick={() => callPeer(device.id)}
                onMouseOver={e => {
                  const target = e.currentTarget;
                  target.style.transform = `rotate(${device.angle}deg) translate(${device.radius}px) rotate(-${device.angle}deg) scale(1.1)`;
                  target.style.boxShadow = '0 0 25px rgba(3, 218, 198, 0.8)';
                  const tooltip = target.querySelector('div');
                  if(tooltip) {
                    tooltip.style.opacity = 1;
                    tooltip.style.transform = 'translateY(0)';
                  }
                }}
                onMouseOut={e => {
                  const target = e.currentTarget;
                  target.style.transform = `rotate(${device.angle}deg) translate(${device.radius}px) rotate(-${device.angle}deg) scale(1)`;
                  target.style.boxShadow = 'none';
                  const tooltip = target.querySelector('div');
                  if(tooltip) {
                    tooltip.style.opacity = 0;
                    tooltip.style.transform = 'translateY(10px)';
                  }
                }}
              >
                <span style={styles.deviceName}>
                  {status === 'connecting' && targetId === device.id ? '...' : '🔗'}
                </span>
                <div style={styles.deviceNameTooltip}>{device.name}</div>
              </div>
            ))}

            {deviceEntries.length === 0 && (
              <div style={{ position: 'absolute', color: '#888', zIndex: 1, backdropFilter: 'blur(2px)', padding: '5px 10px', borderRadius: '5px' }}>
                Searching for devices...
              </div>
            )}
          </div>
          <div style={{display: 'flex', justifyContent: 'center', gap: '2rem', marginTop: '2rem'}}>
            <button onClick={() => navigate('/createroom')} style={{...styles.button, maxWidth: '200px', backgroundColor: '#03dac6'}}>Create Room</button>
            <button onClick={() => navigate('/globalshare')} style={{...styles.button, maxWidth: '200px', backgroundColor: '#03dac6'}}>Global Share</button>
          </div>
        </div>
      ) : (
        // --- Connected / File Transfer View ---
        <div style={styles.appContainer}>
          <div style={styles.header}>
            <h1 style={styles.title}>Connected ✨</h1>
            <p style={styles.subtitle}>Ready to transfer files with <strong style={{color: '#03dac6'}}>{devices[targetId]?.name || 'Device'}</strong></p>
          </div>
          
          <div style={styles.transferContainer}>
            <div style={styles.section}>
              <h2 style={styles.sectionTitle}>1. Send File</h2>
              <label htmlFor="file-upload" style={{ ...styles.fileInputContainer }}
                onMouseOver={(e) => { e.currentTarget.style.borderColor = '#bb86fc'; e.currentTarget.style.backgroundColor = 'rgba(187, 134, 252, 0.1)'; }}
                onMouseOut={(e) => { e.currentTarget.style.borderColor = '#555'; e.currentTarget.style.backgroundColor = '#2c2c2c'; }}
              >
                {selectedFile ? `Selected: ${selectedFile.name}` : 'Click or Drag to Select File'}
              </label>
              <input id="file-upload" type="file" style={styles.fileInput} onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
              
              <button
                onClick={sendFile}
                disabled={!selectedFile}
                style={!selectedFile ? { ...styles.button, ...styles.buttonDisabled } : styles.button}
                onMouseOver={e => { if(!selectedFile) return; e.currentTarget.style.backgroundColor = styles.buttonHover.backgroundColor; e.currentTarget.style.transform = styles.buttonHover.transform; }}
                onMouseOut={e => { if(!selectedFile) return; e.currentTarget.style.backgroundColor = styles.button.backgroundColor; e.currentTarget.style.transform = 'none'; }}
              >
                Send File
              </button>
              
              {(sendProgress > 0 || recvProgress > 0) && (
                <div style={{marginTop: '1rem'}}>
                    {sendProgress > 0 && (
                        <div>
                            <p>Sending... {sendProgress}%</p>
                            <div style={styles.progressContainer}><div style={{...styles.progressBar, width: `${sendProgress}%`}}></div></div>
                        </div>
                    )}
                    {recvProgress > 0 && (
                        <div style={{marginTop: '1rem'}}>
                            <p>Receiving... {recvProgress}%</p>
                            <div style={styles.progressContainer}><div style={{...styles.progressBar, width: `${recvProgress}%`}}></div></div>
                        </div>
                    )}
                </div>
              )}
            </div>

            <div style={styles.section}>
              <h2 style={styles.sectionTitle}>2. Downloads</h2>
              {downloads.length === 0 ? (
                <div style={{...styles.fileInputContainer, cursor: 'default', backgroundColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '150px' }}>No files received yet.</div>
              ) : (
                <ul style={styles.downloadsList}>
                  {downloads.map((download, index) => (
                    <li key={index} style={styles.downloadItem}
                      onMouseOver={e => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = '0 0 15px rgba(0,0,0,0.4)'; }}
                      onMouseOut={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}
                    >
                      <div>
                        <div style={{ fontWeight: 'bold' }}>{download.name}</div>
                        <div style={{ color: '#aaaaaa', fontSize: '0.9rem' }}>{prettyBytes(download.size)}</div>
                      </div>
                      <a href={download.url} download={download.name} style={styles.downloadLink}
                         onMouseOver={e => { e.currentTarget.style.backgroundColor = '#34e7d4'; e.currentTarget.style.transform = 'scale(1.05)'; }}
                         onMouseOut={e => { e.currentTarget.style.backgroundColor = '#03dac6'; e.currentTarget.style.transform = 'scale(1)'; }}
                      >Download</a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <button onClick={hangup} style={{ ...styles.button, backgroundColor: '#c0392b', maxWidth: '400px', margin: '1rem auto 0' }}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

// Helper functions (unchanged)
function defaultName() {
  const base = 'Device';
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${base}-${n}`;
}

function prettyBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
}
