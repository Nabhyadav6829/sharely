import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';

const BACKEND_URL = 'https://sharely-backend-fvi8.onrender.com';
const CHUNK = 256 * 1024; // 256KB
const MAX_BUFFERED = 1 * 1024 * 1024; // ✅ reduce to 1MB (smooth transfer)

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

        // ✅ wait if buffer is too full
        while (dc.bufferedAmount > MAX_BUFFERED) {
          await new Promise((r) => setTimeout(r, 10));
        }

        dc.send(slice);
        sent += slice.byteLength;
        setSendProgress(Math.round((sent * 100) / file.size));

        // ✅ small yield to avoid blocking event loop
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

  const deviceEntries = useMemo(() => {
    const myId = socketRef.current?.id;
    return Object.entries(devices)
      .filter(([id]) => id !== myId)
      .map(([id, info]) => ({ id, name: info.name || 'Device', since: info.since }));
  }, [devices, socketRef.current?.id]);

  return (
    <div>
      <div>
        {/* Header */}
        <header>
          <h1>SnapDrop LAN 🚀</h1>
          <p>Share files instantly over your LAN</p>
          <input
            value={myName}
            onChange={(e) => setMyName(e.target.value)}
            placeholder="My device name"
          />
        </header>

        {/* Features Section */}
        <section>
          <h2>Features</h2>
          <div>
            <div>
              <h3>Room Creation</h3>
              <p>
                Create private rooms to share files securely with specific devices. Share a unique room code or QR code with others to connect and transfer files seamlessly over your local network.
              </p>
            </div>
            <div>
              <h3>Global Sharing</h3>
              <p>
                Discover and connect with devices on your network for quick file sharing without needing a room. Perfect for instant transfers with nearby devices on the same LAN.
              </p>
            </div>
          </div>
        </section>

        {/* Radar + Devices */}
        {status !== 'connected' && (
          <main>
            <div>
              <span />
              <span />
              <span />
              <span />
              <span />
              {deviceEntries.length === 0 ? (
                <div>
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-2.34 0-4.29-1.009-5.691-2.585M12 3c-4.418 0-8 3.358-8 7.5 0 2.025.846 3.85 2.191 5.185"></path>
                  </svg>
                  <div>No devices found</div>
                  <div>Open SnapDrop LAN on another device</div>
                </div>
              ) : (
                deviceEntries.map((device) => {
                  return (
                    <div
                      key={device.id}
                      onClick={() => callPeer(device.id)}
                    >
                      <div>
                        <div>
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="3" fill="none" strokeWidth="2" />
                            <circle cx="12" cy="12" r="9" fill="none" strokeWidth="1.5" />
                          </svg>
                        </div>
                        <div>{device.name}</div>
                        <div>
                          {status === 'connecting' && targetId === device.id ? 'Connecting...' : 'Click to connect'}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div>
              <button
                onClick={() => socketRef.current?.emit('who')}
              >
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
              </button>
            </div>
          </main>
        )}

        {/* Connection Status */}
        <div>
          <div>
            <div>Connection Status</div>
            <div>
              <span>
                {status === 'connected' && '🟢 '}
                {status === 'connecting' && '🟡 '}
                {status === 'idle' && '⚫ '}
                {status}
              </span>
              {targetId && (
                <span>{targetId}</span>
              )}
            </div>
          </div>
          <button
            onClick={hangup}
            disabled={status === 'idle'}
          >
            Disconnect
          </button>
        </div>

        {/* File Transfer and Downloads */}
        {status === 'connected' && (
          <div>
            <section>
              <div>
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                </svg>
                <h3>File Transfer</h3>
              </div>
              <div>
                <label>
                  {selectedFile ? `Selected: ${selectedFile.name}` : 'Click to Select File'}
                  <input
                    type="file"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  />
                </label>
                <button
                  onClick={sendFile}
                  disabled={!selectedFile || status !== 'connected'}
                >
                  Send File
                </button>
              </div>
              {sendProgress > 0 && (
                <div>
                  <div>
                    <span>Sending file...</span>
                    <span>{sendProgress}%</span>
                  </div>
                  <div>
                    <div style={{ width: `${sendProgress}%` }}></div>
                  </div>
                </div>
              )}
              {recvProgress > 0 && (
                <div>
                  <div>
                    <span>Receiving file...</span>
                    <span>{recvProgress}%</span>
                  </div>
                  <div>
                    <div style={{ width: `${recvProgress}%` }}></div>
                  </div>
                </div>
              )}
            </section>

            {downloads.length > 0 && (
              <section>
                <div>
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                  </svg>
                  <h3>Downloaded Files</h3>
                </div>
                <div>
                  {downloads.map((download, index) => (
                    <div
                      key={index}
                    >
                      <div>
                        <div>
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                          </svg>
                        </div>
                        <div>
                          <div>{download.name}</div>
                          <div>{prettyBytes(download.size)}</div>
                        </div>
                      </div>
                      <a
                        href={download.url}
                        download={download.name}
                      >
                        Download
                      </a>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div>
          <button
            onClick={() => navigate('/create')}
          >
            + Create Room
          </button>
          <button
            onClick={() => navigate('/global')}
          >
            🌐 Global
          </button>
        </div>
      </div>
    </div>
  );
}

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
