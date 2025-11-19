
import React, { useEffect, useRef, useState } from "react";
    import { createRoot } from "react-dom/client";
    import io from "socket.io-client";
    import { QRCodeCanvas } from "qrcode.react";

    const BACKEND_URL = "https://sharely-backend-fvi8.onrender.com";
    const CHUNK = 256 * 1024; // 256KB
    const MAX_BUFFERED = 1 * 1024 * 1024; // 8MB for backpressure

    function CreateRoom() {
        const [room, setRoom] = useState("");
        const [file, setFile] = useState(null);
        const [connected, setConnected] = useState(false);
        const [progress, setProgress] = useState(0);
        const [status, setStatus] = useState("Join a room or create a new one to start.");
        const [members, setMembers] = useState(0);
        const [sharedFiles, setSharedFiles] = useState([]);
        const [deviceName, setDeviceName] = useState(defaultName());
        const [showQrCode, setShowQrCode] = useState(false);
        const [peerNames, setPeerNames] = useState(new Map());
        const [showMemberList, setShowMemberList] = useState(false);

        const socketRef = useRef(null);
        const pcRefs = useRef(new Map());
        const dcRefs = useRef(new Map());
        const fileReceiverRef = useRef(new Map());
        const deviceNameRef = useRef(deviceName);

        useEffect(() => {
            deviceNameRef.current = deviceName;
        }, [deviceName]);

        useEffect(() => {
            document.body.style.backgroundColor = '#121212';
            document.body.style.margin = '0';
            document.documentElement.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
            return () => {
                document.body.style.backgroundColor = '';
                document.body.style.margin = '';
                document.documentElement.style.fontFamily = '';
            };
        }, []);

        useEffect(() => {
            const socket = io(BACKEND_URL);
            socketRef.current = socket;

            socket.on('connect', () => {
                console.log('Socket connected:', socket.id);
                socket.emit('register', { name: deviceName });
                const urlParams = new URLSearchParams(window.location.search);
                const roomFromUrl = urlParams.get('room');
                if (roomFromUrl) {
                    const trimmedRoom = roomFromUrl.trim();
                    setRoom(trimmedRoom);
                    socket.emit('join', trimmedRoom);
                    setConnected(true);
                    setStatus("Joined room from URL. Waiting for peers...");
                }
            });

            socket.on('room-members', (count) => {
                setMembers(count);
            });

            socket.on('peer-joined', async (peerId) => {
                setStatus(`Peer ${peerId} joined. Creating offer...`);
                await makeOffer(peerId);
            });

            socket.on('signal', async ({ from, data }) => {
                if (!pcRefs.current.has(from)) {
                    setupPeerConnection(from);
                }
                const pc = pcRefs.current.get(from);
                if (!pc) return;

                try {
                    if (data.type === "offer") {
                        if (pc.signalingState !== "stable") return;
                        setStatus(`Offer received from ${from}. Creating answer...`);
                        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        socket.emit("signal", { room, to: from, data: { type: "answer", sdp: answer } });
                    } else if (data.type === "answer") {
                        if (pc.signalingState !== "have-local-offer") return;
                        setStatus(`Answer received from ${from}. Connection established.`);
                        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                    } else if (data.type === "ice") {
                        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                    }
                } catch (err) {
                    console.error(`Error handling signal from ${from}:`, err);
                }
            });

            socket.on('file-shared', (fileInfo) => {
                setSharedFiles((prev) => {
                    if (!prev.some(f => f.name === fileInfo.name && f.senderId === fileInfo.senderId)) {
                        return [...prev, { ...fileInfo, url: null }];
                    }
                    return prev;
                });
            });

            socket.on('peer-left', (peerId) => {
                closePeer(peerId);
                setStatus(`Peer ${peerId} left.`);
                fileReceiverRef.current.delete(peerId);
            });

            return () => {
                socket.disconnect();
                closeAllPeers();
            };
        }, []);

        useEffect(() => {
            if (socketRef.current?.connected) {
                socketRef.current.emit('register', { name: deviceName });
                for (const [peerId, dc] of dcRefs.current) {
                    if (dc.readyState === "open") {
                        try {
                            dc.send(JSON.stringify({ kind: 'name', name: deviceName }));
                        } catch (err) {
                            console.error(`Error sending name update to ${peerId}:`, err);
                        }
                    }
                }
            }
        }, [deviceName]);

        function setupPeerConnection(peerId) {
            const pc = new RTCPeerConnection({
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                    { urls: "stun:stun1.l.google.com:19302" },
                ],
            });
            pc.onicecandidate = (e) => {
                if (e.candidate) {
                    socketRef.current.emit("signal", { room, to: peerId, data: { type: "ice", candidate: e.candidate } });
                }
            };
            pc.ondatachannel = (e) => {
                const dc = e.channel;
                dcRefs.current.set(peerId, dc);
                setupDataChannel(dc, peerId);
            };
            pc.onconnectionstatechange = () => {
                if (pc.connectionState === 'connected') {
                    setStatus(`Connected to ${peerId}. Ready to send files.`);
                } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
                    setStatus(`Disconnected from ${peerId}.`);
                    closePeer(peerId);
                }
            };
            pcRefs.current.set(peerId, pc);
        }

        async function makeOffer(peerId) {
            if (!pcRefs.current.has(peerId)) {
                setupPeerConnection(peerId);
            }
            const pc = pcRefs.current.get(peerId);
            const dc = pc.createDataChannel("file-transfer");
            setupDataChannel(dc, peerId);
            dcRefs.current.set(peerId, dc);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socketRef.current.emit("signal", { room, to: peerId, data: { type: "offer", sdp: offer } });
        }

        function setupDataChannel(channel, peerId) {
            channel.binaryType = "arraybuffer";
            channel.onopen = () => {
                try {
                    channel.send(JSON.stringify({ kind: 'name', name: deviceNameRef.current }));
                } catch (err) {
                    console.error(`Error sending initial name to ${peerId}:`, err);
                }
            };
            channel.onclose = () => {
                setStatus(`Data channel closed with ${peerId}.`);
            };
            channel.onmessage = (e) => handleReceive(e.data, peerId);
        }

        const joinRoom = () => {
            if (!room) return alert("Please enter a room code!");
            const trimmedRoom = room.trim();
            socketRef.current.emit("join", trimmedRoom);
            setRoom(trimmedRoom);
            setConnected(true);
            setStatus("Room joined. Waiting for another peer...");
        };

        const createAndJoinRoom = () => {
            const newRoomCode = Math.floor(10000 + Math.random() * 90000).toString();
            setRoom(newRoomCode);
            socketRef.current.emit("join", newRoomCode);
            setConnected(true);
            setStatus("Room joined. Waiting for another peer...");
        };

        async function sendFile() {
            if (!file || dcRefs.current.size === 0) {
                alert("File not selected or no peers connected.");
                return;
            }
            const metadata = {
                name: file.name,
                size: file.size,
                type: file.type || 'application/octet-stream',
                senderId: socketRef.current.id
            };
            for (const [peerId, dc] of dcRefs.current) {
                if (dc.readyState === "open") {
                    dc.send(JSON.stringify({ kind: 'meta', ...metadata }));
                }
            }
            socketRef.current.emit('file-shared', {
                name: file.name,
                size: file.size,
                sender: deviceName,
                room,
                senderId: socketRef.current.id
            });

            const reader = file.stream().getReader();
            let sent = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                for (let offset = 0; offset < value.byteLength; offset += CHUNK) {
                    const slice = value.buffer.slice(offset, Math.min(value.byteLength, offset + CHUNK));
                    for (const [peerId, dc] of dcRefs.current) {
                        if (dc.readyState === "open") {
                            while (dc.bufferedAmount > MAX_BUFFERED) {
                                await new Promise((r) => setTimeout(r, 20));
                            }
                            dc.send(slice);
                        }
                    }
                    sent += slice.byteLength;
                    setProgress(Math.round((sent * 100) / file.size));
                }
            }
            setStatus(`File "${file.name}" sent successfully!`);
            setProgress(0);
        }

        const handleReceive = (data, peerId) => {
            try {
                if (typeof data === "string") {
                    const json = JSON.parse(data);
                    if (json.kind === 'meta') {
                        const metadata = json;
                        fileReceiverRef.current.set(peerId, {
                            metadata,
                            chunks: [],
                            receivedSize: 0
                        });
                        setStatus(`Receiving file: ${metadata.name} from ${peerId}`);
                    } else if (json.kind === 'name') {
                        setPeerNames(prev => {
                            const newMap = new Map(prev);
                            newMap.set(peerId, json.name);
                            return newMap;
                        });
                    }
                } else {
                    const receiver = fileReceiverRef.current.get(peerId);
                    if (!receiver || !receiver.metadata) return;
                    receiver.chunks.push(data);
                    receiver.receivedSize += data.byteLength;
                    setProgress(Math.round((receiver.receivedSize / receiver.metadata.size) * 100));

                    if (receiver.receivedSize === receiver.metadata.size) {
                        const blob = new Blob(receiver.chunks, { type: receiver.metadata.type });
                        const url = URL.createObjectURL(blob);
                        setSharedFiles((prev) => {
                            const existingFile = prev.find(f => f.name === receiver.metadata.name && f.senderId === receiver.metadata.senderId);
                            if (existingFile) {
                                return prev.map(f =>
                                    f.name === receiver.metadata.name && f.senderId === receiver.metadata.senderId
                                        ? { ...f, url }
                                        : f
                                );
                            } else {
                                return [
                                    ...prev,
                                    {
                                        name: receiver.metadata.name,
                                        size: receiver.metadata.size,
                                        url,
                                        sender: peerNames.get(peerId) || 'Unknown',
                                        senderId: receiver.metadata.senderId
                                    }
                                ];
                            }
                        });
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = receiver.metadata.name;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        setStatus(`File "${receiver.metadata.name}" received successfully from ${peerId}!`);
                        setProgress(0);
                        fileReceiverRef.current.delete(peerId);
                    }
                }
            } catch (error) {
                console.error(`Receive error from ${peerId}:`, error);
            }
        };

        function closePeer(peerId) {
            try {
                const dc = dcRefs.current.get(peerId);
                const pc = pcRefs.current.get(peerId);
                dc?.close();
                pc?.close();
                dcRefs.current.delete(peerId);
                pcRefs.current.delete(peerId);
                fileReceiverRef.current.delete(peerId);
                setPeerNames(prev => {
                    const newMap = new Map(prev);
                    newMap.delete(peerId);
                    return newMap;
                });
            } catch {}
        }

        function closeAllPeers() {
            try {
                for (const [peerId, dc] of dcRefs.current) {
                    dc?.close();
                }
                for (const [peerId, pc] of pcRefs.current) {
                    pc?.close();
                }
                dcRefs.current.clear();
                pcRefs.current.clear();
                fileReceiverRef.current.clear();
            } catch {}
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

        function defaultName() {
            const base = 'Device';
            const n = Math.floor(1000 + Math.random() * 9000);
            return `${base}-${n}`;
        }

        const copyToClipboard = () => {
            const link = `${window.location.origin}/create?room=${room}`;
            navigator.clipboard.writeText(link).then(() => {
                setStatus("Link copied to clipboard!");
            }).catch(() => {
                setStatus("Failed to copy link.");
            });
        };

        const styles = {
            pageContainer: {
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '100vh',
                padding: '20px',
                backgroundColor: '#121212',
                color: '#e0e0e0',
            },
            appContainer: {
                width: '100%',
                maxWidth: '640px',
                backgroundColor: '#1e1e1e',
                padding: '2.5rem',
                borderRadius: '16px',
                boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
                border: '1px solid #333333',
                display: 'flex',
                flexDirection: 'column',
                gap: '24px',
            },
            header: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid #333333',
                paddingBottom: '1.2rem',
            },
            title: {
                color: '#bb86fc',
                margin: '0',
                fontSize: '2.2rem',
                fontWeight: '600',
            },
            input: {
                width: '100%',
                backgroundColor: '#333333',
                border: '1px solid #555555',
                color: '#e0e0e0',
                padding: '14px',
                borderRadius: '10px',
                fontSize: '1rem',
                boxSizing: 'border-box',
                transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
                outline: 'none',
            },
            inputFocus: {
                borderColor: '#bb86fc',
                boxShadow: '0 0 8px rgba(187, 134, 252, 0.3)',
            },
            button: {
                width: '100%',
                backgroundColor: '#8e44ad',
                color: '#ffffff',
                border: 'none',
                padding: '14px 1.5rem',
                borderRadius: '10px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '1rem',
                transition: 'background-color 0.3s ease, transform 0.2s ease',
            },
            buttonHover: {
                backgroundColor: '#9b59b6',
                transform: 'translateY(-2px)',
            },
            buttonDisabled: {
                backgroundColor: '#4a4a4a',
                cursor: 'not-allowed',
                opacity: '0.6',
            },
            status: {
                backgroundColor: 'rgba(187, 134, 252, 0.1)',
                padding: '14px',
                borderRadius: '10px',
                textAlign: 'center',
                color: '#bb86fc',
                border: '1px solid #bb86fc',
                fontSize: '0.95rem',
            },
            fileInputContainer: {
                border: '2px dashed #555555',
                borderRadius: '10px',
                padding: '24px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'border-color 0.3s ease, background-color 0.3s ease',
                backgroundColor: '#2c2c2c',
                color: '#aaaaaa',
            },
            fileInputContainerHover: {
                borderColor: '#bb86fc',
                backgroundColor: 'rgba(187, 134, 252, 0.1)',
            },
            fileInput: {
                display: 'none',
            },
            progressContainer: {
                width: '100%',
                backgroundColor: '#333333',
                borderRadius: '6px',
                overflow: 'hidden',
                height: '14px',
                border: '1px solid #555555',
            },
            progressBar: {
                height: '100%',
                backgroundColor: '#bb86fc',
                transition: 'width 0.3s ease-in-out',
            },
            sharedFilesList: {
                listStyle: 'none',
                padding: '0',
                margin: '0',
                maxHeight: '280px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
            },
            sharedFileItem: {
                backgroundColor: '#2c2c2c',
                padding: '1.2rem',
                borderRadius: '10px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                border: '1px solid #333333',
                transition: 'box-shadow 0.3s ease',
            },
            sharedFileItemHover: {
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            },
            downloadLink: {
                textDecoration: 'none',
                backgroundColor: '#03dac6',
                color: '#121212',
                padding: '10px 18px',
                borderRadius: '8px',
                fontWeight: '600',
                transition: 'background-color 0.3s ease, transform 0.2s ease',
            },
            downloadLinkHover: {
                backgroundColor: '#00c4b4',
                transform: 'translateY(-2px)',
            },
            footer: {
                textAlign: 'center',
                color: '#777777',
                fontSize: '0.85rem',
                marginTop: 'auto',
            },
            qrContainer: {
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '16px',
                backgroundColor: '#2c2c2c',
                borderRadius: '10px',
                border: '1px solid #333333',
            },
            qrText: {
                textAlign: 'center',
                color: '#aaaaaa',
                fontSize: '0.9rem',
                marginTop: '8px',
            },
            membersContainer: {
                position: 'relative',
                cursor: 'pointer',
            },
            memberListTooltip: {
                position: 'absolute',
                top: '100%',
                right: 0,
                backgroundColor: '#2c2c2c',
                border: '1px solid #555',
                borderRadius: '8px',
                padding: '12px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                zIndex: 10,
                width: '250px',
                marginTop: '8px',
                textAlign: 'left',
            },
            memberListItem: {
                padding: '6px 2px',
                borderBottom: '1px solid #444',
                color: '#e0e0e0',
                fontSize: '0.9rem',
                wordBreak: 'break-all',
            },
            qrButtonContainer: {
                display: 'flex',
                gap: '12px',
                width: '100%',
                justifyContent: 'center',
            },
            qrButton: {
                flex: 1,
                backgroundColor: '#333',
                border: '1px solid #555',
                color: '#ffffff',
                padding: '10px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.9rem',
                transition: 'background-color 0.3s ease',
                textAlign: 'center',
            },
            qrButtonHover: {
                backgroundColor: '#444',
            },
        };

        return (
            <div style={styles.pageContainer}>
                <div style={styles.appContainer}>
                    <div style={styles.header}>
                        <h1 style={styles.title}>LAN Share 🚀</h1>
                        {connected &&
                            <div
                                style={styles.membersContainer}
                                onMouseEnter={() => setShowMemberList(true)}
                                onMouseLeave={() => setShowMemberList(false)}
                            >
                                <span style={{ color: '#aaa' }}>Members: {members}</span>
                                {showMemberList && (
                                    <div style={styles.memberListTooltip}>
                                        <div style={{...styles.memberListItem, fontWeight: 'bold'}}>{deviceName} (You)</div>
                                        {Array.from(peerNames.entries()).map(([id, name]) => (
                                            <div key={id} style={styles.memberListItem}>{name}</div>
                                        ))}
                                        {members <= 1 && <div style={{...styles.memberListItem, borderBottom: 'none'}}>No other peers connected.</div>}
                                    </div>
                                )}
                            </div>
                        }
                    </div>
                    {!connected ? (
                        <>
                            <p style={styles.status}>{status}</p>
                            <input
                                value={deviceName}
                                onChange={(e) => setDeviceName(e.target.value)}
                                placeholder="Your device name"
                                style={styles.input}
                                onFocus={(e) => (e.target.style.borderColor = styles.inputFocus.borderColor)}
                                onBlur={(e) => (e.target.style.borderColor = '#555555')}
                            />
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <input
                                    value={room}
                                    onChange={(e) => setRoom(e.target.value)}
                                    placeholder="Enter room code to join"
                                    style={{ ...styles.input, flex: 1 }}
                                    onFocus={(e) => (e.target.style.borderColor = styles.inputFocus.borderColor)}
                                    onBlur={(e) => (e.target.style.borderColor = '#555555')}
                                />
                                <button
                                    onClick={joinRoom}
                                    disabled={!room}
                                    style={{...styles.button, width: 'auto', ...(!room ? styles.buttonDisabled : {})}}
                                    onMouseOver={(e) => !room ? null : (e.target.style.backgroundColor = styles.buttonHover.backgroundColor)}
                                    onMouseOut={(e) => !room ? null : (e.target.style.backgroundColor = '#8e44ad')}
                                >
                                    Join
                                </button>
                            </div>
                            <div style={{ textAlign: 'center', color: '#777', margin: '8px 0', fontSize: '0.9rem' }}>OR</div>
                            <button
                                onClick={createAndJoinRoom}
                                style={styles.button}
                                onMouseOver={(e) => (e.target.style.backgroundColor = styles.buttonHover.backgroundColor)}
                                onMouseOut={(e) => (e.target.style.backgroundColor = '#8e44ad')}
                            >
                                Create & Join New Room
                            </button>
                        </>
                    ) : (
                        <>
                            <h2 style={{ color: '#e0e0e0', textAlign: 'center', margin: '0' }}>
                                Connected to Room: <span style={{ color: '#bb86fc' }}>{room}</span>
                            </h2>
                            <input
                                value={deviceName}
                                onChange={(e) => setDeviceName(e.target.value)}
                                placeholder="Your device name"
                                style={styles.input}
                                onFocus={(e) => (e.target.style.borderColor = styles.inputFocus.borderColor)}
                                onBlur={(e) => (e.target.style.borderColor = '#555555')}
                            />
                            {!showQrCode ? (
                                <button
                                    onClick={() => setShowQrCode(true)}
                                    style={{ ...styles.button, backgroundColor: '#333', border: '1px solid #555' }}
                                    onMouseOver={(e) => (e.target.style.backgroundColor = '#444')}
                                    onMouseOut={(e) => (e.target.style.backgroundColor = '#333')}
                                >
                                    Show Invite QR Code
                                </button>
                            ) : (
                                <div style={styles.qrContainer}>
                                    <QRCodeCanvas
                                        value={`${window.location.origin}/create?room=${room}`}
                                        size={160}
                                        bgColor={"#ffffff"}
                                        fgColor={"#1e1e1e"}
                                        level={"H"}
                                        includeMargin={true}
                                    />
                                    <p style={styles.qrText}>Scan to join room: {room}</p>
                                    <div style={styles.qrButtonContainer}>
                                        <button
                                            onClick={() => setShowQrCode(false)}
                                            style={styles.qrButton}
                                            onMouseOver={(e) => (e.target.style.backgroundColor = styles.qrButtonHover.backgroundColor)}
                                            onMouseOut={(e) => (e.target.style.backgroundColor = '#333')}
                                        >
                                            Hide QR Code
                                        </button>
                                        <button
                                            onClick={copyToClipboard}
                                            style={styles.qrButton}
                                            onMouseOver={(e) => (e.target.style.backgroundColor = styles.qrButtonHover.backgroundColor)}
                                            onMouseOut={(e) => (e.target.style.backgroundColor = '#333')}
                                        >
                                            Copy Link
                                        </button>
                                    </div>
                                </div>
                            )}
                            <div style={styles.status}>{status}</div>
                            <label
                                style={styles.fileInputContainer}
                                onMouseOver={(e) => {
                                    e.currentTarget.style.borderColor = styles.fileInputContainerHover.borderColor;
                                    e.currentTarget.style.backgroundColor = styles.fileInputContainerHover.backgroundColor;
                                }}
                                onMouseOut={(e) => {
                                    e.currentTarget.style.borderColor = '#555555';
                                    e.currentTarget.style.backgroundColor = '#2c2c2c';
                                }}
                            >
                                {file ? `Selected: ${file.name}` : 'Click or Drag to Select File'}
                                <input
                                    type="file"
                                    onChange={(e) => setFile(e.target.files[0])}
                                    style={styles.fileInput}
                                />
                            </label>
                            <button
                                onClick={sendFile}
                                style={{ ...styles.button, ...(!file || dcRefs.current.size === 0 ? styles.buttonDisabled : {}) }}
                                disabled={!file || dcRefs.current.size === 0}
                                onMouseOver={(e) => {
                                    if (!file || dcRefs.current.size === 0) return;
                                    e.target.style.backgroundColor = styles.buttonHover.backgroundColor;
                                    e.target.style.transform = styles.buttonHover.transform;
                                }}
                                onMouseOut={(e) => {
                                    if (!file || dcRefs.current.size === 0) return;
                                    e.target.style.backgroundColor = '#8e44ad';
                                    e.target.style.transform = 'none';
                                }}
                            >
                                Send File
                            </button>
                            {progress > 0 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={styles.progressContainer}>
                                        <div style={{ ...styles.progressBar, width: `${progress}%` }}></div>
                                    </div>
                                    <span style={{ color: '#bb86fc', fontWeight: '500' }}>{progress}%</span>
                                </div>
                            )}
                            {sharedFiles.length > 0 && (
                                <div>
                                    <h3 style={{ borderTop: '1px solid #333', paddingTop: '1.5rem', marginTop: '1rem' }}>
                                        Shared Files
                                    </h3>
                                    <ul style={styles.sharedFilesList}>
                                        {sharedFiles.map((f, i) => (
                                            <li
                                                key={`${f.name}-${f.senderId}-${i}`}
                                                style={styles.sharedFileItem}
                                                onMouseOver={(e) => (e.currentTarget.style.boxShadow = styles.sharedFileItemHover.boxShadow)}
                                                onMouseOut={(e) => (e.currentTarget.style.boxShadow = 'none')}
                                            >
                                                <div style={{ flex: 1, marginRight: '1rem' }}>
                                                    <div style={{ color: '#e0e0e0', fontWeight: '500' }}>{f.name}</div>
                                                    <div style={{ color: '#aaa', fontSize: '0.85rem' }}>
                                                        Size: {prettyBytes(f.size)} • From: {peerNames.get(f.senderId) || f.sender}
                                                    </div>
                                                </div>
                                                {f.url && (
                                                    <a
                                                        href={f.url}
                                                        download={f.name}
                                                        style={styles.downloadLink}
                                                        onMouseOver={(e) => {
                                                            e.target.style.backgroundColor = styles.downloadLinkHover.backgroundColor;
                                                            e.target.style.transform = styles.downloadLinkHover.transform;
                                                        }}
                                                        onMouseOut={(e) => {
                                                            e.target.style.backgroundColor = '#03dac6';
                                                            e.target.style.transform = 'none';
                                                        }}
                                                    >
                                                        Download
                                                    </a>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        );
    }
export default CreateRoom;
