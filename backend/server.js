

// || Node.js || LAN Share + Cloudinary Upload Backend ||
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Cloudinary dependencies
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// --- Cloudinary configuration ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

// --- Cloudinary upload route ---
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: "auto", folder: "uploads" },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    res.json({ url: result.secure_url });
  } catch (err) {
    console.error("Cloudinary upload error:", err);
    res.status(500).json(err);
  }
});

// --- Existing LAN Share routes ---
app.get('/', (req, res) => {
  res.send('LAN Share backend is running...');
});

// Track room members and their names
const rooms = new Map();
// Track devices and their info
const devices = new Map();

io.on('connection', (socket) => {
  console.log('A new client connected:', socket.id);

  // Handle device registration for both pages
  socket.on('register', ({ name }) => {
    const deviceName = name || `Device-${Math.floor(1000 + Math.random() * 9000)}`;
    socket.name = deviceName;
    devices.set(socket.id, { name: deviceName, since: Date.now() });
    broadcastDevices();
    updateRoomMembers(socket);
  });

  // Handle room joining for CreateRoom.jsx
  socket.on('join', (room) => {
    socket.join(room);
    if (!rooms.has(room)) {
      rooms.set(room, new Map());
    }
    rooms.get(room).set(socket.id, socket.name);
    socket.to(room).emit('peer-joined', socket.id); // Include peer ID
    updateRoomMembers(socket, room);
  });

  // Handle device list request for App.jsx
  socket.on('who', () => {
    socket.emit('devices', serializeDevices());
  });

  // Handle signaling for both pages
  socket.on('signal', ({ room, to, data }) => {
    if (room && !to) {
      // For CreateRoom.jsx (room-based signaling)
      socket.to(room).emit('signal', { from: socket.id, data });
    } else if (to && data) {
      // For App.jsx (direct peer signaling)
      io.to(to).emit('signal', { from: socket.id, data });
    }
  });

  // Handle file sharing notifications for CreateRoom.jsx
  socket.on('file-shared', (fileInfo) => {
    socket.to(fileInfo.room).emit('file-shared', fileInfo);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Clean up rooms
    rooms.forEach((members, room) => {
      if (members.has(socket.id)) {
        members.delete(socket.id);
        socket.to(room).emit('peer-left', socket.id); // Notify peers of disconnection
        updateRoomMembers(socket, room);
        if (members.size === 0) {
          rooms.delete(room);
        }
      }
    });
    // Clean up devices
    devices.delete(socket.id);
    broadcastDevices();
  });

  // Update room members count for CreateRoom.jsx
  function updateRoomMembers(socket, room) {
    if (room && rooms.has(room)) {
      const count = rooms.get(room).size;
      io.to(room).emit('room-members', count);
    }
  }

  // Broadcast device list for App.jsx
  function broadcastDevices() {
    io.emit('devices', serializeDevices());
  }

  // Serialize devices for App.jsx
  function serializeDevices() {
    const out = {};
    for (const [id, info] of devices.entries()) {
      out[id] = info;
    }
    return out;
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`✅ LAN Share backend listening on http://localhost:${PORT}`);
});

// Start Cloudinary route server (same app, same port)
console.log(`✅ Cloudinary upload route enabled at http://localhost:${PORT}/upload`);
